package main

import (
	"log"
	"ota-center/internal/mqtt"
	"ota-center/internal/server"
)

func main() {
	mqttBroker := mqtt.NewBroker()
	go mqttBroker.Start()

	httpServer := server.NewHTTPServer(mqttBroker)
	log.Fatal(httpServer.Start(":8080"))
}
