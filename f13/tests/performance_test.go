package main

import (
	"fmt"
	"math"
	"math/rand"
	"strings"
	"time"

	"anomaly-detection-service/internal/detection"
)

func generateHighFrequencyData(durationHours int, frequencyHz int) ([]float64, []time.Time) {
	n := durationHours * 3600 * frequencyHz
	data := make([]float64, n)
	timestamps := make([]time.Time, n)
	baseTime := time.Now()

	for i := 0; i < n; i++ {
		secondOfDay := i % (3600 * 24)
		hourOffset := float64(secondOfDay%3600) / 3600.0
		seasonal := 50.0 + 20.0*math.Sin(2*math.Pi*hourOffset) + 10.0*math.Sin(2*math.Pi*float64(secondOfDay)/(3600*24))
		noise := rand.NormFloat64() * 3.0
		data[i] = seasonal + noise

		if i%(frequencyHz*600) == 0 && i > 0 {
			data[i] = seasonal + noise + 50.0
		}

		timestamps[i] = baseTime.Add(time.Duration(i*1000/frequencyHz) * time.Millisecond)
	}

	return data, timestamps
}

func runPerformanceTest(name string, detector *detection.Detector, data []float64, timestamps []time.Time, fn func(*detection.Detector, []float64, []time.Time) []detection.AnomalyResult) {
	start := time.Now()
	results := fn(detector, data, timestamps)
	duration := time.Since(start)

	fmt.Printf("%-25s | %8.3f ms | %6d anomalies | %8.2f points/sec\n",
		name,
		float64(duration.Nanoseconds())/1e6,
		len(results),
		float64(len(data))/duration.Seconds())
}

func main() {
	fmt.Println("=== Performance Test for Anomaly Detection Algorithms ===")
	fmt.Println()
	fmt.Println("Testing configuration:")
	fmt.Println("  - 1 hour of data @ 1000 Hz = 3,600,000 points")
	fmt.Println("  - Target: < 2 seconds total")
	fmt.Println()

	detector := detection.NewDetector()
	data, timestamps := generateHighFrequencyData(1, 1000)

	fmt.Printf("Generated %d data points\n\n", len(data))

	fmt.Println("Algorithm Performance:")
	fmt.Println(strings.Repeat("-", 90))

	runPerformanceTest("3-Sigma (O(n))", detector, data, timestamps,
		func(d *detection.Detector, d2 []float64, t []time.Time) []detection.AnomalyResult {
			return d.DetectThreeSigma(d2, t)
		})

	runPerformanceTest("Moving Average (O(n))", detector, data, timestamps,
		func(d *detection.Detector, d2 []float64, t []time.Time) []detection.AnomalyResult {
			return d.DetectMovingAverage(d2, t, 1000)
		})

	runPerformanceTest("Seasonal (O(n))", detector, data, timestamps,
		func(d *detection.Detector, d2 []float64, t []time.Time) []detection.AnomalyResult {
			return d.DetectSeasonal(d2, t, 3600)
		})

	fmt.Println(strings.Repeat("-", 90))

	start := time.Now()
	allResults := detector.DetectAll(data, timestamps)
	totalDuration := time.Since(start)

	fmt.Printf("\nTotal Processing Time: %.3f ms\n", float64(totalDuration.Nanoseconds())/1e6)
	fmt.Printf("Total Anomalies Detected: %d\n", len(allResults))

	target := 2 * time.Second
	fmt.Println()
	if totalDuration < target {
		fmt.Println("✅ SUCCESS: Processing time within 2 second target!")
		improvement := 40.0 / (float64(totalDuration.Milliseconds()) / 1000.0)
		fmt.Printf("   Performance improvement: %.1fx over original 40s\n", improvement)
	} else {
		fmt.Println("⚠️  WARNING: Processing time exceeds 2 second target")
		fmt.Printf("   Exceeded by: %.3f seconds\n", totalDuration.Seconds()-2.0)
	}

	fmt.Println()
	fmt.Println("Optimizations applied:")
	fmt.Println("  1. RollingStats: Incremental mean/std calculation (O(1) per update)")
	fmt.Println("  2. Sliding window: Remove old values, add new values incrementally")
	fmt.Println("  3. Parallel execution: Three algorithms run concurrently")
	fmt.Println("  4. Pre-allocated slices: Avoid append() reallocation overhead")
	fmt.Println("  5. Batch processing: For extremely large datasets")
	fmt.Println("  6. Optimized deduplication: Struct key instead of nested lookups")
}
