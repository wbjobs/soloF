package cli

import (
	"fmt"

	"github.com/prometheus-tsdb-manager/pkg/readahead"
	"github.com/spf13/cobra"
)

var (
	logDir      string
	maxMemoryMB int
	lruCapacity int
)

var cacheCmd = &cobra.Command{
	Use:   "cache",
	Short: "Manage intelligent read-ahead cache",
	Long:  `Commands for managing the intelligent read-ahead cache that predicts hot blocks based on query patterns.`,
}

var cacheStatsCmd = &cobra.Command{
	Use:   "stats",
	Short: "Show cache statistics",
	Run:   runCacheStats,
}

var cacheEnableCmd = &cobra.Command{
	Use:   "enable",
	Short: "Enable the read-ahead cache",
	Run:   runCacheEnable,
}

var cacheDisableCmd = &cobra.Command{
	Use:   "disable",
	Short: "Disable the read-ahead cache",
	Run:   runCacheDisable,
}

var cacheFlushCmd = &cobra.Command{
	Use:   "flush",
	Short: "Flush all cached data",
	Run:   runCacheFlush,
}

var cachePatternsCmd = &cobra.Command{
	Use:   "patterns",
	Short: "Show detected hot query patterns",
	Run:   runCachePatterns,
}

func init() {
	rootCmd.AddCommand(cacheCmd)
	cacheCmd.AddCommand(cacheStatsCmd)
	cacheCmd.AddCommand(cacheEnableCmd)
	cacheCmd.AddCommand(cacheDisableCmd)
	cacheCmd.AddCommand(cacheFlushCmd)
	cacheCmd.AddCommand(cachePatternsCmd)

	cacheCmd.PersistentFlags().StringVar(&logDir, "log-dir", "", "Directory containing Prometheus query logs")
	cacheCmd.PersistentFlags().IntVar(&maxMemoryMB, "max-memory", 512, "Maximum cache memory in MB")
	cacheCmd.PersistentFlags().IntVar(&lruCapacity, "lru-capacity", 50, "LRU cache capacity")
}

func getCacheManager() *readahead.CacheManager {
	config := readahead.DefaultPredictorConfig()
	config.MaxMemoryBytes = int64(maxMemoryMB) * 1024 * 1024
	config.LRUCapacity = lruCapacity

	manager := readahead.NewCacheManager(GetDataDir(), logDir, logger)
	manager.Initialize(config)

	return manager
}

func runCacheStats(cmd *cobra.Command, args []string) {
	manager := getCacheManager()
	stats := manager.GetStats()

	fmt.Println("=== Read-Ahead Cache Statistics ===")
	fmt.Printf("Cache Enabled:      %v\n", stats.CacheEnabled)
	fmt.Printf("Total Queries:      %d\n", stats.TotalQueries)
	fmt.Printf("Cache Hits:         %d\n", stats.Hits)
	fmt.Printf("Cache Misses:       %d\n", stats.Misses)
	fmt.Printf("Hit Rate:           %.2f%%\n", stats.HitRate*100)
	fmt.Printf("Evictions:          %d\n", stats.Evictions)
	fmt.Printf("Preloaded Blocks:   %d\n", stats.PreloadedBlocks)
	fmt.Printf("Memory Used:        %.1f MB\n", float64(stats.MemoryUsedBytes)/(1024*1024))
	fmt.Printf("Avg Load Time:      %.2f ms\n", stats.AvgLoadTimeMs)

	improvement := manager.GetPredictedLatencyImprovement()
	fmt.Printf("Latency Improvement:%.2f%% (P99 target: >30%%)\n", improvement)

	if improvement >= 30 {
		fmt.Println("\n✓ Target achieved! P99 latency reduction exceeds 30%")
	} else {
		fmt.Println("\n⚠ Target not yet achieved. Consider:")
		fmt.Println("  - Increasing query history size")
		fmt.Println("  - Adjusting max memory limit")
		fmt.Println("  - Waiting for more query patterns")
	}

	cachedBlocks := manager.GetCachedBlocks()
	fmt.Printf("\nCached Blocks (%d):\n", len(cachedBlocks))
	for _, block := range cachedBlocks {
		fmt.Printf("  - %s\n", block)
	}
}

func runCacheEnable(cmd *cobra.Command, args []string) {
	manager := getCacheManager()
	manager.Enable()
	fmt.Println("✓ Read-ahead cache enabled")
}

func runCacheDisable(cmd *cobra.Command, args []string) {
	manager := getCacheManager()
	manager.Disable()
	fmt.Println("✓ Read-ahead cache disabled")
}

func runCacheFlush(cmd *cobra.Command, args []string) {
	manager := getCacheManager()
	manager.Flush()
	fmt.Println("✓ Cache flushed successfully")
}

func runCachePatterns(cmd *cobra.Command, args []string) {
	manager := getCacheManager()
	patterns := manager.GetHotPatterns(20)

	fmt.Println("=== Detected Hot Query Patterns ===")
	if len(patterns) == 0 {
		fmt.Println("No patterns detected yet. Consider loading query logs.")
		return
	}

	fmt.Printf("%-50s %10s %12s %10s\n", "LABEL MATCHER", "COUNT", "RANGE (hrs)", "SCORE")
	fmt.Printf("%s\n", make([]byte, 88))
	for _, p := range patterns {
		matcher := p.LabelMatcher
		if len(matcher) > 48 {
			matcher = matcher[:45] + "..."
		}
		fmt.Printf("%-50s %10d %12.1f %10.3f\n",
			matcher, p.QueryCount, p.AvgRangeHours, p.HotScore)
	}

	hotCount := 0
	for _, p := range patterns {
		if p.HotScore >= 0.5 {
			hotCount++
		}
	}
	fmt.Printf("\nHot patterns (score >= 0.5): %d\n", hotCount)
}
