package readahead

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"
	"time"
)

type CacheManager struct {
	sync.RWMutex
	dataDir     string
	logDir      string
	cache       *ReadAheadCache
	logger      Logger
	refreshChan chan struct{}
	running     bool
}

func NewCacheManager(dataDir, logDir string, logger Logger) *CacheManager {
	return &CacheManager{
		dataDir:     dataDir,
		logDir:      logDir,
		logger:      logger,
		refreshChan: make(chan struct{}, 1),
	}
}

func (m *CacheManager) Initialize(config PredictorConfig) error {
	m.Lock()
	defer m.Unlock()

	m.cache = NewReadAheadCache(config, m.logger)

	if m.logDir != "" {
		if err := m.cache.LoadQueryHistory(m.logDir); err != nil {
			m.logger.Warn("Failed to load query history", "error", err)
		}
	}

	m.running = true
	go m.backgroundRefreshLoop()

	m.logger.Info("Cache manager initialized",
		"max_memory_mb", config.MaxMemoryBytes/(1024*1024),
		"lru_capacity", config.LRUCapacity)
	return nil
}

func (m *CacheManager) backgroundRefreshLoop() {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			m.triggerRefresh()
		case <-m.refreshChan:
			m.performRefresh()
		}
	}
}

func (m *CacheManager) triggerRefresh() {
	select {
	case m.refreshChan <- struct{}{}:
	default:
	}
}

func (m *CacheManager) performRefresh() {
	m.logger.Debug("Starting background cache refresh")

	blocks := m.discoverBlocks()
	hotBlocks := m.cache.AnalyzeAndPredict(blocks)

	if err := m.cache.PreloadHotBlocks(hotBlocks); err != nil {
		m.logger.Error("Preload failed", "error", err)
	}

	stats := m.cache.GetStats()
	m.logger.Info("Cache refresh completed",
		"hit_rate", fmt.Sprintf("%.2f%%", stats.HitRate*100),
		"preloaded_blocks", stats.PreloadedBlocks,
		"memory_mb", stats.MemoryUsedBytes/(1024*1024))
}

func (m *CacheManager) discoverBlocks() []BlockInfo {
	var blocks []BlockInfo

	blockDirs, err := filepath.Glob(filepath.Join(m.dataDir, "01*"))
	if err != nil {
		m.logger.Error("Failed to discover blocks", "error", err)
		return blocks
	}

	for _, dir := range blockDirs {
		blockID := filepath.Base(dir)
		indexPath := filepath.Join(dir, "index")

		info := BlockInfo{
			ULID:      blockID,
			IndexPath:  indexPath,
			MinTime:    0,
			MaxTime:    0,
			NumSeries:  1000,
			SizeBytes:  1024 * 1024,
		}
		blocks = append(blocks, info)
	}

	return blocks
}

func (m *CacheManager) TriggerPreload(queries []QueryLogEntry) int {
	m.Lock()
	defer m.Unlock()

	for _, q := range queries {
		m.cache.queryHistory = append(m.cache.queryHistory, q)
	}

	blocks := m.discoverBlocks()
	hotBlocks := m.cache.AnalyzeAndPredict(blocks)

	if err := m.cache.PreloadHotBlocks(hotBlocks); err != nil {
		m.logger.Error("Preload failed", "error", err)
	}

	return len(hotBlocks)
}

func (m *CacheManager) GetStats() CacheStats {
	m.RLock()
	defer m.RUnlock()

	if m.cache == nil {
		return CacheStats{}
	}
	return m.cache.GetStats()
}

func (m *CacheManager) GetHotPatterns(limit int) []QueryPattern {
	m.RLock()
	defer m.RUnlock()

	if m.cache == nil {
		return []QueryPattern{}
	}
	return m.cache.GetHotPatterns(limit)
}

func (m *CacheManager) Flush() {
	m.RLock()
	defer m.RUnlock()

	if m.cache != nil {
		m.cache.Flush()
	}
}

func (m *CacheManager) Enable() {
	m.RLock()
	defer m.RUnlock()

	if m.cache != nil {
		m.cache.Enable()
	}
}

func (m *CacheManager) Disable() {
	m.RLock()
	defer m.RUnlock()

	if m.cache != nil {
		m.cache.Disable()
	}
}

func (m *CacheManager) IsEnabled() bool {
	m.RLock()
	defer m.RUnlock()

	if m.cache == nil {
		return false
	}
	return m.cache.IsEnabled()
}

func (m *CacheManager) GetCachedBlocks() []string {
	m.RLock()
	defer m.RUnlock()

	if m.cache == nil {
		return []string{}
	}

	blocks := make([]string, 0, len(m.cache.cache))
	for id := range m.cache.cache {
		blocks = append(blocks, id)
	}
	return blocks
}

func (m *CacheManager) Stop() {
	m.Lock()
	defer m.Unlock()

	if m.cache != nil {
		m.cache.Stop()
	}
	m.running = false
}

func (m *CacheManager) GetPredictedLatencyImprovement() float64 {
	stats := m.GetStats()

	if stats.TotalQueries == 0 {
		return 0.0
	}

	baseLatency := 100.0
	cacheHitLatency := 5.0

	avgLatency := stats.HitRate*cacheHitLatency + (1-stats.HitRate)*baseLatency
	improvement := (baseLatency - avgLatency) / baseLatency * 100

	return improvement
}
