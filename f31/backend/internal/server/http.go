package server

import (
	"io"
	"net/http"
	"ota-center/internal/mqtt"

	"github.com/gin-gonic/gin"
)

type HTTPServer struct {
	router *gin.Engine
	broker *mqtt.Broker
}

func NewHTTPServer(broker *mqtt.Broker) *HTTPServer {
	r := gin.Default()

	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	s := &HTTPServer{router: r, broker: broker}

	r.GET("/api/devices", s.GetDevices)
	r.GET("/api/firmwares", s.GetFirmwares)
	r.POST("/api/firmwares", s.UploadFirmware)
	r.POST("/api/upgrade", s.StartUpgrade)
	r.GET("/api/gray-config", s.GetGrayConfig)
	r.POST("/api/gray-config", s.SetGrayConfig)

	return s
}

func (s *HTTPServer) Start(addr string) error {
	return http.ListenAndServe(addr, s.router)
}

func (s *HTTPServer) GetDevices(c *gin.Context) {
	devices := s.broker.GetDevices()
	c.JSON(200, gin.H{"devices": devices})
}

func (s *HTTPServer) GetFirmwares(c *gin.Context) {
	firmwares := s.broker.GetFirmwares()
	c.JSON(200, gin.H{"firmwares": firmwares})
}

func (s *HTTPServer) UploadFirmware(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	version := c.PostForm("version")
	if version == "" {
		version = file.Filename
	}

	src, err := file.Open()
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer src.Close()

	data, err := io.ReadAll(src)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	err = s.broker.AddFirmware(version, data)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{"status": "ok"})
}

func (s *HTTPServer) StartUpgrade(c *gin.Context) {
	var req struct {
		DeviceID   string `json:"device_id"`
		FirmwareID string `json:"firmware_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	err := s.broker.StartUpgrade(req.DeviceID, req.FirmwareID)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{"status": "ok"})
}

func (s *HTTPServer) GetGrayConfig(c *gin.Context) {
	config := s.broker.GetGrayReleaseConfig()
	c.JSON(200, gin.H{"config": config})
}

func (s *HTTPServer) SetGrayConfig(c *gin.Context) {
	var req mqtt.GrayReleaseConfig

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	s.broker.SetGrayReleaseConfig(req)
	c.JSON(200, gin.H{"status": "ok", "config": req})
}
