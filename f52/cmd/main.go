package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/go-redis/redis/v8"
	"iot-device-shadow/internal/api"
	"iot-device-shadow/internal/database"
	"iot-device-shadow/internal/mqtt"
	"iot-device-shadow/pkg/utils"
)

func main() {
	config := utils.LoadConfig()

	rdb := redis.NewClient(&redis.Options{
		Addr:     config.RedisAddr,
		Password: config.RedisPass,
		DB:       config.RedisDB,
	})

	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("Redis connection failed: %v", err)
	}
	log.Println("Redis connected")

	pgCfg := &database.Config{
		Host:     config.PGHost,
		Port:     config.PGPort,
		User:     config.PGUser,
		Password: config.PGPassword,
		DBName:   config.PGDBName,
		SSLMode:  config.PGSSLMode,
	}

	dbStore, err := database.NewStore(pgCfg)
	if err != nil {
		log.Printf("Warning: PostgreSQL connection failed, history feature disabled: %v", err)
		dbStore = nil
	} else {
		log.Println("PostgreSQL connected")
		defer dbStore.Close()
	}

	mqttClient := mqtt.NewClient(config, rdb, dbStore)
	if err := mqttClient.Connect(); err != nil {
		log.Fatalf("MQTT connection failed: %v", err)
	}
	defer mqttClient.Disconnect()

	handler := api.NewHandler(mqttClient, dbStore)
	router := api.SetupRouter(handler)

	go func() {
		log.Printf("API server starting on %s", config.APIPort)
		if err := router.Run(config.APIPort); err != nil {
			log.Fatalf("API server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down...")
}
