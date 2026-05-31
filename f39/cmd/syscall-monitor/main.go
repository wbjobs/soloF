package main

import (
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
	"github.com/syscall-monitor/pkg/ebpf"
)

var rootCmd = &cobra.Command{
	Use:   "syscall-monitor",
	Short: "Monitor system calls using eBPF",
	Long:  `A CLI tool that uses eBPF to monitor system calls and print PID, Comm, Syscall Name, and Duration in real-time.`,
	Run:   runMonitor,
}

var (
	pidFlag    int
	statsFlag  bool
	quietFlag  bool
)

func init() {
	rootCmd.Flags().IntVarP(&pidFlag, "pid", "p", -1, "Target PID to monitor (default: all processes)")
	rootCmd.Flags().BoolVarP(&statsFlag, "stats", "s", false, "Enable statistics mode, print Top 10 syscalls on exit")
	rootCmd.Flags().BoolVarP(&quietFlag, "quiet", "q", false, "Quiet mode, only print statistics (use with --stats)")
}

func printStats(collector *ebpf.StatsCollector, startTime time.Time) {
	fmt.Println("\n" + strings.Repeat("=", 80))
	fmt.Println("SYSTEM CALL STATISTICS")
	fmt.Println(strings.Repeat("=", 80))

	duration := time.Since(startTime)
	totalCount := collector.GetTotalCount()
	fmt.Printf("Monitoring duration: %v\n", duration.Round(time.Millisecond))
	fmt.Printf("Total syscalls captured: %d\n", totalCount)
	fmt.Printf("Average rate: %.2f syscalls/sec\n\n", float64(totalCount)/duration.Seconds())

	topStats := collector.GetTopByTotalTime(10)
	if len(topStats) == 0 {
		fmt.Println("No syscall data captured.")
		return
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintf(w, "%-20s\t%10s\t%15s\t%12s\t%12s\t%12s\n",
		"SYSCALL", "COUNT", "TOTAL(ms)", "AVG(us)", "MIN(us)", "MAX(us)")
	fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\n",
		strings.Repeat("-", 20),
		strings.Repeat("-", 10),
		strings.Repeat("-", 15),
		strings.Repeat("-", 12),
		strings.Repeat("-", 12),
		strings.Repeat("-", 12))

	for _, s := range topStats {
		fmt.Fprintf(w, "%-20s\t%10d\t%15.3f\t%12.3f\t%12.3f\t%12.3f\n",
			s.SyscallName,
			s.Count,
			float64(s.TotalNs)/1e6,
			float64(s.AvgNs)/1e3,
			float64(s.MinNs)/1e3,
			float64(s.MaxNs)/1e3)
	}
	w.Flush()
}

func runMonitor(cmd *cobra.Command, args []string) {
	if os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Error: This program requires root privileges. Please run with sudo.")
		os.Exit(1)
	}

	monitor, err := ebpf.NewMonitor(pidFlag)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating monitor: %v\n", err)
		os.Exit(1)
	}
	defer monitor.Close()

	eventChan := make(chan *ebpf.Event, 1000)
	errChan := make(chan error, 10)

	go monitor.Run(eventChan, errChan)

	var collector *ebpf.StatsCollector
	var startTime time.Time
	if statsFlag {
		collector = ebpf.NewStatsCollector()
		startTime = time.Now()
		fmt.Println("System call monitor started (statistics mode enabled)")
		fmt.Println("Press Ctrl+C to stop and view statistics...\n")
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	var w *tabwriter.Writer
	if !quietFlag {
		w = tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintf(w, "%-8s\t%-16s\t%-20s\t%s\n", "PID", "COMM", "SYSCALL", "DURATION(ns)")
		fmt.Fprintf(w, "%-8s\t%-16s\t%-20s\t%s\n", strings.Repeat("-", 8), strings.Repeat("-", 16), strings.Repeat("-", 20), strings.Repeat("-", 12))
		w.Flush()
	}

	for {
		select {
		case <-sigChan:
			if statsFlag && collector != nil {
				printStats(collector, startTime)
			}
			return
		case event, ok := <-eventChan:
			if !ok {
				if statsFlag && collector != nil {
					printStats(collector, startTime)
				}
				return
			}

			syscallName := ebpf.GetSyscallName(event.SyscallNr)

			if statsFlag && collector != nil {
				collector.AddEvent(event, syscallName)
			}

			if !quietFlag {
				comm := event.CommString()
				fmt.Fprintf(w, "%-8d\t%-16s\t%-20s\t%d\n", event.PID, comm, syscallName, event.DurationNs)
				w.Flush()
			}
		case err, ok := <-errChan:
			if !ok {
				if statsFlag && collector != nil {
					printStats(collector, startTime)
				}
				return
			}
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			}
		}
	}
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
