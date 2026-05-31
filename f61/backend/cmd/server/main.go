package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"task-scheduler/internal/api/routes"
	"task-scheduler/internal/config"
	"task-scheduler/internal/database"
	"task-scheduler/internal/scheduler"

	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	cfg := config.Load()

	if err := database.Init(cfg); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	log.Println("Database initialized successfully")

	s := scheduler.GetInstance()
	if err := s.LoadTasksFromDB(); err != nil {
		log.Printf("Warning: Failed to load tasks from DB: %v", err)
	}
	s.Start()
	log.Println("Scheduler started")

	r := routes.SetupRouter()

	go func() {
		addr := fmt.Sprintf(":%d", cfg.ServerPort)
		log.Printf("Server starting on %s", addr)
		if err := r.Run(addr); err != nil {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	s.Shutdown()
	log.Println("Scheduler stopped")
}
