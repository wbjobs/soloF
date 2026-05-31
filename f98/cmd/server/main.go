package main

import (
	"log"

	"github.com/gin-gonic/gin"
	"zk-voting-system/backend"
)

func main() {
	storage := backend.NewStorage()

	if err := storage.LoadFromFile("polls.json"); err != nil {
		log.Printf("Warning: could not load existing polls: %v", err)
	}

	handler := backend.NewHandler(storage)

	r := gin.Default()

	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	api := r.Group("/api/v1")
	{
		polls := api.Group("/polls")
		{
			polls.POST("", handler.CreatePoll)
			polls.GET("", handler.ListPolls)
			polls.GET("/:id", handler.GetPoll)
			polls.POST("/:id/vote", handler.CastVote)
			polls.POST("/:id/tally", handler.TallyVotes)
			polls.POST("/:id/close", handler.ClosePoll)
			polls.GET("/:id/export", handler.ExportProofs)
			polls.POST("/:id/backup", handler.CreateBackup)
			polls.GET("/:id/backup", handler.DownloadBackup)
		}

		whitelist := api.Group("/whitelist")
		{
			whitelist.POST("", handler.AddToWhitelist)
			whitelist.GET("/proof", handler.GetMerkleProof)
			whitelist.GET("/root", handler.GetMerkleRoot)
		}
	}

	log.Println("Starting zk-voting server on :8080...")
	if err := r.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
