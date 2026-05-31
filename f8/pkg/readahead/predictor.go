package readahead

import (
	"math"
	"sort"
	"time"
)

type QueryPredictor struct {
	config  PredictorConfig
	logger  Logger
}

func NewQueryPredictor(config PredictorConfig, logger Logger) *QueryPredictor {
	return &QueryPredictor{
		config: config,
		logger: logger,
	}
}

func (p *QueryPredictor) AnalyzePatterns(queries []QueryLogEntry) map[string]*QueryPattern {
	patterns := make(map[string]*QueryPattern)

	for _, q := range queries {
		if time.Since(q.Timestamp) > p.config.LookbackWindow {
			continue
		}

		for _, matcher := range q.LabelMatchers {
			if _, exists := patterns[matcher]; !exists {
				patterns[matcher] = &QueryPattern{
					LabelMatcher: matcher,
					LastAccessed: q.Timestamp,
				}
			}
			pattern := patterns[matcher]
			pattern.QueryCount++

			if q.TimeRange.End > q.TimeRange.Start {
				rangeHours := float64(q.TimeRange.End-q.TimeRange.Start) / float64(time.Hour.Milliseconds())
				pattern.AvgRangeHours = (pattern.AvgRangeHours*float64(pattern.QueryCount-1) + rangeHours) / float64(pattern.QueryCount)
			}

			if q.Timestamp.After(pattern.LastAccessed) {
				pattern.LastAccessed = q.Timestamp
			}
		}
	}

	for _, pattern := range patterns {
		pattern.HotScore = p.calculateHotScore(pattern)
	}

	p.logger.Info("Analyzed query patterns", "total_patterns", len(patterns))
	return patterns
}

func (p *QueryPredictor) calculateHotScore(pattern *QueryPattern) float64 {
	recencyWeight := 1.0
	if !pattern.LastAccessed.IsZero() {
		hoursSinceAccess := time.Since(pattern.LastAccessed).Hours()
		recencyWeight = math.Exp(-hoursSinceAccess / 24.0)
	}

	frequencyWeight := math.Min(float64(pattern.QueryCount)/float64(p.config.MinQueryCount), 1.0)
	rangeWeight := math.Min(pattern.AvgRangeHours/24.0, 1.0)

	return 0.5*frequencyWeight + 0.3*recencyWeight + 0.2*rangeWeight
}

func (p *QueryPredictor) PredictHotBlocks(
	patterns map[string]*QueryPattern,
	blocks []BlockInfo,
) []*HotspotBlock {
	hotBlocks := make([]*HotspotBlock, 0)

	for _, block := range blocks {
		hitCount := 0
		totalScore := 0.0

		for _, pattern := range patterns {
			if pattern.HotScore >= p.config.HotThreshold {
				patternEnd := pattern.LastAccessed.UnixMilli()
				patternStart := patternEnd - int64(pattern.AvgRangeHours*float64(time.Hour.Milliseconds()))

				if p.timeRangesOverlap(patternStart, patternEnd, block.MinTime, block.MaxTime) {
					hitCount++
					totalScore += pattern.HotScore
				}
			}
		}

		if hitCount > 0 {
			predictedHits := p.predictFutureHits(hitCount, totalScore)
			hotBlocks = append(hotBlocks, &HotspotBlock{
				BlockID:       block.ULID,
				MinTime:       block.MinTime,
				MaxTime:       block.MaxTime,
				HitCount:      hitCount,
				HotScore:      totalScore / float64(hitCount),
				PredictedHits: predictedHits,
				SizeBytes:     block.SizeBytes,
			})
		}
	}

	sort.Slice(hotBlocks, func(i, j int) bool {
		return hotBlocks[i].HotScore > hotBlocks[j].HotScore
	})

	p.logger.Info("Predicted hot blocks", "count", len(hotBlocks))
	return hotBlocks
}

func (p *QueryPredictor) timeRangesOverlap(start1, end1, start2, end2 int64) bool {
	return start1 < end2 && end1 > start2
}

func (p *QueryPredictor) predictFutureHits(hitCount int, totalScore float64) int {
	baseHits := float64(hitCount) * totalScore
	timeDecay := 1.0
	if p.config.EnablePrediction {
		timeDecay = 1.2
	}
	return int(baseHits * timeDecay)
}

func (p *QueryPredictor) GetTopHotBlocks(hotBlocks []*HotspotBlock, maxMemory int64) []*HotspotBlock {
	if len(hotBlocks) == 0 {
		return hotBlocks
	}

	var selected []*HotspotBlock
	totalSize := int64(0)

	for _, block := range hotBlocks {
		if totalSize+block.SizeBytes > maxMemory {
			break
		}
		selected = append(selected, block)
		totalSize += block.SizeBytes
	}

	p.logger.Info("Selected blocks for preload", "count", len(selected), "memory_mb", totalSize/(1024*1024))
	return selected
}

func (p *QueryPredictor) DetectTimeSeriesHotspots(queries []QueryLogEntry) []TimeRange {
	timeBuckets := make(map[int64]int)
	windowSize := int64(time.Hour.Milliseconds())

	for _, q := range queries {
		if time.Since(q.Timestamp) > p.config.LookbackWindow {
			continue
		}
		if !q.IsRangeQuery {
			continue
		}

		startBucket := (q.TimeRange.Start / windowSize) * windowSize
		endBucket := (q.TimeRange.End / windowSize) * windowSize

		for bucket := startBucket; bucket <= endBucket; bucket += windowSize {
			timeBuckets[bucket]++
		}
	}

	var hotRanges []TimeRange
	for bucket, count := range timeBuckets {
		if count >= p.config.MinQueryCount {
			hotRanges = append(hotRanges, TimeRange{
				Start:      bucket,
				End:        bucket + windowSize,
				Resolution: "1h",
			})
		}
	}

	sort.Slice(hotRanges, func(i, j int) bool {
		return hotRanges[i].Start < hotRanges[j].Start
	})

	return hotRanges
}

func (p *QueryPredictor) AutoTune(histStats CacheStats) PredictorConfig {
	newConfig := p.config

	if histStats.HitRate < 0.7 && histStats.TotalQueries > 100 {
		newConfig.MaxMemoryBytes = int64(float64(newConfig.MaxMemoryBytes) * 1.2)
		newConfig.LRUCapacity = int(float64(newConfig.LRUCapacity) * 1.2)
		p.logger.Info("Auto-tuning: increased cache size due to low hit rate",
			"hit_rate", histStats.HitRate,
			"new_max_memory_mb", newConfig.MaxMemoryBytes/(1024*1024))
	} else if histStats.HitRate > 0.95 && histStats.TotalQueries > 100 {
		newConfig.MaxMemoryBytes = int64(float64(newConfig.MaxMemoryBytes) * 0.9)
		newConfig.LRUCapacity = int(float64(newConfig.LRUCapacity) * 0.9)
		p.logger.Info("Auto-tuning: decreased cache size due to high hit rate",
			"hit_rate", histStats.HitRate,
			"new_max_memory_mb", newConfig.MaxMemoryBytes/(1024*1024))
	}

	return newConfig
}
