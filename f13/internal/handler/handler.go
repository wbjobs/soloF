package handler

import (
	"context"
	"net/http"
	"time"

	"anomaly-detection-service/internal/detection"
	"anomaly-detection-service/internal/influxdb"
	"anomaly-detection-service/internal/websocket"

	"github.com/gin-gonic/gin"
)

type SensorDataRequest struct {
	DeviceID  string    `json:"deviceId" binding:"required"`
	Timestamp time.Time `json:"timestamp"`
	Temp      float64   `json:"temperature" binding:"required"`
	Vibration float64   `json:"vibration" binding:"required"`
	Current   float64   `json:"current" binding:"required"`
}

type BatchSensorDataRequest struct {
	Data []SensorDataRequest `json:"data" binding:"required,min=1"`
}

type BacktestRequest struct {
	DeviceID  string    `json:"deviceId" binding:"required"`
	StartTime time.Time `json:"startTime" binding:"required"`
	EndTime   time.Time `json:"endTime" binding:"required"`
	Metric    string    `json:"metric"`
}

type AnomalyResponse struct {
	DeviceID    string      `json:"deviceId"`
	Timestamp   time.Time   `json:"timestamp"`
	Metric      string      `json:"metric"`
	Value       float64     `json:"value"`
	Method      string      `json:"method"`
	Confidence  float64     `json:"confidence"`
	Description string      `json:"description"`
}

type BacktestResponse struct {
	Success   bool              `json:"success"`
	DeviceID  string            `json:"deviceId"`
	Anomalies []AnomalyResponse `json:"anomalies"`
	Count     int               `json:"count"`
}

type BaselineStatus struct {
	Mean        float64 `json:"mean"`
	StdDev      float64 `json:"stdDev"`
	Min         float64 `json:"min"`
	Max         float64 `json:"max"`
	SampleCount int     `json:"sampleCount"`
	LowerThresh  float64 `json:"lowerThreshold"`
	UpperThresh  float64 `json:"upperThreshold"`
}

type DeviceBaselineResponse struct {
	DeviceID    string              `json:"deviceId"`
	Metric      string              `json:"metric"`
	Period      string              `json:"period"`
	Baseline    BaselineStatus      `json:"baseline"`
}

type AllBaselinesResponse struct {
	DeviceID  string                           `json:"deviceId"`
	Metrics map[string]map[string]BaselineStatus `json:"metrics"`
}

type Handler struct {
	influxClient *influxdb.Client
	detector     *detection.Detector
	wsHub        *websocket.Hub
}

func NewHandler(influxClient *influxdb.Client, detector *detection.Detector, wsHub *websocket.Hub) *Handler {
	return &Handler{
		influxClient: influxClient,
		detector:     detector,
		wsHub:        wsHub,
	}
}

func (h *Handler) PostSensorData(c *gin.Context) {
	var req SensorDataRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Timestamp.IsZero() {
		req.Timestamp = time.Now()
	}

	data := influxdb.SensorData{
		DeviceID:  req.DeviceID,
		Timestamp: req.Timestamp,
		Temp:      req.Temp,
		Vibration: req.Vibration,
		Current:   req.Current,
	}

	if err := h.influxClient.WriteSensorData(context.Background(), data); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to write data"})
		return
	}

	go h.runRealtimeDetection(data)

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Data received successfully"})
}

func (h *Handler) PostBatchSensorData(c *gin.Context) {
	var req BatchSensorDataRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	dataList := make([]influxdb.SensorData, len(req.Data))
	for i, item := range req.Data {
		if item.Timestamp.IsZero() {
			item.Timestamp = time.Now()
		}
		dataList[i] = influxdb.SensorData{
			DeviceID:  item.DeviceID,
			Timestamp: item.Timestamp,
			Temp:      item.Temp,
			Vibration: item.Vibration,
			Current:   item.Current,
		}
	}

	if err := h.influxClient.WriteSensorDataBatch(context.Background(), dataList); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to write batch data"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Batch data received successfully", "count": len(dataList)})
}

func (h *Handler) PostBacktest(c *gin.Context) {
	var req BacktestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	dataList, err := h.influxClient.QuerySensorData(context.Background(), req.DeviceID, req.StartTime, req.EndTime)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query data"})
		return
	}

	if len(dataList) == 0 {
		c.JSON(http.StatusOK, BacktestResponse{
			Success:   true,
			DeviceID:  req.DeviceID,
			Anomalies: []AnomalyResponse{},
			Count:     0,
		})
		return
	}

	allAnomalies := h.runBacktestDetection(dataList, req.Metric)

	response := BacktestResponse{
		Success:   true,
		DeviceID:  req.DeviceID,
		Anomalies: allAnomalies,
		Count:     len(allAnomalies),
	}

	c.JSON(http.StatusOK, response)
}

func (h *Handler) runRealtimeDetection(data influxdb.SensorData) {
	h.detector.UpdateDeviceBaseline(data.DeviceID, data)

	metrics := map[detection.MetricType]float64{
		detection.MetricTemperature: data.Temp,
		detection.MetricVibration:   data.Vibration,
		detection.MetricCurrent:     data.Current,
	}

	for metric, value := range metrics {
		anomaly := h.detector.DetectWithAdaptiveThreshold(
			data.DeviceID,
			metric,
			value,
			data.Timestamp,
		)

		if anomaly != nil {
			h.wsHub.BroadcastAnomaly(websocket.AnomalyMessage{
				Type:       "anomaly",
				DeviceID:   data.DeviceID,
				Timestamp:  anomaly.Timestamp.Format(time.RFC3339),
				Metric:     string(metric),
				Value:      anomaly.Value,
				Method:     string(anomaly.Method),
				Confidence: anomaly.Confidence,
				Message:    anomaly.Description,
			})
		}
	}
}

func (h *Handler) runBacktestDetection(dataList []influxdb.SensorData, metricFilter string) []AnomalyResponse {
	var allAnomalies []AnomalyResponse

	if len(dataList) == 0 {
		return allAnomalies
	}

	metrics := map[string][]float64{
		"temperature": make([]float64, len(dataList)),
		"vibration":   make([]float64, len(dataList)),
		"current":     make([]float64, len(dataList)),
	}
	timestamps := make([]time.Time, len(dataList))

	for i, d := range dataList {
		metrics["temperature"][i] = d.Temp
		metrics["vibration"][i] = d.Vibration
		metrics["current"][i] = d.Current
		timestamps[i] = d.Timestamp
	}

	batchSize := 100000
	useBatch := len(dataList) > batchSize*2

	for metric, values := range metrics {
		if metricFilter != "" && metric != metricFilter {
			continue
		}

		var anomalies []detection.AnomalyResult
		if useBatch {
			anomalies = h.detector.BatchDetectAll(values, timestamps, batchSize)
		} else {
			anomalies = h.detector.DetectAll(values, timestamps)
		}

		for _, a := range anomalies {
			allAnomalies = append(allAnomalies, AnomalyResponse{
				DeviceID:    dataList[0].DeviceID,
				Timestamp:   a.Timestamp,
				Metric:      metric,
				Value:       a.Value,
				Method:      string(a.Method),
				Confidence:  a.Confidence,
				Description: a.Description,
			})
		}
	}

	return allAnomalies
}

func (h *Handler) GetDeviceBaseline(c *gin.Context) {
	deviceID := c.Query("deviceId")
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "deviceId is required"})
		return
	}

	metric := c.Query("metric")
	timestampStr := c.Query("timestamp")

	var t time.Time
	if timestampStr == "" {
		t = time.Now()
	} else {
		var err error
		t, err = time.Parse(time.RFC3339, timestampStr)
		if err != nil {
			t = time.Now()
		}
	}

	baseline := h.detector.GetDeviceBaseline(deviceID)

	if metric != "" {
		period := detection.GetTimePeriod(t)
		stats := baseline.GetBaseline(detection.MetricType(metric), t)
		lower, upper := baseline.GetThreshold(detection.MetricType(metric), t, 2.5)

		c.JSON(http.StatusOK, DeviceBaselineResponse{
			DeviceID: deviceID,
			Metric:   metric,
			Period:   period.String(),
			Baseline: BaselineStatus{
				Mean:        stats.Mean,
				StdDev:      stats.StdDev,
				Min:         stats.Min,
				Max:         stats.Max,
				SampleCount: 0,
				LowerThresh:  lower,
				UpperThresh:  upper,
			},
		})
		return
	}

	metrics := []detection.MetricType{detection.MetricTemperature, detection.MetricVibration, detection.MetricCurrent}
	periods := []detection.TimePeriod{detection.PeriodNight, detection.PeriodMorning, detection.PeriodAfternoon, detection.PeriodEvening}

	response := AllBaselinesResponse{
		DeviceID: deviceID,
		Metrics:  make(map[string]map[string]BaselineStatus),
	}

	for _, m := range metrics {
		response.Metrics[string(m)] = make(map[string]BaselineStatus)
		for _, p := range periods {
			stats := baseline.GetBaseline(m, t)
			lower, upper := baseline.GetThreshold(m, t, 2.5)

			response.Metrics[string(m)][p.String()] = BaselineStatus{
				Mean:        stats.Mean,
				StdDev:      stats.StdDev,
				Min:         stats.Min,
				Max:         stats.Max,
				SampleCount: 0,
				LowerThresh:  lower,
				UpperThresh:  upper,
			}
		}
	}

	c.JSON(http.StatusOK, response)
}

func (h *Handler) TrainDeviceBaseline(c *gin.Context) {
	var req BacktestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	dataList, err := h.influxClient.QuerySensorData(context.Background(), req.DeviceID, req.StartTime, req.EndTime)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query data for training"})
		return
	}

	if len(dataList) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "No data to train baseline", "count": 0})
		return
	}

	for _, data := range dataList {
		h.detector.UpdateDeviceBaseline(req.DeviceID, data)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"deviceId": req.DeviceID,
		"count":   len(dataList),
		"message": "Baseline trained successfully",
	})
}

func (h *Handler) SetAdaptiveSigma(c *gin.Context) {
	var req struct {
		Sigma float64 `json:"sigma" binding:"required,min=0.5,max=5"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.detector.SetAdaptiveSigma(req.Sigma)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"sigma":   req.Sigma,
		"message": "Adaptive threshold sigma updated",
	})
}

func (h *Handler) GetHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "healthy"})
}
