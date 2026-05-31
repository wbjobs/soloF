package controllers

import (
	"net/http"
	"task-scheduler/config"
	"task-scheduler/models"
	"task-scheduler/scheduler"
	"task-scheduler/utils"
	"github.com/gin-gonic/gin"
)

func GetTasks(c *gin.Context) {
	var tasks []models.Task
	config.DB.Find(&tasks)
	c.JSON(http.StatusOK, gin.H{"data": tasks})
}

func GetTask(c *gin.Context) {
	var task models.Task
	if err := config.DB.Where("id = ?", c.Param("id")).First(&task).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": task})
}

func CreateTask(c *gin.Context) {
	var input models.Task
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	task := models.Task{
		Name:       input.Name,
		CronExpr:   input.CronExpr,
		Command:    input.Command,
		Dependency: input.Dependency,
		Status:     "stopped",
	}
	tx := config.DB.Begin()
	if err := tx.Create(&task).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建任务失败"})
		return
	}
	if utils.CheckCyclicDependency(task.ID, task.Dependency) {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "存在循环依赖"})
		return
	}
	tx.Commit()
	c.JSON(http.StatusOK, gin.H{"data": task})
}

func UpdateTask(c *gin.Context) {
	var task models.Task
	if err := config.DB.Where("id = ?", c.Param("id")).First(&task).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	var input models.Task
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if utils.CheckCyclicDependency(task.ID, input.Dependency) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "存在循环依赖"})
		return
	}
	config.DB.Model(&task).Updates(input)
	c.JSON(http.StatusOK, gin.H{"data": task})
}

func DeleteTask(c *gin.Context) {
	var task models.Task
	if err := config.DB.Where("id = ?", c.Param("id")).First(&task).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	if isDepended, byTask := utils.CheckTaskIsDepended(task.ID); isDepended {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该任务被任务 \"" + byTask + "\" 依赖，无法删除"})
		return
	}
	scheduler.StopTask(int(task.ID))
	config.DB.Delete(&task)
	c.JSON(http.StatusOK, gin.H{"data": true})
}

func StartTask(c *gin.Context) {
	var task models.Task
	if err := config.DB.Where("id = ?", c.Param("id")).First(&task).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	if err := scheduler.StartTask(&task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "启动任务失败"})
		return
	}
	task.Status = "running"
	config.DB.Save(&task)
	c.JSON(http.StatusOK, gin.H{"data": task})
}

func StopTask(c *gin.Context) {
	var task models.Task
	if err := config.DB.Where("id = ?", c.Param("id")).First(&task).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	scheduler.StopTask(int(task.ID))
	task.Status = "stopped"
	config.DB.Save(&task)
	c.JSON(http.StatusOK, gin.H{"data": task})
}

func GetTaskLogs(c *gin.Context) {
	var logs []models.TaskLog
	config.DB.Where("task_id = ?", c.Param("id")).Order("start_time desc").Find(&logs)
	c.JSON(http.StatusOK, gin.H{"data": logs})
}
