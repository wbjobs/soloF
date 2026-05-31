package cli

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/prometheus-tsdb-manager/pkg/tsdb"
	"github.com/spf13/cobra"
)

var analyzeCmd = &cobra.Command{
	Use:   "analyze",
	Short: "Analyze Prometheus TSDB index status",
	Long:  `Analyze the current state of Prometheus TSDB including fragmentation rate, label statistics, and query hotspots.`,
	Run:   runAnalyze,
}

var (
	outputFormat string
	outputFile   string
)

func init() {
	rootCmd.AddCommand(analyzeCmd)
	analyzeCmd.Flags().StringVarP(&outputFormat, "format", "f", "table", "Output format (table|json)")
	analyzeCmd.Flags().StringVarP(&outputFile, "output", "o", "", "Output file path")
}

func runAnalyze(cmd *cobra.Command, args []string) {
	logger.Infof("Analyzing TSDB at: %s", GetDataDir())

	analyzer := tsdb.NewIndexAnalyzer(GetDataDir(), logger)
	report, err := analyzer.Analyze(GetContext())
	if err != nil {
		logger.Fatalf("Failed to analyze TSDB: %v", err)
	}

	switch outputFormat {
	case "json":
		outputJSON(report)
	case "table":
		fallthrough
	default:
		outputTable(report)
	}
}

func outputTable(report *tsdb.IndexAnalysisReport) {
	fmt.Println("=" + fmt.Sprintf("%070s", "") + "=")
	fmt.Println("                        PROMETHEUS TSDB INDEX ANALYSIS REPORT")
	fmt.Println("=" + fmt.Sprintf("%070s", "") + "=")
	fmt.Printf("Generated At:      %s\n", report.GeneratedAt.Format("2006-01-02 15:04:05"))
	fmt.Printf("Data Directory:    %s\n", report.DataDir)
	fmt.Println()

	fmt.Println("--- OVERALL STATISTICS ---")
	fmt.Printf("Total Blocks:      %d\n", report.TotalBlocks)
	fmt.Printf("Total Series:      %d\n", report.TotalSeries)
	fmt.Printf("Total Samples:     %d\n", report.TotalSamples)
	fmt.Printf("Estimated Delay:   %.2f ms\n", report.EstimatedDelay)
	fmt.Println()

	fmt.Println("--- FRAGMENTATION REPORT ---")
	fmt.Printf("Fragmentation Rate:  %.2f%%\n", report.Fragmentation.FragmentationRate*100)
	fmt.Printf("Small Blocks:        %d\n", report.Fragmentation.SmallBlocksCount)
	fmt.Printf("Orphaned Series:     %d\n", report.Fragmentation.OrphanedSeriesCount)
	fmt.Println()

	fmt.Println("--- LABEL STATISTICS ---")
	fmt.Printf("Unique Label Names:  %d\n", report.LabelStats.UniqueLabelNames)
	fmt.Printf("Total Label Pairs:   %d\n", report.LabelStats.TotalLabelPairs)
	fmt.Println()

	fmt.Println("--- QUERY HOTSPOTS ---")
	if len(report.Hotspots) == 0 {
		fmt.Println("No hotspots detected")
	} else {
		for i, hotspot := range report.Hotspots {
			fmt.Printf("%2d. %-40s (Series: %5d, Score: %.3f)\n",
				i+1, hotspot.LabelMatcher, hotspot.SeriesCount, hotspot.FrequencyScore)
		}
	}
	fmt.Println()

	fmt.Println("--- RECOMMENDATIONS ---")
	for i, rec := range report.Recommendations {
		fmt.Printf("%2d. %s\n", i+1, rec)
	}
	fmt.Println()

	fmt.Println("--- BLOCK DETAILS ---")
	fmt.Printf("%-26s %-12s %-10s %-10s %-10s %-8s %-12s\n",
		"ULID", "SERIES", "SAMPLES", "CHUNKS", "SIZE", "LEVEL", "FRAGMENTATION")
	for _, block := range report.BlockDetails {
		sizeMB := float64(block.SizeBytes) / (1024 * 1024)
		fmt.Printf("%-26s %-12d %-10d %-10d %7.1fMB %-8d %11.1f%%\n",
			block.ULID[:26], block.NumSeries, block.NumSamples,
			block.NumChunks, sizeMB, block.Compaction, block.Fragmentation*100)
	}
}

func outputJSON(report *tsdb.IndexAnalysisReport) {
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		logger.Fatalf("Failed to marshal JSON: %v", err)
	}

	if outputFile != "" {
		if err := os.WriteFile(outputFile, data, 0644); err != nil {
			logger.Fatalf("Failed to write output file: %v", err)
		}
		logger.Infof("Report written to: %s", outputFile)
	} else {
		fmt.Println(string(data))
	}
}
