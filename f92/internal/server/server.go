// Package server wires the profiler into a Gin HTTP API.
//
// Endpoints:
//
//	POST /profile         - start a single sampling run and return folded data.
//	GET  /profile/history - list stored profile records.
//	GET  /profile/history/:id - fetch a single stored record.
//	DELETE /profile/history/:id - remove a stored record.
//	GET  /ws/profile      - WebSocket streaming profile (see handlers.go).
//	GET  /processes       - list all running processes.
//	GET  /processes/find  - find PIDs by name.
//	GET  /                - debug page.
package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/ebpf-profiler/profiler/internal/profiler"
	"github.com/ebpf-profiler/profiler/internal/storage"
	"github.com/ebpf-profiler/profiler/internal/streaming"
)

// Config holds the tunables for the HTTP server.
type Config struct {
	ListenAddr string
	MaxDuration time.Duration
	Storage     storage.Backend
	StreamMgr   *streaming.Manager
}

// New constructs a *gin.Engine preconfigured with all endpoints.
func New(cfg Config) (*gin.Engine, error) {
	if cfg.ListenAddr == "" {
		cfg.ListenAddr = ":8080"
	}
	if cfg.MaxDuration == 0 {
		cfg.MaxDuration = 60 * time.Second
	}
	if cfg.Storage == nil {
		b, err := initStorage()
		if err != nil {
			return nil, err
		}
		cfg.Storage = b
	}
	if cfg.StreamMgr == nil {
		cfg.StreamMgr = streaming.NewManager(cfg.Storage)
	}

	router := gin.Default()
	router.LoadHTMLGlob("web/templates/*")
	router.Static("/static", "web/static")
	router.Static("/downloads", "downloads")

	router.GET("/", func(c *gin.Context) {
		c.HTML(http.StatusOK, "index.html", gin.H{
			"maxDurationSeconds": int(cfg.MaxDuration.Seconds()),
		})
	})

	router.POST("/profile", handleProfile(cfg))

	router.GET("/profile/history", HandleHistoryList(cfg.Storage))
	router.GET("/profile/history/:id", HandleHistoryGet(cfg.Storage))
	router.DELETE("/profile/history/:id", HandleHistoryDelete(cfg.Storage))

	router.GET("/processes", HandleProcessList)
	router.GET("/processes/find", HandleProcessSearch)

	router.GET("/ws/profile", HandleWS(cfg.StreamMgr))

	return router, nil
}

// ProfileRequest is the JSON body accepted by POST /profile.
type ProfileRequest struct {
	PID          int    `json:"pid" binding:"required"`
	DurationSec  int    `json:"duration_sec" binding:"required"`
	SampleHz     int    `json:"sample_hz"`
	ObjectPath   string `json:"object_path"`
	DownloadFile bool   `json:"download_file"`
	TargetName   string `json:"target_name,omitempty"`
	Persist      bool   `json:"persist,omitempty"`
}

// ProfileResponse is the JSON body returned on success.
type ProfileResponse struct {
	TotalSamples   uint64 `json:"total_samples"`
	DroppedSamples uint64 `json:"dropped_samples,omitempty"`
	Folded         string `json:"folded,omitempty"`
	DownloadURL    string `json:"download_url,omitempty"`
	Filename       string `json:"filename,omitempty"`
}

func handleProfile(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req ProfileRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":  "invalid request body",
				"hint":   "expected JSON with 'pid' (int) and 'duration_sec' (int) fields",
				"detail": err.Error(),
			})
			return
		}
		if req.DurationSec <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "duration_sec must be > 0"})
			return
		}
		if time.Duration(req.DurationSec)*time.Second > cfg.MaxDuration {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "duration_sec exceeds maximum",
				"max":   int(cfg.MaxDuration.Seconds()),
			})
			return
		}

		ctx := c.Request.Context()
		if c.Query("timeout") != "" {
			if t, err := strconv.Atoi(c.Query("timeout")); err == nil && t > 0 {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, time.Duration(t)*time.Second)
				defer cancel()
			}
		}

		start := time.Now()
		res, err := profiler.Profile(ctx, profiler.Options{
			PID:        req.PID,
			Duration:   time.Duration(req.DurationSec) * time.Second,
			SampleHz:   req.SampleHz,
			ObjectPath: req.ObjectPath,
		})
		if err != nil {
			code, body := mapErrToHTTP(err)
			c.JSON(code, body)
			return
		}

		if req.Persist && cfg.Storage != nil {
			rec := storage.ProfileRecord{
				ID:             newRecID(),
				TargetPID:      req.PID,
				TargetName:     req.TargetName,
				DurationSec:    req.DurationSec,
				SampleHz:       req.SampleHz,
				TotalSamples:   res.TotalSamples,
				DroppedSamples: res.DroppedSamples,
				StartedAt:      start,
				EndedAt:        time.Now(),
				Folded:         res.Folded,
				Backend:        "on-demand",
			}
			_ = cfg.Storage.Save(ctx, rec)
		}

		if !req.DownloadFile {
			c.JSON(http.StatusOK, ProfileResponse{
				TotalSamples:   res.TotalSamples,
				DroppedSamples: res.DroppedSamples,
				Folded:         res.Folded,
			})
			return
		}

		filename := "flamegraph.folded"
		if err := os.MkdirAll("downloads", 0o755); err == nil {
			filename = "flamegraph-" + time.Now().Format("20060102-150405") + ".folded"
			if err := os.WriteFile("downloads/"+filename, []byte(res.Folded), 0o644); err == nil {
				c.JSON(http.StatusOK, ProfileResponse{
					TotalSamples:   res.TotalSamples,
					DroppedSamples: res.DroppedSamples,
					DownloadURL:    "/downloads/" + filename,
					Filename:       filename,
				})
				return
			}
		}
		c.JSON(http.StatusOK, ProfileResponse{
			TotalSamples:   res.TotalSamples,
			DroppedSamples: res.DroppedSamples,
			Folded:         res.Folded,
		})
	}
}

// mapErrToHTTP converts profiler errors into HTTP responses with meaningful
// status codes. Unknown errors are returned as 500.
func mapErrToHTTP(err error) (int, gin.H) {
	switch {
	case errors.Is(err, profiler.ErrInvalidPID), errors.Is(err, profiler.ErrInvalidDuration):
		return http.StatusBadRequest, gin.H{"error": err.Error()}
	case errors.Is(err, profiler.ErrPIDNotFound):
		return http.StatusNotFound, gin.H{"error": "target pid does not exist"}
	case errors.Is(err, profiler.ErrPermission):
		return http.StatusForbidden, gin.H{
			"error": err.Error(),
			"hint":  "run the service as root or grant CAP_PERFMON and CAP_BPF",
		}
	case errors.Is(err, context.DeadlineExceeded):
		return http.StatusRequestTimeout, gin.H{"error": "sampling timed out"}
	case errors.Is(err, context.Canceled):
		return http.StatusRequestTimeout, gin.H{"error": "request canceled"}
	}
	return http.StatusInternalServerError, gin.H{"error": err.Error()}
}

// newRecID generates a short random identifier for on-demand profile
// records persisted to storage.
func newRecID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return time.Now().Format("20060102150405")
	}
	return hex.EncodeToString(b[:])
}
