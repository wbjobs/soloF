package handlers

import (
	"net/http"
	"strconv"
	"task-scheduler/internal/database"
	"task-scheduler/internal/models"
	"task-scheduler/internal/scheduler"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type TaskHandler struct{}

func NewTaskHandler() *TaskHandler {
	return &TaskHandler{}
}

func (h *TaskHandler) CreateTask(c *gin.Context) {
	var req models.CreateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	task := &models.Task{
		Name:           req.Name,
		CronExpression: req.CronExpression,
		Command:        req.Command,
		Status:         models.TaskStatusActive,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	db := database.GetDB()
	if err := db.Create(task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create task"})
		return
	}

	s := scheduler.GetInstance()
	if err := s.AddTask(task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to schedule task"})
		return
	}

	c.JSON(http.StatusCreated, task)
}

func (h *TaskHandler) GetTasks(c *gin.Context) {
	db := database.GetDB()
	var tasks []models.Task
	if err := db.Order("created_at DESC").Find(&tasks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get tasks"})
		return
	}

	for i := range tasks {
		var lastExec models.TaskExecution
		db.Where("task_id = ?", tasks[i].ID).Order("created_at DESC").First(&lastExec)
		if lastExec.ID > 0 {
			tasks[i].LastExecution = &lastExec
		}
	}

	c.JSON(http.StatusOK, tasks)
}

func (h *TaskHandler) GetTask(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	db := database.GetDB()
	var task models.Task
	if err := db.First(&task, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get task"})
		return
	}

	var lastExec models.TaskExecution
	db.Where("task_id = ?", task.ID).Order("created_at DESC").First(&lastExec)
	if lastExec.ID > 0 {
		task.LastExecution = &lastExec
	}

	c.JSON(http.StatusOK, task)
}

func (h *TaskHandler) UpdateTaskStatus(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	var req models.UpdateTaskStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	db := database.GetDB()
	var task models.Task
	if err := db.First(&task, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get task"})
		return
	}

	task.Status = req.Status
	task.UpdatedAt = time.Now()

	if err := db.Save(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update task"})
		return
	}

	s := scheduler.GetInstance()
	s.UpdateTask(&task)

	c.JSON(http.StatusOK, task)
}

func (h *TaskHandler) DeleteTask(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	db := database.GetDB()
	if err := db.Delete(&models.Task{}, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete task"})
		return
	}

	s := scheduler.GetInstance()
	s.RemoveTask(id)

	c.JSON(http.StatusOK, gin.H{"message": "Task deleted successfully"})
}

func (h *TaskHandler) GetTaskExecutions(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	limit := 20
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}

	db := database.GetDB()
	var executions []models.TaskExecution
	if err := db.Where("task_id = ?", id).Order("created_at DESC").Limit(limit).Find(&executions).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get executions"})
		return
	}

	c.JSON(http.StatusOK, executions)
}

func (h *TaskHandler) TriggerTask(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	s := scheduler.GetInstance()
	if err := s.TriggerTask(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Task triggered successfully"})
}
