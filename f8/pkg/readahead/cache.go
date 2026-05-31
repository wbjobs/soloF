package readahead

import (
	"fmt"
	"os"
	"runtime"
	"sync/atomic"
	"time"
)

func DefaultPredictorConfig() PredictorConfig {
	return PredictorConfig{
		LookbackWindow:   7 * 24 * time.Hour,
		HotThreshold:     0.3,
		MinQueryCount:    5,
		PreloadAhead:     2 * time.Hour,
		MaxMemoryBytes:   512 * 1024 * 1024,
		LRUCapacity:      50,
		EnablePrediction: true,
		AutoTune:         true,
	}
}

func NewReadAheadCache(config PredictorConfig, logger Logger) *ReadAheadCache {
	return &ReadAheadCache{
		config:       config,
		cache:        make(map[string]*CachedIndex),
		lruList:      make([]string, 0, config.LRUCapacity),
		stats:        CacheStats{CacheEnabled: true},
		patterns:     make(map[string]*QueryPattern),
		queryHistory: make([]QueryLogEntry, 0, 10000),
		logger:       logger,
		stopChan:     make(chan struct{}),
		enabled:      true,
	}
}

func (c *ReadAheadCache) LoadQueryHistory(logDir string) error {
	parser := NewLogParser(c.logger, 10000)
	entries, err := parser.ScanLogsDir(logDir)
	if err != nil {
		return fmt.Errorf("failed to scan logs: %w", err)
	}

	c.Lock()
	defer c.Unlock()

	c.queryHistory = entries
	c.logger.Info("Loaded query history", "total_entries", len(entries))
	return nil
}

func (c *ReadAheadCache) AnalyzeAndPredict(blocks []BlockInfo) []*HotspotBlock {
	c.RLock()
	history := make([]QueryLogEntry, len(c.queryHistory))
	copy(history, c.queryHistory)
	c.RUnlock()

	predictor := NewQueryPredictor(c.config, c.logger)
	patterns := predictor.AnalyzePatterns(history)

	c.Lock()
	c.patterns = patterns
	c.Unlock()

	hotBlocks := predictor.PredictHotBlocks(patterns, blocks)
	return predictor.GetTopHotBlocks(hotBlocks, c.config.MaxMemoryBytes)
}

func (c *ReadAheadCache) PreloadHotBlocks(blocks []*HotspotBlock) error {
	preloaded := 0
	totalBytes := int64(0)

	for _, block := range blocks {
		if err := c.preloadBlock(block); err != nil {
			c.logger.Warn("Failed to preload block", "block_id", block.BlockID, "error", err)
			continue
		}
		preloaded++
		totalBytes += block.SizeBytes
	}

	c.Lock()
	c.stats.PreloadedBlocks = preloaded
	c.Unlock()

	c.logger.Info("Preloaded hot blocks",
		"count", preloaded,
		"total_mb", totalBytes/(1024*1024))
	return nil
}

func (c *ReadAheadCache) preloadBlock(block *HotspotBlock) error {
	c.Lock()
	defer c.Unlock()

	if _, exists := c.cache[block.BlockID]; exists {
		c.touch(block.BlockID)
		return nil
	}

	startTime := time.Now()
	mmapHandle, err := mmapFile(block.BlockID)
	if err != nil {
		return fmt.Errorf("mmap failed: %w", err)
	}

	cached := &CachedIndex{
		BlockID:    block.BlockID,
		IndexPath:  block.BlockID,
		LoadTime:   time.Now(),
		HitCount:   0,
		SizeBytes:  len(mmapHandle.Data),
		MmapHandle: mmapHandle,
	}

	c.cache[block.BlockID] = cached
	c.lruList = append(c.lruList, block.BlockID)
	c.stats.MemoryUsedBytes += int64(len(mmapHandle.Data))
	c.stats.AvgLoadTimeMs = (c.stats.AvgLoadTimeMs*float64(c.stats.PreloadedBlocks) +
		float64(time.Since(startTime).Milliseconds())) / float64(c.stats.PreloadedBlocks+1)

	c.evictLRU()
	return nil
}

func mmapFile(filePath string) (*MmapHandle, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	size := info.Size()

	data := make([]byte, size)
	n, err := file.Read(data)
	if err != nil {
		return nil, err
	}

	return &MmapHandle{
		Data:     data[:n],
		FilePath: filePath,
		Closed:   false,
	}, nil
}

func (c *ReadAheadCache) Get(blockID string) (*CachedIndex, bool) {
	c.RLock()
	defer c.RUnlock()

	cached, exists := c.cache[blockID]
	if exists {
		atomic.AddInt64(&cached.HitCount, 1)
		atomic.AddInt64(&c.stats.Hits, 1)
		go c.touchAsync(blockID)
	} else {
		atomic.AddInt64(&c.stats.Misses, 1)
	}

	atomic.AddInt64(&c.stats.TotalQueries, 1)
	return cached, exists
}

func (c *ReadAheadCache) touchAsync(blockID string) {
	c.Lock()
	defer c.Unlock()
	c.touch(blockID)
}

func (c *ReadAheadCache) touch(blockID string) {
	for i, id := range c.lruList {
		if id == blockID {
			c.lruList = append(c.lruList[:i], c.lruList[i+1:]...)
			break
		}
	}
	c.lruList = append(c.lruList, blockID)
}

func (c *ReadAheadCache) evictLRU() {
	for c.stats.MemoryUsedBytes > c.config.MaxMemoryBytes || len(c.cache) > c.config.LRUCapacity {
		if len(c.lruList) == 0 {
			break
		}

		evictID := c.lruList[0]
		c.lruList = c.lruList[1:]

		if cached, exists := c.cache[evictID]; exists {
			c.stats.Evictions++
			c.stats.MemoryUsedBytes -= int64(cached.SizeBytes)

			if cached.MmapHandle != nil {
				cached.MmapHandle.Closed = true
				cached.MmapHandle.Data = nil
				runtime.GC()
			}

			delete(c.cache, evictID)
			c.logger.Debug("Evicted block from cache", "block_id", evictID)
		}
	}
}

func (c *ReadAheadCache) GetStats() CacheStats {
	c.RLock()
	defer c.RUnlock()

	stats := c.stats
	if stats.Hits+stats.Misses > 0 {
		stats.HitRate = float64(stats.Hits) / float64(stats.Hits+stats.Misses)
	}
	return stats
}

func (c *ReadAheadCache) GetHotPatterns(limit int) []QueryPattern {
	c.RLock()
	defer c.RUnlock()

	var patterns []QueryPattern
	for _, p := range c.patterns {
		patterns = append(patterns, *p)
	}

	for i := range patterns {
		for j := i + 1; j < len(patterns); j++ {
			if patterns[j].HotScore > patterns[i].HotScore {
				patterns[i], patterns[j] = patterns[j], patterns[i]
			}
		}
	}

	if limit > 0 && len(patterns) > limit {
		patterns = patterns[:limit]
	}

	return patterns
}

func (c *ReadAheadCache) Flush() {
	c.Lock()
	defer c.Unlock()

	for _, cached := range c.cache {
		if cached.MmapHandle != nil {
			cached.MmapHandle.Closed = true
			cached.MmapHandle.Data = nil
		}
	}

	c.cache = make(map[string]*CachedIndex)
	c.lruList = make([]string, 0, c.config.LRUCapacity)
	c.stats = CacheStats{CacheEnabled: c.stats.CacheEnabled}

	runtime.GC()
	c.logger.Info("Cache flushed")
}

func (c *ReadAheadCache) Stop() {
	close(c.stopChan)
	c.Flush()
}

func (c *ReadAheadCache) Enable() {
	c.Lock()
	defer c.Unlock()
	c.enabled = true
	c.stats.CacheEnabled = true
	c.logger.Info("Read-ahead cache enabled")
}

func (c *ReadAheadCache) Disable() {
	c.Lock()
	defer c.Unlock()
	c.enabled = false
	c.stats.CacheEnabled = false
	c.Flush()
	c.logger.Info("Read-ahead cache disabled")
}

func (c *ReadAheadCache) IsEnabled() bool {
	c.RLock()
	defer c.RUnlock()
	return c.enabled
}
