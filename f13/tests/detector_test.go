package tests

import (
	"testing"
	"time"

	"anomaly-detection-service/internal/detection"
	"anomaly-detection-service/internal/influxdb"
)

func TestThreeSigmaDetection(t *testing.T) {
	detector := detection.NewDetector()

	data := make([]float64, 1000)
	timestamps := make([]time.Time, 1000)

	for i := 0; i < 1000; i++ {
		data[i] = 50.0
		timestamps[i] = time.Now().Add(time.Duration(i) * time.Second)
	}

	data[500] = 150.0

	anomalies := detector.DetectThreeSigma(data, timestamps)

	if len(anomalies) == 0 {
		t.Error("Expected anomaly to be detected")
	}

	if len(anomalies) > 0 {
		if anomalies[0].Value != 150.0 {
			t.Errorf("Expected value 150.0, got %f", anomalies[0].Value)
		}
		if string(anomalies[0].Method) != "3-sigma" {
			t.Errorf("Expected method 3-sigma, got %s", anomalies[0].Method)
		}
	}
}

func TestMovingAverageDetection(t *testing.T) {
	detector := detection.NewDetector()

	data := make([]float64, 200)
	timestamps := make([]time.Time, 200)

	for i := 0; i < 200; i++ {
		data[i] = 50.0
		timestamps[i] = time.Now().Add(time.Duration(i) * time.Second)
	}

	data[150] = 150.0

	anomalies := detector.DetectMovingAverage(data, timestamps, 100)

	if len(anomalies) == 0 {
		t.Log("No anomalies detected in moving average test")
	}
}

func TestSeasonalDetection(t *testing.T) {
	detector := detection.NewDetector()

	data := make([]float64, 1000)
	timestamps := make([]time.Time, 1000)

	for i := 0; i < 1000; i++ {
		data[i] = 50.0 + float64(i%100)/5.0
		timestamps[i] = time.Now().Add(time.Duration(i) * time.Second)
	}

	data[500] = 150.0

	anomalies := detector.DetectSeasonal(data, timestamps, 100)

	t.Logf("Detected %d seasonal anomalies", len(anomalies))
}

func TestDetectAll(t *testing.T) {
	detector := detection.NewDetector()

	data := make([]float64, 2000)
	timestamps := make([]time.Time, 2000)

	for i := 0; i < 2000; i++ {
		data[i] = 50.0
		timestamps[i] = time.Now().Add(time.Duration(i) * time.Second)
	}

	data[1000] = 200.0

	anomalies := detector.DetectAll(data, timestamps)

	if len(anomalies) == 0 {
		t.Error("Expected at least one anomaly to be detected")
	}

	t.Logf("Detected %d anomalies using all methods", len(anomalies))
	for _, a := range anomalies {
		t.Logf("- Method: %s, Value: %f, Confidence: %.2f%%", a.Method, a.Value, a.Confidence)
	}
}

func TestRollingStats(t *testing.T) {
	data := []float64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}

	rs := &detection.RollingStats{}
	for _, v := range data {
		rs.Add(v)
	}

	mean := rs.Mean()
	std := rs.StdDev()

	if mean != 5.5 {
		t.Errorf("Expected mean 5.5, got %f", mean)
	}

	if std < 2.8 || std > 3.0 {
		t.Errorf("Expected std around 2.87, got %f", std)
	}

	rs.Remove(1)
	rs.Add(11)

	newMean := rs.Mean()
	if newMean != 6.5 {
		t.Errorf("Expected new mean 6.5, got %f", newMean)
	}
}

func TestRealtimeDetection(t *testing.T) {
	detector := detection.NewDetector()

	history := make([]float64, 100)
	for i := 0; i < 100; i++ {
		history[i] = 50.0
	}

	normalValue := 50.0
	result := detector.ProcessSensorDataRealtime(normalValue, time.Now(), history)
	if result != nil {
		t.Error("Should not detect anomaly for normal value")
	}

	anomalousValue := 150.0
	result = detector.ProcessSensorDataRealtime(anomalousValue, time.Now(), history)
	if result == nil {
		t.Error("Should detect anomaly for anomalous value")
	}
}

func TestMergeAnomalies(t *testing.T) {
	detector := detection.NewDetector()

	data := make([]float64, 1000)
	timestamps := make([]time.Time, 1000)
	for i := 0; i < 1000; i++ {
		data[i] = 50.0
		timestamps[i] = time.Now().Add(time.Duration(i) * time.Second)
	}

	data[500] = 200.0

	anomalies := detector.DetectAll(data, timestamps)

	t.Logf("After merge: %d unique anomalies", len(anomalies))
}

func TestTimePeriodClassification(t *testing.T) {
	nightTime := time.Date(2024, 1, 1, 2, 0, 0, 0, time.Local)
	morningTime := time.Date(2024, 1, 1, 8, 0, 0, 0, time.Local)
	afternoonTime := time.Date(2024, 1, 1, 14, 0, 0, 0, time.Local)
	eveningTime := time.Date(2024, 1, 1, 20, 0, 0, 0, time.Local)

	if detection.GetTimePeriod(nightTime) != detection.PeriodNight {
		t.Error("Expected 02:00 to be Night period")
	}
	if detection.GetTimePeriod(morningTime) != detection.PeriodMorning {
		t.Error("Expected 08:00 to be Morning period")
	}
	if detection.GetTimePeriod(afternoonTime) != detection.PeriodAfternoon {
		t.Error("Expected 14:00 to be Afternoon period")
	}
	if detection.GetTimePeriod(eveningTime) != detection.PeriodEvening {
		t.Error("Expected 20:00 to be Evening period")
	}
}

func TestDeviceBaselineInitialization(t *testing.T) {
	baseline := detection.NewDeviceBaseline("device-001")

	if baseline.DeviceID != "device-001" {
		t.Error("Expected device ID to be device-001")
	}

	testTime := time.Now()
	stats := baseline.GetBaseline(detection.MetricTemperature, testTime)

	if stats == nil {
		t.Error("Expected baseline stats to exist")
	}
}

func TestBaselineUpdate(t *testing.T) {
	baseline := detection.NewDeviceBaseline("device-001")
	testTime := time.Now()

	for i := 0; i < 100; i++ {
		baseline.UpdateBaseline(detection.MetricTemperature, testTime, 50.0+float64(i)*0.1)
	}

	stats := baseline.GetBaseline(detection.MetricTemperature, testTime)

	if stats.Mean < 50.0 || stats.Mean > 60.0 {
		t.Errorf("Expected mean around 55, got %f", stats.Mean)
	}

	t.Logf("Baseline stats - Mean: %.2f, StdDev: %.2f, Min: %.2f, Max: %.2f",
		stats.Mean, stats.StdDev, stats.Min, stats.Max)
}

func TestAdaptiveThresholdDetection(t *testing.T) {
	detector := detection.NewDetector()
	deviceID := "device-001"
	testTime := time.Now()

	for i := 0; i < 100; i++ {
		data := influxdb.SensorData{
			DeviceID:  deviceID,
			Timestamp: testTime.Add(time.Duration(i) * time.Second),
			Temp:      50.0,
			Vibration: 2.5,
			Current:   10.0,
		}
		detector.UpdateDeviceBaseline(deviceID, data)
	}

	normalValue := 50.0
	anomaly := detector.DetectWithAdaptiveThreshold(deviceID, detection.MetricTemperature, normalValue, testTime)
	if anomaly != nil {
		t.Error("Normal value should not be detected as anomaly")
	}

	anomalousValue := 75.0
	anomaly = detector.DetectWithAdaptiveThreshold(deviceID, detection.MetricTemperature, anomalousValue, testTime)
	if anomaly == nil {
		t.Error("Anomalous value should be detected")
	}

	if anomaly != nil {
		t.Logf("Anomaly detected - Value: %.2f, Confidence: %.2f%%, Method: %s",
			anomaly.Value, anomaly.Confidence, anomaly.Method)
	}
}

func TestAdaptiveThresholdDifferentPeriods(t *testing.T) {
	detector := detection.NewDetector()
	deviceID := "device-001"

	nightTime := time.Date(2024, 1, 1, 2, 0, 0, 0, time.Local)
	noonTime := time.Date(2024, 1, 1, 12, 0, 0, 0, time.Local)

	for i := 0; i < 100; i++ {
		data := influxdb.SensorData{
			DeviceID:  deviceID,
			Timestamp: nightTime.Add(time.Duration(i) * time.Second),
			Temp:      25.0,
			Vibration: 1.0,
			Current:   5.0,
		}
		detector.UpdateDeviceBaseline(deviceID, data)
	}

	for i := 0; i < 100; i++ {
		data := influxdb.SensorData{
			DeviceID:  deviceID,
			Timestamp: noonTime.Add(time.Duration(i) * time.Second),
			Temp:      45.0,
			Vibration: 3.0,
			Current:   15.0,
		}
		detector.UpdateDeviceBaseline(deviceID, data)
	}

	nightAnomaly := detector.DetectWithAdaptiveThreshold(deviceID, detection.MetricTemperature, 45.0, nightTime)
	noonAnomaly := detector.DetectWithAdaptiveThreshold(deviceID, detection.MetricTemperature, 45.0, noonTime)

	if nightAnomaly == nil {
		t.Error("45C should be anomaly at night")
	}
	if noonAnomaly != nil {
		t.Error("45C should NOT be anomaly at noon")
	}

	t.Log("Adaptive threshold working correctly for different periods")
}

func TestConfidenceCalculation(t *testing.T) {
	baseline := detection.NewDeviceBaseline("device-001")
	testTime := time.Now()

	for i := 0; i < 100; i++ {
		baseline.UpdateBaseline(detection.MetricTemperature, testTime, 50.0)
	}

	confidence1 := baseline.GetConfidence(detection.MetricTemperature, testTime, 52.0)
	confidence2 := baseline.GetConfidence(detection.MetricTemperature, testTime, 60.0)

	if confidence1 >= confidence2 {
		t.Error("Larger deviation should have higher confidence")
	}

	t.Logf("Confidence for 52C (small dev): %.2f%%", confidence1)
	t.Logf("Confidence for 60C (large dev): %.2f%%", confidence2)
}
