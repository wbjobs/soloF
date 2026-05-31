package routes

import (
	"task-scheduler/internal/api/handlers"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func SetupRouter() *gin.Engine {
	r := gin.Default()

	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept"}
	r.Use(cors.New(config))

	taskHandler := handlers.NewTaskHandler()

	api := r.Group("/api")
	{
		tasks := api.Group("/tasks")
		{
			tasks.POST("", taskHandler.CreateTask)
			tasks.GET("", taskHandler.GetTasks)
			tasks.GET("/:id", taskHandler.GetTask)
			tasks.PUT("/:id/status", taskHandler.UpdateTaskStatus)
			tasks.DELETE("/:id", taskHandler.DeleteTask)
			tasks.GET("/:id/executions", taskHandler.GetTaskExecutions)
			tasks.POST("/:id/trigger", taskHandler.TriggerTask)
		}
	}

	return r
}
