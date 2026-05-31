package routes

import (
	"net/http"
	"strconv"
	"task-scheduler/config"
	"task-scheduler/controllers"
	"task-scheduler/models"
	"task-scheduler/scheduler"
	"task-scheduler/websocket"
	"time"
	"github.com/gin-gonic/gin"
)

type TaskWithNextRun struct {
	ID          uint      `json:"id"`
	Name        string    `json:"name"`
	CronExpr    string    `json:"cron_expr"`
	Command     string    `json:"command"`
	Dependency  string    `json:"dependency"`
	Timeout     int       `json:"timeout"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	NextRun     *time.Time `json:"next_run"`
	LastStatus  string     `json:"last_status"`
}

func GetTasksWithStatus(c *gin.Context) {
	var tasks []models.Task
	config.DB.Find(&tasks)
	var result []TaskWithNextRun
	for _, task := range tasks {
		taskWithStatus := TaskWithNextRun{
			ID:         task.ID,
			Name:       task.Name,
			CronExpr:   task.CronExpr,
			Command:    task.Command,
			Dependency: task.Dependency,
			Timeout:    task.Timeout,
			Status:     task.Status,
			CreatedAt:  task.CreatedAt,
			UpdatedAt:  task.UpdatedAt,
		}
		if nextRun, ok := scheduler.GetNextRunTime(int(task.ID)); ok {
			taskWithStatus.NextRun = &nextRun
		}
		var lastLog models.TaskLog
		config.DB.Where("task_id = ?", task.ID).Order("start_time desc").First(&lastLog)
		if lastLog.ID != 0 {
			taskWithStatus.LastStatus = lastLog.Status
		}
		result = append(result, taskWithStatus)
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func TaskWebSocket(c *gin.Context) {
	taskIDStr := c.Param("id")
	taskID, err := strconv.Atoi(taskIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的任务ID"})
		return
	}
	websocket.ServeWs(c, uint(taskID))
}

func SetupRouter() *gin.Engine {
	r := gin.Default()
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})
	api := r.Group("/api")
	{
		tasks := api.Group("/tasks")
		{
			tasks.GET("", GetTasksWithStatus)
			tasks.GET("/:id", controllers.GetTask)
			tasks.POST("", controllers.CreateTask)
			tasks.PUT("/:id", controllers.UpdateTask)
			tasks.DELETE("/:id", controllers.DeleteTask)
			tasks.POST("/:id/start", controllers.StartTask)
			tasks.POST("/:id/stop", controllers.StopTask)
			tasks.GET("/:id/logs", controllers.GetTaskLogs)
			tasks.GET("/:id/ws", TaskWebSocket)
		}
	}
	return r
}
