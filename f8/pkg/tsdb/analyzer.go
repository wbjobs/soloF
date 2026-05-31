package tsdb

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/tsdb"
	"github.com/prometheus/prometheus/tsdb/chunkenc"
	"github.com/prometheus/prometheus/tsdb/index"
)

type IndexAnalysisReport struct {
	GeneratedAt     time.Time              `json:"generated_at"`
	DataDir         string                 `json:"data_dir"`
	TotalBlocks     int                    `json:"total_blocks"`
	TotalSeries     int                    `json:"total_series"`
	TotalSamples    int64                  `json:"total_samples"`
	Fragmentation   FragmentationReport    `json:"fragmentation"`
	LabelStats      LabelStatistics        `json:"label_stats"`
	Hotspots        []QueryHotspot         `json:"hotspots"`
	EstimatedDelay  float64                `json:"estimated_query_delay_ms"`
	BlockDetails    []BlockInfo            `json:"block_details"`
	Recommendations []string               `json:"recommendations"`
}

type FragmentationReport struct {
	FragmentationRate      float64 `json:"fragmentation_rate"`
	SmallBlocksCount       int     `json:"small_blocks_count"`
	OrphanedSeriesCount    int     `json:"orphaned_series_count"`
	DuplicatePostingsCount int     `json:"duplicate_postings_count"`
}

type LabelStatistics struct {
	TotalLabelPairs   int               `json:"total_label_pairs"`
	UniqueLabelNames  int               `json:"unique_label_names"`
	TopLabelValues    map[string][]string `json:"top_label_values"`
	DuplicateValues   map[string]int     `json:"duplicate_values"`
}

type QueryHotspot struct {
	LabelMatcher   string  `json:"label_matcher"`
	SeriesCount    int     `json:"series_count"`
	FrequencyScore float64 `json:"frequency_score"`
}

type BlockInfo struct {
	ULID         string    `json:"ulid"`
	MinTime      int64     `json:"min_time"`
	MaxTime      int64     `json:"max_time"`
	NumSeries    int       `json:"num_series"`
	NumSamples   int64     `json:"num_samples"`
	NumChunks    int       `json:"num_chunks"`
	SizeBytes    int64     `json:"size_bytes"`
	Compaction   int       `json:"compaction_level"`
	Fragmentation float64  `json:"fragmentation"`
}

type IndexAnalyzer struct {
	dataDir string
	logger  Logger
}

type Logger interface {
	Info(msg string, fields ...interface{})
	Warn(msg string, fields ...interface{})
	Error(msg string, fields ...interface{})
}

func NewIndexAnalyzer(dataDir string, logger Logger) *IndexAnalyzer {
	return &IndexAnalyzer{
		dataDir: dataDir,
		logger:  logger,
	}
}

func (a *IndexAnalyzer) Analyze(ctx context.Context) (*IndexAnalysisReport, error) {
	report := &IndexAnalysisReport{
		GeneratedAt: time.Now(),
		DataDir:     a.dataDir,
	}

	db, err := tsdb.OpenDBReadOnly(a.dataDir, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to open TSDB: %w", err)
	}
	defer db.Close()

	blocks := db.Blocks()
	report.TotalBlocks = len(blocks)

	blockDetails := make([]BlockInfo, 0, len(blocks))
	labelValues := make(map[string]map[string]int)
	allSeries := make(map[uint64]labels.Labels)
	seriesCount := 0
	totalSamples := int64(0)
	smallBlocks := 0

	for _, b := range blocks {
		meta := b.Meta()
		blockSize, _ := dirSize(filepath.Join(a.dataDir, meta.ULID.String()))

		blockInfo := BlockInfo{
			ULID:         meta.ULID.String(),
			MinTime:      meta.MinTime,
			MaxTime:      meta.MaxTime,
			NumSeries:    meta.Stats.NumSeries,
			NumSamples:   meta.Stats.NumSamples,
			NumChunks:    meta.Stats.NumChunks,
			SizeBytes:    blockSize,
			Compaction:   meta.Compaction.Level,
			Fragmentation: calculateBlockFragmentation(meta),
		}

		blockDetails = append(blockDetails, blockInfo)

		seriesCount += meta.Stats.NumSeries
		totalSamples += meta.Stats.NumSamples

		if meta.Stats.NumSeries < 1000 {
			smallBlocks++
		}

		idx, err := b.Index()
		if err != nil {
			continue
		}

		allKeys, _ := idx.LabelIndices()
		for _, key := range allKeys {
			values, _ := idx.LabelValues(key)
			if labelValues[key] == nil {
				labelValues[key] = make(map[string]int)
			}
			for _, v := range values {
				labelValues[key][v]++
			}
		}

		idx.Close()
	}

	report.TotalSeries = seriesCount
	report.TotalSamples = totalSamples
	report.BlockDetails = blockDetails

	fragmentationRate := a.calculateFragmentationRate(blockDetails, seriesCount)
	report.Fragmentation = FragmentationReport{
		FragmentationRate:   fragmentationRate,
		SmallBlocksCount:    smallBlocks,
		OrphanedSeriesCount: a.detectOrphanedSeries(blocks),
	}

	report.LabelStats = a.analyzeLabels(labelValues)
	report.Hotspots = a.detectHotspots(labelValues, seriesCount)
	report.EstimatedDelay = a.estimateQueryDelay(fragmentationRate, seriesCount)
	report.Recommendations = a.generateRecommendations(report)

	return report, nil
}

func (a *IndexAnalyzer) calculateFragmentationRate(blocks []BlockInfo, totalSeries int) float64 {
	if totalSeries == 0 {
		return 0
	}

	totalFragmentation := 0.0
	for _, b := range blocks {
		totalFragmentation += b.Fragmentation
	}

	return totalFragmentation / float64(len(blocks))
}

func calculateBlockFragmentation(meta tsdb.BlockMeta) float64 {
	expectedSeriesPerChunk := 100.0
	actualSeriesPerChunk := float64(meta.Stats.NumSeries) / float64(meta.Stats.NumChunks+1)
	
	if actualSeriesPerChunk == 0 {
		return 0
	}

	fragmentation := 1.0 - (actualSeriesPerChunk / expectedSeriesPerChunk)
	if fragmentation < 0 {
		fragmentation = 0
	}
	return fragmentation
}

func (a *IndexAnalyzer) detectOrphanedSeries(blocks []tsdb.Block) int {
	return 0
}

func (a *IndexAnalyzer) analyzeLabels(labelValues map[string]map[string]int) LabelStatistics {
	stats := LabelStatistics{
		TopLabelValues:  make(map[string][]string),
		DuplicateValues: make(map[string]int),
	}

	totalPairs := 0
	for name, values := range labelValues {
		totalPairs += len(values)

		type valueCount struct {
			value string
			count int
		}
		var sorted []valueCount
		for v, c := range values {
			sorted = append(sorted, valueCount{v, c})
			if c > 1 {
				stats.DuplicateValues[name] += c - 1
			}
		}

		sort.Slice(sorted, func(i, j int) bool {
			return sorted[i].count > sorted[j].count
		})

		topN := 5
		if len(sorted) < topN {
			topN = len(sorted)
		}
		for i := 0; i < topN; i++ {
			stats.TopLabelValues[name] = append(stats.TopLabelValues[name], sorted[i].value)
		}
	}

	stats.TotalLabelPairs = totalPairs
	stats.UniqueLabelNames = len(labelValues)

	return stats
}

func (a *IndexAnalyzer) detectHotspots(labelValues map[string]map[string]int, totalSeries int) []QueryHotspot {
	var hotspots []QueryHotspot

	for name, values := range labelValues {
		for value, count := range values {
			ratio := float64(count) / float64(totalSeries)
			if ratio > 0.1 {
				hotspots = append(hotspots, QueryHotspot{
					LabelMatcher:   fmt.Sprintf("%s=%q", name, value),
					SeriesCount:    count,
					FrequencyScore: ratio,
				})
			}
		}
	}

	sort.Slice(hotspots, func(i, j int) bool {
		return hotspots[i].FrequencyScore > hotspots[j].FrequencyScore
	})

	if len(hotspots) > 10 {
		hotspots = hotspots[:10]
	}

	return hotspots
}

func (a *IndexAnalyzer) estimateQueryDelay(fragmentationRate float64, totalSeries int) float64 {
	baseDelay := 10.0
	fragmentationFactor := fragmentationRate * 50.0
	seriesFactor := math.Log(float64(totalSeries+1)) * 2.0

	return baseDelay + fragmentationFactor + seriesFactor
}

func (a *IndexAnalyzer) generateRecommendations(report *IndexAnalysisReport) []string {
	var recs []string

	if report.Fragmentation.FragmentationRate > 0.3 {
		recs = append(recs, 
			fmt.Sprintf("高碎片率 (%.1f%%)，建议立即执行索引重构", report.Fragmentation.FragmentationRate*100))
	}

	if report.Fragmentation.SmallBlocksCount > 5 {
		recs = append(recs,
			fmt.Sprintf("检测到 %d 个小块，建议合并以提高查询性能", report.Fragmentation.SmallBlocksCount))
	}

	if len(report.Hotspots) > 3 {
		recs = append(recs,
			fmt.Sprintf("检测到 %d 个查询热点，考虑优化标签设计", len(report.Hotspots)))
	}

	if report.EstimatedDelay > 100 {
		recs = append(recs,
			fmt.Sprintf("预估查询延迟较高 (%.1fms)，建议优化索引结构", report.EstimatedDelay))
	}

	if len(recs) == 0 {
		recs = append(recs, "索引状态良好，无需立即优化")
	}

	return recs
}

func dirSize(path string) (int64, error) {
	var size int64
	err := filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			size += info.Size()
		}
		return nil
	})
	return size, err
}
