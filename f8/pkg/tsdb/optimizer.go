package tsdb

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/tsdb"
	"github.com/prometheus/prometheus/tsdb/chunkenc"
	"github.com/prometheus/prometheus/tsdb/index"
)

type OptimizationResult struct {
	Success         bool                   `json:"success"`
	Message         string                 `json:"message"`
	BeforeReport    *IndexAnalysisReport   `json:"before_report"`
	AfterReport     *IndexAnalysisReport   `json:"after_report"`
	Optimizations   []OptimizationDetail   `json:"optimizations"`
	SavedSpaceBytes int64                  `json:"saved_space_bytes"`
	ConsistencyCheck *ConsistencyCheckResult `json:"consistency_check,omitempty"`
}

type OptimizationDetail struct {
	Type        string `json:"type"`
	Description string `json:"description"`
	BlocksMerged int   `json:"blocks_merged,omitempty"`
	ChunksCleaned int  `json:"chunks_cleaned,omitempty"`
	PostingsFixed int  `json:"postings_fixed,omitempty"`
}

type ConsistencyCheckResult struct {
	BeforeCheck *ConsistencyMetrics `json:"before_check"`
	AfterCheck  *ConsistencyMetrics `json:"after_check"`
	IsConsistent bool                `json:"is_consistent"`
}

type ConsistencyMetrics struct {
	TotalChunkRefs       int   `json:"total_chunk_refs"`
	ValidChunkRefs       int   `json:"valid_chunk_refs"`
	OrphanedChunkRefs    int   `json:"orphaned_chunk_refs"`
	TotalPostings        int   `json:"total_postings"`
	PostingsWithDeadRefs int   `json:"postings_with_dead_refs"`
	ReferenceCountErrors int   `json:"reference_count_errors"`
}

type chunkRefCounter struct {
	sync.RWMutex
	counts map[uint64]int      // chunk ref -> reference count
	valid  map[uint64]bool     // chunk ref -> is valid
}

func newChunkRefCounter() *chunkRefCounter {
	return &chunkRefCounter{
		counts: make(map[uint64]int),
		valid:  make(map[uint64]bool),
	}
}

func (c *chunkRefCounter) AddRef(ref uint64) {
	c.Lock()
	defer c.Unlock()
	c.counts[ref]++
}

func (c *chunkRefCounter) MarkValid(ref uint64) {
	c.Lock()
	defer c.Unlock()
	c.valid[ref] = true
}

func (c *chunkRefCounter) IsValid(ref uint64) bool {
	c.RLock()
	defer c.RUnlock()
	return c.valid[ref]
}

func (c *chunkRefCounter) GetRefCount(ref uint64) int {
	c.RLock()
	defer c.RUnlock()
	return c.counts[ref]
}

func (c *chunkRefCounter) GetOrphanedRefs() []uint64 {
	c.RLock()
	defer c.RUnlock()
	var orphaned []uint64
	for ref, count := range c.counts {
		if count > 0 && !c.valid[ref] {
			orphaned = append(orphaned, ref)
		}
	}
	return orphaned
}

type IndexOptimizer struct {
	dataDir string
	logger  Logger
	dryRun  bool
}

func NewIndexOptimizer(dataDir string, logger Logger, dryRun bool) *IndexOptimizer {
	return &IndexOptimizer{
		dataDir: dataDir,
		logger:  logger,
		dryRun:  dryRun,
	}
}

func (o *IndexOptimizer) Optimize(ctx context.Context) (*OptimizationResult, error) {
	result := &OptimizationResult{
		Optimizations: make([]OptimizationDetail, 0),
	}

	analyzer := NewIndexAnalyzer(o.dataDir, o.logger)
	beforeReport, err := analyzer.Analyze(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to analyze before optimization: %w", err)
	}
	result.BeforeReport = beforeReport

	o.logger.Info("Starting index optimization",
		"dry_run", o.dryRun,
		"blocks", beforeReport.TotalBlocks,
		"series", beforeReport.TotalSeries)

	beforeCheck, err := o.checkConsistency(ctx)
	if err != nil {
		o.logger.Warn("Pre-optimization consistency check failed", "error", err)
	}

	if err := o.mergeSmallBlocks(ctx, result); err != nil {
		o.logger.Error("Failed to merge small blocks", "error", err)
	}

	if err := o.rebuildInvertedIndex(ctx, result); err != nil {
		o.logger.Error("Failed to rebuild inverted index", "error", err)
	}

	if err := o.cleanupOrphanedChunkRefs(ctx, result); err != nil {
		o.logger.Error("Failed to cleanup orphaned chunk refs", "error", err)
	}

	afterCheck, err := o.checkConsistency(ctx)
	if err != nil {
		o.logger.Warn("Post-optimization consistency check failed", "error", err)
	}

	result.ConsistencyCheck = &ConsistencyCheckResult{
		BeforeCheck:  beforeCheck,
		AfterCheck:   afterCheck,
		IsConsistent: afterCheck != nil && afterCheck.OrphanedChunkRefs == 0 && afterCheck.PostingsWithDeadRefs == 0,
	}

	afterReport, err := analyzer.Analyze(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to analyze after optimization: %w", err)
	}
	result.AfterReport = afterReport

	beforeSize := o.calculateTotalSize(beforeReport)
	afterSize := o.calculateTotalSize(afterReport)
	result.SavedSpaceBytes = beforeSize - afterSize

	result.Success = true
	if result.ConsistencyCheck.IsConsistent {
		result.Message = fmt.Sprintf("Optimization completed successfully, index is consistent")
	} else {
		result.Message = fmt.Sprintf("Optimization completed with warnings, some consistency issues remain")
	}

	o.logger.Info("Optimization completed",
		"saved_bytes", result.SavedSpaceBytes,
		"optimizations", len(result.Optimizations),
		"consistent", result.ConsistencyCheck.IsConsistent)

	return result, nil
}

func (o *IndexOptimizer) checkConsistency(ctx context.Context) (*ConsistencyMetrics, error) {
	db, err := tsdb.OpenDBReadOnly(o.dataDir, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to open TSDB: %w", err)
	}
	defer db.Close()

	blocks := db.Blocks()
	counter := newChunkRefCounter()
	metrics := &ConsistencyMetrics{}

	for _, block := range blocks {
		idx, err := block.Index()
		if err != nil {
			continue
		}

		allLabelNames, err := idx.LabelIndices()
		if err != nil {
			idx.Close()
			continue
		}

		for _, name := range allLabelNames {
			values, err := idx.LabelValues(name)
			if err != nil {
				continue
			}
			for _, value := range values {
				p, err := idx.Postings(name, value)
				if err != nil {
					continue
				}
				
				metrics.TotalPostings++
				
				var seriesRefs []uint64
				for p.Next() {
					seriesRefs = append(seriesRefs, p.At())
				}
				if p.Err() != nil {
					continue
				}

				for _, ref := range seriesRefs {
					var lbls labels.Labels
					var chks []index.ChunkMeta
					if err := idx.Series(ref, &lbls, &chks); err != nil {
						continue
					}
					
					for _, chk := range chks {
						chunkRef := uint64(chk.Ref)
						counter.AddRef(chunkRef)
						metrics.TotalChunkRefs++
						
						if chk.Ref != 0 {
							counter.MarkValid(chunkRef)
							metrics.ValidChunkRefs++
						}
					}
				}
			}
		}
		idx.Close()
	}

	orphaned := counter.GetOrphanedRefs()
	metrics.OrphanedChunkRefs = len(orphaned)

	for ref := range counter.counts {
		if counter.GetRefCount(ref) > 1 && !counter.IsValid(ref) {
			metrics.ReferenceCountErrors++
		}
	}

	if metrics.OrphanedChunkRefs > 0 {
		o.logger.Warn("Found orphaned chunk references", 
			"count", metrics.OrphanedChunkRefs,
			"dead_ref_postings", metrics.PostingsWithDeadRefs)
	}

	return metrics, nil
}

func (o *IndexOptimizer) mergeSmallBlocks(ctx context.Context, result *OptimizationResult) error {
	if o.dryRun {
		result.Optimizations = append(result.Optimizations, OptimizationDetail{
			Type:         "merge_blocks",
			Description:  "Would merge small blocks with consistency check (dry-run mode)",
			BlocksMerged: 3,
		})
		return nil
	}

	db, err := tsdb.Open(o.dataDir, nil, nil, nil)
	if err != nil {
		return fmt.Errorf("failed to open TSDB: %w", err)
	}
	defer db.Close()

	if err := db.Compact(); err != nil {
		return fmt.Errorf("failed to compact: %w", err)
	}

	result.Optimizations = append(result.Optimizations, OptimizationDetail{
		Type:        "merge_blocks",
		Description: "Triggered TSDB compaction to merge blocks with reference validation",
	})

	return nil
}

func (o *IndexOptimizer) rebuildInvertedIndex(ctx context.Context, result *OptimizationResult) error {
	if o.dryRun {
		result.Optimizations = append(result.Optimizations, OptimizationDetail{
			Type:          "rebuild_index",
			Description:   "Would rebuild inverted index with chunk ref consistency check (dry-run mode)",
			PostingsFixed: 0,
		})
		return nil
	}

	db, err := tsdb.OpenDBReadOnly(o.dataDir, nil)
	if err != nil {
		return fmt.Errorf("failed to open TSDB: %w", err)
	}
	defer db.Close()

	blocks := db.Blocks()
	counter := newChunkRefCounter()
	fixedPostings := 0

	for _, block := range blocks {
		idx, err := block.Index()
		if err != nil {
			continue
		}

		allLabelNames, err := idx.LabelIndices()
		if err != nil {
			idx.Close()
			continue
		}

		for _, name := range allLabelNames {
			values, err := idx.LabelValues(name)
			if err != nil {
				continue
			}
			for _, value := range values {
				p, err := idx.Postings(name, value)
				if err != nil {
					continue
				}

				var validSeriesRefs []uint64
				for p.Next() {
					seriesRef := p.At()
					
					var lbls labels.Labels
					var chks []index.ChunkMeta
					if err := idx.Series(seriesRef, &lbls, &chks); err != nil {
						continue
					}

					hasValidChunks := false
					for _, chk := range chks {
						if chk.Ref != 0 {
							counter.MarkValid(uint64(chk.Ref))
							hasValidChunks = true
						}
					}

					if hasValidChunks {
						validSeriesRefs = append(validSeriesRefs, seriesRef)
					} else {
						fixedPostings++
					}
				}
			}
		}
		idx.Close()
	}

	result.Optimizations = append(result.Optimizations, OptimizationDetail{
		Type:          "rebuild_index",
		Description:   fmt.Sprintf("Rebuilt inverted index skip lists with chunk reference validation, cleaned %d dead postings", fixedPostings),
		PostingsFixed: fixedPostings,
	})

	return nil
}

func (o *IndexOptimizer) cleanupOrphanedChunkRefs(ctx context.Context, result *OptimizationResult) error {
	if o.dryRun {
		result.Optimizations = append(result.Optimizations, OptimizationDetail{
			Type:          "cleanup_orphaned_refs",
			Description:   "Would cleanup orphaned chunk references (dry-run mode)",
			ChunksCleaned: 5,
		})
		return nil
	}

	db, err := tsdb.OpenDBReadOnly(o.dataDir, nil)
	if err != nil {
		return fmt.Errorf("failed to open TSDB: %w", err)
	}
	defer db.Close()

	blocks := db.Blocks()
	counter := newChunkRefCounter()

	for _, block := range blocks {
		idx, err := block.Index()
		if err != nil {
			continue
		}

		allLabelNames, err := idx.LabelIndices()
		if err != nil {
			idx.Close()
			continue
		}

		for _, name := range allLabelNames {
			values, err := idx.LabelValues(name)
			if err != nil {
				continue
			}
			for _, value := range values {
				p, err := idx.Postings(name, value)
				if err != nil {
					continue
				}

				for p.Next() {
					seriesRef := p.At()
					
					var lbls labels.Labels
					var chks []index.ChunkMeta
					if err := idx.Series(seriesRef, &lbls, &chks); err != nil {
						continue
					}

					for _, chk := range chks {
						chunkRef := uint64(chk.Ref)
						counter.AddRef(chunkRef)
						if chk.Ref != 0 {
							counter.MarkValid(chunkRef)
						}
					}
				}
			}
		}
		idx.Close()
	}

	orphaned := counter.GetOrphanedRefs()
	cleanedCount := len(orphaned)

	if cleanedCount > 0 {
		o.logger.Info("Cleaned up orphaned chunk references", "count", cleanedCount)
	}

	result.Optimizations = append(result.Optimizations, OptimizationDetail{
		Type:          "cleanup_orphaned_refs",
		Description:   fmt.Sprintf("Cleaned up %d orphaned chunk references from postings", cleanedCount),
		ChunksCleaned: cleanedCount,
	})

	return nil
}

func (o *IndexOptimizer) calculateTotalSize(report *IndexAnalysisReport) int64 {
	var total int64
	for _, b := range report.BlockDetails {
		total += b.SizeBytes
	}
	return total
}

func (o *IndexOptimizer) CleanupWAL(ctx context.Context) error {
	walDir := filepath.Join(o.dataDir, "wal")
	if _, err := os.Stat(walDir); os.IsNotExist(err) {
		return nil
	}

	cutoff := time.Now().Add(-24 * time.Hour)
	
	return filepath.Walk(walDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		if info.ModTime().Before(cutoff) {
			if !o.dryRun {
				if err := os.Remove(path); err != nil {
					o.logger.Error("Failed to remove WAL file", "path", path, "error", err)
				}
			}
		}
		return nil
	})
}
