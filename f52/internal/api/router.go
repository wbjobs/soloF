package api

import (
	"github.com/gin-gonic/gin"
)

func SetupRouter(handler *Handler) *gin.Engine {
	r := gin.Default()

	r.Use(gin.Logger())
	r.Use(gin.Recovery())

	api := r.Group("/api")
	{
		api.GET("/health", handler.Health)

		devices := api.Group("/devices")
		{
			devices.GET("/:device_id/shadow", handler.GetShadow)
			devices.GET("/:device_id/shadow/desired", handler.GetDesired)
			devices.GET("/:device_id/shadow/reported", handler.GetReported)
			devices.GET("/:device_id/shadow/delta", handler.GetDelta)
			devices.PATCH("/:device_id/shadow/desired", handler.UpdateDesired)
			devices.GET("/:device_id/history", handler.GetHistory)
			devices.GET("/:device_id/history/version/:version", handler.GetHistoryByVersion)
		}
	}

	return r
}
