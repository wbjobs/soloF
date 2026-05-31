package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"github.com/ebpf-profiler/profiler/internal/proc"
	"github.com/ebpf-profiler/profiler/internal/storage"
	"github.com/ebpf-profiler/profiler/internal/streaming"
)

// Upgrader configures the WebSocket handshake. We allow connections from any
// origin in dev mode; production deployments should set CheckOrigin.
var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

// wsStartRequest is the JSON message that clients send to start a session.
// The target can be either a PID or a process name (for fork/exec tracking).
type wsStartRequest struct {
	Action      string `json:"action"` // "start" | "stop" | "list"
	SessionID   string `json:"session_id,omitempty"`
	TargetPID   int    `json:"target_pid,omitempty"`
	TargetName  string `json:"target_name,omitempty"`
	TickSec     int    `json:"tick_sec,omitempty"`
	SampleHz    int    `json:"sample_hz,omitempty"`
	Persist     bool   `json:"persist,omitempty"`
}

// wsMessage is the JSON envelope pushed to the client.
type wsMessage struct {
	Type    string      `json:"type"` // "tick" | "started" | "stopped" | "error" | "sessions" | "history"
	Payload interface{} `json:"payload,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// HandleWS upgrades an HTTP connection to WebSocket and runs the control
// loop for streaming profiles. The client sends a JSON start message to
// initiate a session; the server pushes ticks every 3 seconds.
func HandleWS(mgr *streaming.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			// Upgrade writes the HTTP error response itself on failure.
			return
		}
		defer conn.Close()

		subs := make(map[string]chan streaming.Tick)
		var wg sync.WaitGroup
		wg.Add(1)

		// Read loop: a single connection can start / stop many sessions.
		go func() {
			defer wg.Done()
			defer func() {
				for sid, ch := range subs {
					if s, ok := mgr.Get(sid); ok {
						s.Unsubscribe(ch)
					}
				}
			}()

			for {
				_, raw, err := conn.ReadMessage()
				if err != nil {
					return
				}
				var req wsStartRequest
				if err := json.Unmarshal(raw, &req); err != nil {
					writeWS(conn, wsMessage{Type: "error", Error: "invalid json: " + err.Error()})
					continue
				}
				switch req.Action {
				case "start":
					cfg := streaming.SessionConfig{
						TargetPID:  req.TargetPID,
						TargetName: req.TargetName,
						SampleHz:   req.SampleHz,
						Persist:    req.Persist,
					}
					if req.TickSec > 0 {
						cfg.Tick = time.Duration(req.TickSec) * time.Second
						cfg.PushEvery = cfg.Tick
					}
					sess, err := mgr.Start(context.Background(), cfg)
					if err != nil {
						writeWS(conn, wsMessage{Type: "error", Error: err.Error()})
						continue
					}
					ch := sess.Subscribe()
					subs[sess.ID()] = ch
					writeWS(conn, wsMessage{Type: "started", Payload: gin.H{
						"session_id": sess.ID(),
						"target_pid": sess.Config().TargetPID,
						"target_name": sess.Config().TargetName,
					}})
					// Forward ticks back to the WebSocket.
					go func(sid string, ch chan streaming.Tick) {
						for tick := range ch {
							writeWS(conn, wsMessage{Type: "tick", Payload: tick})
						}
					}(sess.ID(), ch)

				case "stop":
					if req.SessionID == "" {
						writeWS(conn, wsMessage{Type: "error", Error: "session_id required"})
						continue
					}
					mgr.Stop(req.SessionID)
					writeWS(conn, wsMessage{Type: "stopped", Payload: gin.H{"session_id": req.SessionID}})

				case "list":
					out := make([]gin.H, 0)
					for _, s := range mgr.List() {
						out = append(out, gin.H{
							"session_id": s.ID(),
							"target_pid": s.Config().TargetPID,
							"target_name": s.Config().TargetName,
							"started_at": s.StartedAt(),
						})
					}
					writeWS(conn, wsMessage{Type: "sessions", Payload: out})

				default:
					writeWS(conn, wsMessage{Type: "error", Error: "unknown action: " + req.Action})
				}
			}
		}()

		// Block until the read goroutine exits (connection closed or error).
		wg.Wait()
	}
}

func writeWS(conn *websocket.Conn, m wsMessage) {
	_ = conn.WriteJSON(m)
}

// ---------------------------------------------------------------------------
// History REST API
// ---------------------------------------------------------------------------

// HandleHistoryList returns stored profile records matching the given query.
func HandleHistoryList(b storage.Backend) gin.HandlerFunc {
	return func(c *gin.Context) {
		q := storage.ListQuery{
			TargetName: c.Query("target_name"),
			Since:      parseTime(c.Query("since")),
			Until:      parseTime(c.Query("until")),
		}
		if v := c.Query("target_pid"); v != "" {
			if pid, err := strconv.Atoi(v); err == nil {
				q.TargetPID = pid
			}
		}
		if v := c.Query("limit"); v != "" {
			if l, err := strconv.Atoi(v); err == nil {
				q.Limit = l
			}
		}
		recs, err := b.List(c.Request.Context(), q)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"records": recs})
	}
}

// HandleHistoryGet returns a single profile record by ID.
func HandleHistoryGet(b storage.Backend) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		rec, err := b.Load(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, storage.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, rec)
	}
}

// HandleHistoryDelete removes a stored profile record.
func HandleHistoryDelete(b storage.Backend) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if err := b.Delete(c.Request.Context(), id); err != nil {
			if errors.Is(err, storage.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"deleted": id})
	}
}

// HandleProcessSearch resolves a process name to a list of PIDs.
func HandleProcessSearch(c *gin.Context) {
	name := c.Query("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name query param required"})
		return
	}
	pids, err := proc.FindByName(name)
	if err != nil {
		if errors.Is(err, proc.ErrProcessNotFound) {
			c.JSON(http.StatusOK, gin.H{"pids": []int{}})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"pids": pids})
}

// HandleProcessList returns every running process (best-effort).
func HandleProcessList(c *gin.Context) {
	all, err := proc.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"processes": all})
}

// parseTime parses an ISO-8601 timestamp; returns zero time on error.
func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	if t, err := time.Parse("2006-01-02T15:04:05", s); err == nil {
		return t
	}
	return time.Time{}
}

// initStorage builds the appropriate storage backend based on env vars.
// If S3_BUCKET is set the S3 backend is used; otherwise a local disk
// backend under ./storage is used.
func initStorage() (storage.Backend, error) {
	if bucket := os.Getenv("S3_BUCKET"); bucket != "" {
		ctx := context.Background()
		prefix := os.Getenv("S3_PREFIX")
		return storage.NewS3Backend(ctx, bucket, prefix)
	}
	dir := os.Getenv("STORAGE_DIR")
	if dir == "" {
		dir = "storage"
	}
	return storage.NewDiskBackend(dir)
}
