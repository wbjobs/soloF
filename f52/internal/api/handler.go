package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"iot-device-shadow/internal/database"
	"iot-device-shadow/internal/mqtt"
	"iot-device-shadow/pkg/utils"
)

type Handler struct {
	mqttClient *mqtt.Client
	dbStore    *database.Store
}

type UpdateDesiredRequest struct {
	Desired map[string]interface{} `json:"desired" binding:"required"`
}

type ShadowResponse struct {
	DeviceID  string                 `json:"device_id"`
	State     mqtt.State             `json:"state"`
	Delta     map[string]interface{} `json:"delta,omitempty"`
	Version   int64                  `json:"version"`
	Timestamp int64                  `json:"timestamp"`
}

func NewHandler(mqttClient *mqtt.Client, dbStore *database.Store) *Handler {
	return &Handler{
		mqttClient: mqttClient,
		dbStore:    dbStore,
	}
}

func (h *Handler) GetShadow(c *gin.Context) {
	deviceID := c.Param("device_id")
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "device_id is required"})
		return
	}

	shadow, err := h.mqttClient.GetShadow(deviceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	delta := utils.CalculateDelta(shadow.State.Desired, shadow.State.Reported)

	response := ShadowResponse{
		DeviceID:  shadow.DeviceID,
		State:     shadow.State,
		Delta:     delta,
		Version:   shadow.Version,
		Timestamp: shadow.Timestamp,
	}

	c.JSON(http.StatusOK, response)
}

func (h *Handler) GetDesired(c *gin.Context) {
	deviceID := c.Param("device_id")
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "device_id is required"})
		return
	}

	shadow, err := h.mqttClient.GetShadow(deviceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"device_id": deviceID,
		"desired":   shadow.State.Desired,
		"version":   shadow.Version,
	})
}

func (h *Handler) GetReported(c *gin.Context) {
	deviceID := c.Param("device_id")
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "device_id is required"})
		return
	}

	shadow, err := h.mqttClient.GetShadow(deviceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"device_id": deviceID,
		"reported":  shadow.State.Reported,
		"version":   shadow.Version,
		"timestamp": shadow.Timestamp,
	})
}

func (h *Handler) GetDelta(c *gin.Context) {
	deviceID := c.Param("device_id")
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "device_id is required"})
		return
	}

	shadow, err := h.mqttClient.GetShadow(deviceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	delta := utils.CalculateDelta(shadow.State.Desired, shadow.State.Reported)

	c.JSON(http.StatusOK, gin.H{
		"device_id": deviceID,
		"delta":     delta,
		"version":   shadow.Version,
	})
}

func (h *Handler) UpdateDesired(c *gin.Context) {
	deviceID := c.Param("device_id")
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "device_id is required"})
		return
	}

	var req UpdateDesiredRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	shadow, err := h.mqttClient.UpdateDesiredState(deviceID, req.Desired)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	delta := utils.CalculateDelta(shadow.State.Desired, shadow.State.Reported)

	response := ShadowResponse{
		DeviceID:  shadow.DeviceID,
		State:     shadow.State,
		Delta:     delta,
		Version:   shadow.Version,
		Timestamp: shadow.Timestamp,
	}

	c.JSON(http.StatusOK, response)
}

func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
	})
}

type HistoryLogResponse struct {
	ID         uint64                 `json:"id"`
	DeviceID   string                 `json:"device_id"`
	Version    int64                  `json:"version"`
	ChangeType string                 `json:"change_type"`
	Desired    map[string]interface{} `json:"desired,omitempty"`
	Reported   map[string]interface{} `json:"reported,omitempty"`
	CreatedAt  time.Time              `json:"created_at"`
}

func (h *Handler) GetHistory(c *gin.Context) {
	deviceID := c.Param("device_id")
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "device_id is required"})
		return
	}

	if h.dbStore == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "history service unavailable"})
		return
	}

	limitStr := c.DefaultQuery("limit", "100")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 || limit > 1000 {
		limit = 100
	}

	since := time.Now().Add(-24 * time.Hour)

	logs, err := h.dbStore.GetDeviceHistory(c.Request.Context(), deviceID, since, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	response := make([]HistoryLogResponse, 0, len(logs))
	for _, log := range logs {
		item := HistoryLogResponse{
			ID:         log.ID,
			DeviceID:   log.DeviceID,
			Version:    log.Version,
			ChangeType: log.ChangeType,
			CreatedAt:  log.CreatedAt,
		}
		if log.Desired != "" {
			_ = utils.FromJSON(log.Desired, &item.Desired)
		}
		if log.Reported != "" {
			_ = utils.FromJSON(log.Reported, &item.Reported)
		}
		response = append(response, item)
	}

	c.JSON(http.StatusOK, gin.H{
		"device_id": deviceID,
		"since":     since,
		"count":     len(response),
		"logs":      response,
	})
}

func (h *Handler) GetHistoryByVersion(c *gin.Context) {
	deviceID := c.Param("device_id")
	versionStr := c.Param("version")
	if deviceID == "" || versionStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "device_id and version are required"})
		return
	}

	if h.dbStore == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "history service unavailable"})
		return
	}

	version, err := strconv.ParseInt(versionStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid version"})
		return
	}

	log, err := h.dbStore.GetDeviceHistoryByVersion(c.Request.Context(), deviceID, version)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "version not found"})
		return
	}

	response := HistoryLogResponse{
		ID:         log.ID,
		DeviceID:   log.DeviceID,
		Version:    log.Version,
		ChangeType: log.ChangeType,
		CreatedAt:  log.CreatedAt,
	}
	if log.Desired != "" {
		_ = utils.FromJSON(log.Desired, &response.Desired)
	}
	if log.Reported != "" {
		_ = utils.FromJSON(log.Reported, &response.Reported)
	}

	c.JSON(http.StatusOK, response)
}
