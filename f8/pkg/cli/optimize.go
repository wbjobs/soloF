package cli

import (
	"encoding/json"
	"fmt"

	"github.com/prometheus-tsdb-manager/pkg/tsdb"
	"github.com/spf13/cobra"
)

var optimizeCmd = &cobra.Command{
	Use:   "optimize",
	Short: "Optimize Prometheus TSDB index structure",
	Long:  `Optimize Prometheus TSDB including merging small blocks, rebuilding inverted index, and cleaning up orphaned series.`,
	Run:   runOptimize,
}

func init() {
	rootCmd.AddCommand(optimizeCmd)
}

func runOptimize(cmd *cobra.Command, args []string) {
	logger.Infof("Starting TSDB optimization at: %s", GetDataDir())
	logger.Infof("Dry-run mode: %v", dryRun)

	optimizer := tsdb.NewIndexOptimizer(GetDataDir(), logger, dryRun)
	result, err := optimizer.Optimize(GetContext())
	if err != nil {
		logger.Fatalf("Optimization failed: %v", err)
	}

	fmt.Println()
	fmt.Println("=" + fmt.Sprintf("%070s", "") + "=")
	fmt.Println("                        OPTIMIZATION RESULTS")
	fmt.Println("=" + fmt.Sprintf("%070s", "") + "=")
	fmt.Println()

	fmt.Printf("Status:             %s\n", map[bool]string{true: "SUCCESS", false: "FAILED"}[result.Success])
	fmt.Printf("Message:            %s\n", result.Message)
	fmt.Printf("Saved Space:        %s\n", formatBytes(result.SavedSpaceBytes))
	fmt.Println()

	if result.ConsistencyCheck != nil {
		fmt.Println("--- CONSISTENCY CHECK RESULTS ---")
		if result.ConsistencyCheck.BeforeCheck != nil {
			fmt.Printf("  Before Optimization:\n")
			fmt.Printf("    Total Chunk Refs:    %d\n", result.ConsistencyCheck.BeforeCheck.TotalChunkRefs)
			fmt.Printf("    Valid Chunk Refs:    %d\n", result.ConsistencyCheck.BeforeCheck.ValidChunkRefs)
			fmt.Printf("    Orphaned Refs:       %d\n", result.ConsistencyCheck.BeforeCheck.OrphanedChunkRefs)
			fmt.Printf("    Total Postings:      %d\n", result.ConsistencyCheck.BeforeCheck.TotalPostings)
			fmt.Printf("    Ref Count Errors:    %d\n", result.ConsistencyCheck.BeforeCheck.ReferenceCountErrors)
		}
		if result.ConsistencyCheck.AfterCheck != nil {
			fmt.Printf("  After Optimization:\n")
			fmt.Printf("    Total Chunk Refs:    %d\n", result.ConsistencyCheck.AfterCheck.TotalChunkRefs)
			fmt.Printf("    Valid Chunk Refs:    %d\n", result.ConsistencyCheck.AfterCheck.ValidChunkRefs)
			fmt.Printf("    Orphaned Refs:       %d\n", result.ConsistencyCheck.AfterCheck.OrphanedChunkRefs)
			fmt.Printf("    Total Postings:      %d\n", result.ConsistencyCheck.AfterCheck.TotalPostings)
			fmt.Printf("    Ref Count Errors:    %d\n", result.ConsistencyCheck.AfterCheck.ReferenceCountErrors)
		}
		fmt.Printf("  Index Consistent:   %v\n", result.ConsistencyCheck.IsConsistent)
		fmt.Println()
	}

	fmt.Println("--- PERFORMED OPTIMIZATIONS ---")
	for i, opt := range result.Optimizations {
		extra := ""
		if opt.PostingsFixed > 0 {
			extra = fmt.Sprintf(" (fixed %d postings)", opt.PostingsFixed)
		}
		if opt.ChunksCleaned > 0 {
			extra = fmt.Sprintf(" (cleaned %d chunks)", opt.ChunksCleaned)
		}
		fmt.Printf("%2d. [%s] %s%s\n", i+1, opt.Type, opt.Description, extra)
	}
	fmt.Println()

	if result.BeforeReport != nil && result.AfterReport != nil {
		fmt.Println("--- BEFORE / AFTER COMPARISON ---")
		fmt.Printf("Metrics                          Before               After                Change\n")
		fmt.Printf("-------                          ------               -----                ------\n")
		printComparison("Total Blocks",
			fmt.Sprintf("%d", result.BeforeReport.TotalBlocks),
			fmt.Sprintf("%d", result.AfterReport.TotalBlocks))
		printComparison("Total Series",
			fmt.Sprintf("%d", result.BeforeReport.TotalSeries),
			fmt.Sprintf("%d", result.AfterReport.TotalSeries))
		printComparison("Fragmentation Rate",
			fmt.Sprintf("%.2f%%", result.BeforeReport.Fragmentation.FragmentationRate*100),
			fmt.Sprintf("%.2f%%", result.AfterReport.Fragmentation.FragmentationRate*100))
		printComparison("Estimated Query Delay",
			fmt.Sprintf("%.2f ms", result.BeforeReport.EstimatedDelay),
			fmt.Sprintf("%.2f ms", result.AfterReport.EstimatedDelay))
	}

	fmt.Println()
}

func printComparison(label, before, after string) {
	fmt.Printf("%-32s %-20s %-20s\n", label, before, after)
}

func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

func outputJSONResult(result *tsdb.OptimizationResult) {
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		logger.Fatalf("Failed to marshal JSON: %v", err)
	}
	fmt.Println(string(data))
}
