package detection

import (
	"math"
	"sync"
	"time"

	"anomaly-detection-service/internal/influxdb"
)

type DetectionMethod string

const (
	MethodThreeSigma    DetectionMethod = "3-sigma"
	MethodMovingAverage DetectionMethod = "moving-average"
	MethodSeasonal      DetectionMethod = "seasonal"
	MethodAdaptive      DetectionMethod = "adaptive"
)

type TimePeriod int

const (
	PeriodNight TimePeriod = iota // 00:00 - 06:00
	PeriodMorning                  // 06:00 - 12:00
	PeriodAfternoon                // 12:00 - 18:00
	PeriodEvening                  // 18:00 - 24:00
)

type MetricType string

const (
	MetricTemperature MetricType = "temperature"
	MetricVibration   MetricType = "vibration"
	MetricCurrent     MetricType = "current"
)

type BaselineStats struct {
	Mean        float64
	StdDev      float64
	Min         float64
	Max         float64
	LastUpdated time.Time
}

type DeviceBaseline struct {
	DeviceID string
	mu       sync.RWMutex
	baseline map[MetricType]map[TimePeriod]*BaselineStats
	counts   map[MetricType]map[TimePeriod]int
}

type AnomalyResult struct {
	Timestamp   time.Time
	Value       float64
	Method      DetectionMethod
	Confidence  float64
	Description string
}

type RollingStats struct {
	sum   float64
	sumSq float64
	count int
}

func (rs *RollingStats) Add(value float64) {
	rs.sum += value
	rs.sumSq += value * value
	rs.count++
}

func (rs *RollingStats) Remove(value float64) {
	rs.sum -= value
	rs.sumSq -= value * value
	rs.count--
}

func (rs *RollingStats) Mean() float64 {
	if rs.count == 0 {
		return 0
	}
	return rs.sum / float64(rs.count)
}

func (rs *RollingStats) StdDev() float64 {
	if rs.count < 2 {
		return 0
	}
	mean := rs.Mean()
	variance := (rs.sumSq / float64(rs.count)) - (mean * mean)
	if variance < 0 {
		return 0
	}
	return math.Sqrt(variance)
}

type SeasonalRolling struct {
	period       int
	seasonalSums []float64
	seasonalCnt  []int
	trendStats   RollingStats
}

func NewSeasonalRolling(period int) *SeasonalRolling {
	return &SeasonalRolling{
		period:       period,
		seasonalSums: make([]float64, period),
		seasonalCnt:  make([]int, period),
	}
}

func (sr *SeasonalRolling) Add(value float64, idx int) {
	pos := idx % sr.period
	sr.seasonalSums[pos] += value
	sr.seasonalCnt[pos]++
	sr.trendStats.Add(value)
}

func (sr *SeasonalRolling) Remove(value float64, idx int) {
	pos := idx % sr.period
	sr.seasonalSums[pos] -= value
	sr.seasonalCnt[pos]--
	sr.trendStats.Remove(value)
}

func (sr *SeasonalRolling) SeasonalComponent(idx int) float64 {
	pos := idx % sr.period
	if sr.seasonalCnt[pos] == 0 {
		return 0
	}
	return sr.seasonalSums[pos] / float64(sr.seasonalCnt[pos])
}

func (sr *SeasonalRolling) TrendComponent() float64 {
	return sr.trendStats.Mean()
}

func GetTimePeriod(t time.Time) TimePeriod {
	hour := t.Hour()
	switch {
	case hour >= 0 && hour < 6:
		return PeriodNight
	case hour >= 6 && hour < 12:
		return PeriodMorning
	case hour >= 12 && hour < 18:
		return PeriodAfternoon
	default:
		return PeriodEvening
	}
}

func (tp TimePeriod) String() string {
	switch tp {
	case PeriodNight:
		return "Night(00-06)"
	case PeriodMorning:
		return "Morning(06-12)"
	case PeriodAfternoon:
		return "Afternoon(12-18)"
	default:
		return "Evening(18-24)"
	}
}

func NewDeviceBaseline(deviceID string) *DeviceBaseline {
	db := &DeviceBaseline{
		DeviceID: deviceID,
		baseline: make(map[MetricType]map[TimePeriod]*BaselineStats),
		counts:   make(map[MetricType]map[TimePeriod]int),
	}

	metrics := []MetricType{MetricTemperature, MetricVibration, MetricCurrent}
	periods := []TimePeriod{PeriodNight, PeriodMorning, PeriodAfternoon, PeriodEvening}

	for _, metric := range metrics {
		db.baseline[metric] = make(map[TimePeriod]*BaselineStats)
		db.counts[metric] = make(map[TimePeriod]int)
		for _, period := range periods {
			db.baseline[metric][period] = &BaselineStats{
				Mean:        0,
				StdDev:      1,
				Min:         math.MaxFloat64,
				Max:         -math.MaxFloat64,
				LastUpdated: time.Now(),
			}
			db.counts[metric][period] = 0
		}
	}

	return db
}

func (db *DeviceBaseline) UpdateBaseline(metric MetricType, t time.Time, value float64) {
	db.mu.Lock()
	defer db.mu.Unlock()

	period := GetTimePeriod(t)
	stats := db.baseline[metric][period]
	count := db.counts[metric][period]

	if count == 0 {
		stats.Mean = value
		stats.StdDev = 1.0
		stats.Min = value
		stats.Max = value
	} else {
		oldMean := stats.Mean
		alpha := 1.0 / float64(count+1)
		stats.Mean = oldMean + alpha*(value-oldMean)

		delta := value - oldMean
		oldVariance := stats.StdDev * stats.StdDev
		newVariance := oldVariance + alpha*(delta*delta-oldVariance)
		stats.StdDev = math.Sqrt(math.Max(newVariance, 0.1))

		if value < stats.Min {
			stats.Min = value
		}
		if value > stats.Max {
			stats.Max = value
		}
	}

	db.counts[metric][period]++
	stats.LastUpdated = time.Now()
}

func (db *DeviceBaseline) GetBaseline(metric MetricType, t time.Time) *BaselineStats {
	db.mu.RLock()
	defer db.mu.RUnlock()

	period := GetTimePeriod(t)
	return db.baseline[metric][period]
}

func (db *DeviceBaseline) GetThreshold(metric MetricType, t time.Time, sigma float64) (float64, float64) {
	baseline := db.GetBaseline(metric, t)
	upper := baseline.Mean + sigma*baseline.StdDev
	lower := baseline.Mean - sigma*baseline.StdDev
	return lower, upper
}

func (db *DeviceBaseline) GetConfidence(metric MetricType, t time.Time, value float64) float64 {
	baseline := db.GetBaseline(metric, t)
	if baseline.StdDev == 0 {
		return 100.0
	}

	deviation := math.Abs(value - baseline.Mean) / baseline.StdDev
	if deviation <= 1.0 {
		return 0
	}

	confidence := (deviation - 1.0) / 2.0 * 100
	return math.Min(confidence, 100.0)
}

type Detector struct {
	windowSize      int
	statsCache      map[string]*RollingStats
	deviceBaselines map[string]*DeviceBaseline
	adaptiveSigma   float64
	mu              sync.RWMutex
}

func NewDetector() *Detector {
	return &Detector{
		windowSize:      1000,
		statsCache:      make(map[string]*RollingStats),
		deviceBaselines: make(map[string]*DeviceBaseline),
		adaptiveSigma:   2.5,
	}
}

func NewDetectorWithWindow(windowSize int) *Detector {
	return &Detector{
		windowSize:      windowSize,
		statsCache:      make(map[string]*RollingStats),
		deviceBaselines: make(map[string]*DeviceBaseline),
		adaptiveSigma:   2.5,
	}
}

func (d *Detector) GetDeviceBaseline(deviceID string) *DeviceBaseline {
	d.mu.RLock()
	baseline, exists := d.deviceBaselines[deviceID]
	d.mu.RUnlock()

	if exists {
		return baseline
	}

	d.mu.Lock()
	defer d.mu.Unlock()
	baseline = NewDeviceBaseline(deviceID)
	d.deviceBaselines[deviceID] = baseline
	return baseline
}

func (d *Detector) UpdateDeviceBaseline(deviceID string, data influxdb.SensorData) {
	baseline := d.GetDeviceBaseline(deviceID)
	baseline.UpdateBaseline(MetricTemperature, data.Timestamp, data.Temp)
	baseline.UpdateBaseline(MetricVibration, data.Timestamp, data.Vibration)
	baseline.UpdateBaseline(MetricCurrent, data.Timestamp, data.Current)
}

func (d *Detector) SetAdaptiveSigma(sigma float64) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.adaptiveSigma = sigma
}

func (d *Detector) DetectWithAdaptiveThreshold(deviceID string, metric MetricType, value float64, t time.Time) *AnomalyResult {
	baseline := d.GetDeviceBaseline(deviceID)
	stats := baseline.GetBaseline(metric, t)

	lower, upper := baseline.GetThreshold(metric, t, d.adaptiveSigma)

	if value >= lower && value <= upper {
		return nil
	}

	confidence := baseline.GetConfidence(metric, t, value)

	var description string
	if value > upper {
		description = "Value exceeds adaptive upper threshold"
	} else {
		description = "Value below adaptive lower threshold"
	}

	return &AnomalyResult{
		Timestamp:   t,
		Value:       value,
		Method:      MethodAdaptive,
		Confidence:  confidence,
		Description: description,
	}
}

func (d *Detector) DetectAllAdaptive(data []float64, timestamps []time.Time, deviceID string, metric MetricType) []AnomalyResult {
	baseline := d.GetDeviceBaseline(deviceID)

	var anomalies []AnomalyResult
	for i, value := range data {
		period := GetTimePeriod(timestamps[i])
		stats := baseline.GetBaseline(metric, timestamps[i])

		lower := stats.Mean - d.adaptiveSigma*stats.StdDev
		upper := stats.Mean + d.adaptiveSigma*stats.StdDev

		if value < lower || value > upper {
			confidence := baseline.GetConfidence(metric, timestamps[i], value)
			anomalies = append(anomalies, AnomalyResult{
				Timestamp:   timestamps[i],
				Value:       value,
				Method:      MethodAdaptive,
				Confidence:  confidence,
				Description: "Adaptive threshold anomaly during " + period.String(),
			})
		}
	}

	return anomalies
}

func (d *Detector) DetectThreeSigma(data []float64, timestamps []time.Time) []AnomalyResult {
	n := len(data)
	if n < 10 {
		return nil
	}

	var anomalies []AnomalyResult
	stats := &RollingStats{}
	warmupSize := min(n, 1000)

	for i := 0; i < warmupSize; i++ {
		stats.Add(data[i])
	}

	globalMean := stats.Mean()
	globalStd := stats.StdDev()

	for i, value := range data {
		deviation := math.Abs(value - globalMean)
		if deviation > 3*globalStd && globalStd > 0 {
			confidence := math.Min((deviation/(3*globalStd))*100, 100)
			anomalies = append(anomalies, AnomalyResult{
				Timestamp:   timestamps[i],
				Value:       value,
				Method:      MethodThreeSigma,
				Confidence:  confidence,
				Description: "Value exceeds 3 standard deviations from mean",
			})
		}
	}

	return anomalies
}

func (d *Detector) DetectMovingAverage(data []float64, timestamps []time.Time, windowSize int) []AnomalyResult {
	n := len(data)
	if n < windowSize*2 {
		return nil
	}

	var anomalies []AnomalyResult
	stats := &RollingStats{}

	for i := 0; i < windowSize; i++ {
		stats.Add(data[i])
	}

	for i := windowSize; i < n; i++ {
		mean := stats.Mean()
		std := stats.StdDev()

		value := data[i]
		deviation := math.Abs(value - mean)

		if deviation > 2.5*std && std > 0 {
			confidence := math.Min((deviation/(2.5*std))*100, 100)
			anomalies = append(anomalies, AnomalyResult{
				Timestamp:   timestamps[i],
				Value:       value,
				Method:      MethodMovingAverage,
				Confidence:  confidence,
				Description: "Anomaly detected using moving average",
			})
		}

		stats.Remove(data[i-windowSize])
		stats.Add(data[i])
	}

	return anomalies
}

func (d *Detector) DetectSeasonal(data []float64, timestamps []time.Time, period int) []AnomalyResult {
	n := len(data)
	if n < period*3 {
		return nil
	}

	var anomalies []AnomalyResult
	windowSize := period * 2

	seasonalStats := make([]RollingStats, period)
	globalStats := &RollingStats{}

	for i := 0; i < min(windowSize, n); i++ {
		pos := i % period
		seasonalStats[pos].Add(data[i])
		globalStats.Add(data[i])
	}

	residualStats := &RollingStats{}
	for i := 0; i < min(windowSize, n); i++ {
		pos := i % period
		seasonal := seasonalStats[pos].Mean()
		trend := globalStats.Mean()
		residual := data[i] - seasonal - trend
		residualStats.Add(residual)
	}

	for i := windowSize; i < n; i++ {
		oldPos := (i - windowSize) % period
		oldValue := data[i-windowSize]

		seasonalStats[oldPos].Remove(oldValue)
		globalStats.Remove(oldValue)

		pos := i % period
		currentValue := data[i]
		seasonalStats[pos].Add(currentValue)
		globalStats.Add(currentValue)

		seasonal := seasonalStats[pos].Mean()
		trend := globalStats.Mean()
		residual := currentValue - seasonal - trend

		oldResidualPos := (i - windowSize) % period
		oldResidual := data[i-windowSize] - seasonalStats[oldResidualPos].Mean() - trend
		residualStats.Remove(oldResidual)
		residualStats.Add(residual)

		meanResidual := residualStats.Mean()
		stdResidual := residualStats.StdDev()

		deviation := math.Abs(residual - meanResidual)
		if deviation > 2.8*stdResidual && stdResidual > 0 {
			confidence := math.Min((deviation/(2.8*stdResidual))*100, 100)
			anomalies = append(anomalies, AnomalyResult{
				Timestamp:   timestamps[i],
				Value:       currentValue,
				Method:      MethodSeasonal,
				Confidence:  confidence,
				Description: "Seasonal decomposition detected anomaly",
			})
		}
	}

	return anomalies
}

func (d *Detector) DetectAll(data []float64, timestamps []time.Time) []AnomalyResult {
	n := len(data)
	if n == 0 {
		return nil
	}

	anomalyChan := make(chan []AnomalyResult, 3)

	go func() {
		anomalyChan <- d.DetectThreeSigma(data, timestamps)
	}()

	go func() {
		windowSize := min(1000, n/4)
		if windowSize < 10 {
			windowSize = 10
		}
		anomalyChan <- d.DetectMovingAverage(data, timestamps, windowSize)
	}()

	go func() {
		period := 3600
		if n < period*3 {
			period = max(10, n/10)
		}
		anomalyChan <- d.DetectSeasonal(data, timestamps, period)
	}()

	var allAnomalies []AnomalyResult
	for i := 0; i < 3; i++ {
		allAnomalies = append(allAnomalies, <-anomalyChan...)
	}

	return mergeAnomalies(allAnomalies)
}

func mergeAnomalies(anomalies []AnomalyResult) []AnomalyResult {
	if len(anomalies) == 0 {
		return anomalies
	}

	type anomalyKey struct {
		ts     int64
		method DetectionMethod
	}
	seen := make(map[anomalyKey]bool)
	var result []AnomalyResult

	for _, a := range anomalies {
		key := anomalyKey{
			ts:     a.Timestamp.UnixNano(),
			method: a.Method,
		}
		if !seen[key] {
			seen[key] = true
			result = append(result, a)
		}
	}

	return result
}

func (d *Detector) ProcessSensorDataRealtime(value float64, timestamp time.Time, history []float64) *AnomalyResult {
	if len(history) < 10 {
		return nil
	}

	stats := &RollingStats{}
	for _, v := range history {
		stats.Add(v)
	}

	mean := stats.Mean()
	std := stats.StdDev()

	deviation := math.Abs(value - mean)
	if deviation > 2.8*std && std > 0 {
		confidence := math.Min((deviation/(2.8*std))*100, 100)
		return &AnomalyResult{
			Timestamp:   timestamp,
			Value:       value,
			Method:      MethodMovingAverage,
			Confidence:  confidence,
			Description: "Real-time anomaly detected",
		}
	}

	return nil
}

func (d *Detector) BatchDetectAll(data []float64, timestamps []time.Time, batchSize int) []AnomalyResult {
	n := len(data)
	if n == 0 {
		return nil
	}

	if batchSize <= 0 || n <= batchSize {
		return d.DetectAll(data, timestamps)
	}

	var allAnomalies []AnomalyResult

	for i := 0; i < n; i += batchSize {
		end := min(i+batchSize+100, n)
		start := max(0, i-100)

		batchData := data[start:end]
		batchTimestamps := timestamps[start:end]

		batchAnomalies := d.DetectAll(batchData, batchTimestamps)

		for _, a := range batchAnomalies {
			idx := int(a.Timestamp.Sub(timestamps[start]).Milliseconds())
			if idx >= i && idx < i+batchSize {
				allAnomalies = append(allAnomalies, a)
			}
		}
	}

	return mergeAnomalies(allAnomalies)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (d *Detector) ProcessSensorData(data influxdb.SensorData) map[string][]AnomalyResult {
	results := make(map[string][]AnomalyResult)
	return results
}
