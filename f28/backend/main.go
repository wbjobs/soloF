package main

import (
	"task-scheduler/config"
	"task-scheduler/models"
	"task-scheduler/scheduler"
	"task-scheduler/routes"
	"task-scheduler/websocket"
)

func main() {
	config.InitDB()
	models.Migrate(config.DB)
	scheduler.Init()
	go websocket.TaskManager.Start()
	r := routes.SetupRouter()
	r.Run(":8080")
}
