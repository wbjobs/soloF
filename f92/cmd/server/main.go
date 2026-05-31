package main

import (
	"log"
	"os"
	"time"

	"github.com/ebpf-profiler/profiler/internal/server"
)

func main() {
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	maxDur := 60 * time.Second
	if v := os.Getenv("MAX_DURATION"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			maxDur = d
		}
	}

	router, err := server.New(server.Config{
		ListenAddr: addr,
		MaxDuration: maxDur,
	})
	if err != nil {
		log.Fatalf("init server: %v", err)
	}

	log.Printf("profiler listening on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("server: %v", err)
	}
}
