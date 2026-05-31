package main

import (
	"log"

	"anomaly-detection-service/config"
	"anomaly-detection-service/internal/detection"
	"anomaly-detection-service/internal/handler"
	"anomaly-detection-service/internal/influxdb"
	"anomaly-detection-service/internal/websocket"

	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.LoadConfig()

	influxClient := influxdb.NewClient(&cfg.InfluxDB)
	defer influxClient.Close()

	detector := detection.NewDetector()

	wsHub := websocket.NewHub()
	go wsHub.Run()

	h := handler.NewHandler(influxClient, detector, wsHub)

	r := gin.Default()

	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	api := r.Group("/api/v1")
	{
		api.POST("/sensor/data", h.PostSensorData)
		api.POST("/sensor/batch", h.PostBatchSensorData)
		api.POST("/backtest", h.PostBacktest)
		api.GET("/health", h.GetHealth)

		api.GET("/baseline", h.GetDeviceBaseline)
		api.POST("/baseline/train", h.TrainDeviceBaseline)
		api.POST("/baseline/sigma", h.SetAdaptiveSigma)
	}

	r.GET("/ws", websocket.HandleWebSocket(wsHub))

	log.Printf("Server starting on port %s...", cfg.Server.Port)
	if err := r.Run(":" + cfg.Server.Port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
