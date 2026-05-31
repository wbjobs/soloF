package readahead

import (
	"context"
	"sync"
	"time"
)

type CacheStats struct {
	Hits              int64   `json:"hits"`
	Misses            int64   `json:"misses"`
	Evictions         int64   `json:"evictions"`
	PreloadedBlocks   int     `json:"preloaded_blocks"`
	MemoryUsedBytes   int64   `json:"memory_used_bytes"`
	HitRate           float64 `json:"hit_rate"`
	AvgLoadTimeMs     float64 `json:"avg_load_time_ms"`
	TotalQueries      int64   `json:"total_queries"`
	CacheEnabled      bool    `json:"cache_enabled"`
}

type QueryPattern struct {
	LabelMatcher    string    `json:"label_matcher"`
	QueryCount      int       `json:"query_count"`
	LastAccessed    time.Time `json:"last_accessed"`
	AvgRangeHours   float64   `json:"avg_range_hours"`
	HotScore        float64   `json:"hot_score"`
}

type TimeRange struct {
	Start      int64  `json:"start"`
	End        int64  `json:"end"`
	Resolution string `json:"resolution"`
}

type HotspotBlock struct {
	BlockID       string        `json:"block_id"`
	MinTime       int64         `json:"min_time"`
	MaxTime       int64         `json:"max_time"`
	HitCount      int           `json:"hit_count"`
	HotScore      float64       `json:"hot_score"`
	PredictedHits int           `json:"predicted_hits"`
	SizeBytes     int64         `json:"size_bytes"`
	LoadDuration  time.Duration `json:"load_duration"`
}

type CachedIndex struct {
	BlockID       string
	IndexPath     string
	Data          *[]byte
	RefCount      int32
	LoadTime      time.Time
	HitCount      int64
	SizeBytes     int
	MmapHandle    *MmapHandle
}

type MmapHandle struct {
	Data     []byte
	FilePath string
	Closed   bool
}

type QueryLogEntry struct {
	Timestamp     time.Time
	Query         string
	LabelMatchers []string
	TimeRange     TimeRange
	Step          time.Duration
	Duration      time.Duration
	SeriesCount   int
	IsRangeQuery  bool
}

type PredictorConfig struct {
	LookbackWindow     time.Duration
	HotThreshold       float64
	MinQueryCount      int
	PreloadAhead       time.Duration
	MaxMemoryBytes     int64
	LRUCapacity        int
	EnablePrediction   bool
	AutoTune           bool
}

type ReadAheadCache struct {
	sync.RWMutex
	config        PredictorConfig
	cache         map[string]*CachedIndex
	lruList       []string
	stats         CacheStats
	patterns      map[string]*QueryPattern
	hotBlocks     []*HotspotBlock
	queryHistory  []QueryLogEntry
	logger        Logger
	stopChan      chan struct{}
	enabled       bool
}

type BlockInfo struct {
	ULID         string
	MinTime      int64
	MaxTime      int64
	NumSeries    int
	NumSamples   int64
	SizeBytes    int64
	IndexPath    string
}

type Logger interface {
	Info(msg string, fields ...interface{})
	Warn(msg string, fields ...interface{})
	Error(msg string, fields ...interface{})
	Debug(msg string, fields ...interface{})
}
