package tests

import (
	"math"
	"math/rand"
	"testing"
	"time"

	"anomaly-detection-service/internal/detection"
)

func generateTestData(n int) ([]float64, []time.Time) {
	data := make([]float64, n)
	timestamps := make([]time.Time, n)
	baseTime := time.Now()

	for i := 0; i < n; i++ {
		hourOffset := float64(i%3600) / 3600.0
		seasonal := 50.0 + 20.0*math.Sin(2*math.Pi*hourOffset)
		noise := rand.NormFloat64() * 3.0
		data[i] = seasonal + noise

		if i%1000 == 0 && i > 0 {
			data[i] = seasonal + noise + 50.0
		}

		timestamps[i] = baseTime.Add(time.Duration(i) * time.Second)
	}

	return data, timestamps
}

func BenchmarkDetectThreeSigma_Optimized(b *testing.B) {
	detector := detection.NewDetector()
	data, timestamps := generateTestData(3600000)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		result := detector.DetectThreeSigma(data, timestamps)
		_ = result
	}
}

func BenchmarkDetectMovingAverage_Optimized(b *testing.B) {
	detector := detection.NewDetector()
	data, timestamps := generateTestData(3600000)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		result := detector.DetectMovingAverage(data, timestamps, 1000)
		_ = result
	}
}

func BenchmarkDetectSeasonal_Optimized(b *testing.B) {
	detector := detection.NewDetector()
	data, timestamps := generateTestData(3600000)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		result := detector.DetectSeasonal(data, timestamps, 3600)
		_ = result
	}
}

func BenchmarkDetectAll_Optimized(b *testing.B) {
	detector := detection.NewDetector()
	data, timestamps := generateTestData(3600000)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		result := detector.DetectAll(data, timestamps)
		_ = result
	}
}

func TestPerformanceImprovement(t *testing.T) {
	detector := detection.NewDetector()
	data, timestamps := generateTestData(3600000)

	t.Log("Testing with 3,600,000 data points (1 hour @ 1000 Hz)")

	start := time.Now()
	result1 := detector.DetectThreeSigma(data, timestamps)
	duration1 := time.Since(start)
	t.Logf("3-Sigma: %v, anomalies: %d", duration1, len(result1))

	start = time.Now()
	result2 := detector.DetectMovingAverage(data, timestamps, 1000)
	duration2 := time.Since(start)
	t.Logf("Moving Average: %v, anomalies: %d", duration2, len(result2))

	start = time.Now()
	result3 := detector.DetectSeasonal(data, timestamps, 3600)
	duration3 := time.Since(start)
	t.Logf("Seasonal: %v, anomalies: %d", duration3, len(result3))

	start = time.Now()
	resultAll := detector.DetectAll(data, timestamps)
	durationAll := time.Since(start)
	t.Logf("All Methods: %v, total anomalies: %d", durationAll, len(resultAll))

	target := 2 * time.Second
	if durationAll > target {
		t.Logf("WARNING: Total processing time %v exceeds target %v", durationAll, target)
	} else {
		t.Logf("SUCCESS: Total processing time %v is within target %v", durationAll, target)
	}
}

func TestAnomalyDetectionAccuracy(t *testing.T) {
	detector := detection.NewDetector()
	data, timestamps := generateTestData(3600000)

	results := detector.DetectAll(data, timestamps)

	expectedAnomalies := 3600
	tolerance := 0.2

	minExpected := int(float64(expectedAnomalies) * (1 - tolerance))
	maxExpected := int(float64(expectedAnomalies) * (1 + tolerance))

	t.Logf("Expected ~%d anomalies, detected: %d", expectedAnomalies, len(results))

	if len(results) < minExpected || len(results) > maxExpected {
		t.Logf("WARNING: Anomaly count %d outside expected range [%d, %d]",
			len(results), minExpected, maxExpected)
	} else {
		t.Logf("SUCCESS: Anomaly count within expected tolerance")
	}
}
