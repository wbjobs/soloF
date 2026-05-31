package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

const (
	MaxEvents   = 50000
	ChannelSize = 10000
)

type ProcInfo struct {
	PID  uint32 `json:"pid"`
	Comm string `json:"comm"`
}

type Event struct {
	Type        uint32   `json:"type"`
	PID         uint32   `json:"pid"`
	SAddr       uint32   `json:"saddr"`
	DAddr       uint32   `json:"daddr"`
	SPort       uint16   `json:"sport"`
	DPort       uint16   `json:"dport"`
	Timestamp   uint64   `json:"timestamp"`
	Cookie      uint64   `json:"cookie"`
	Comm        string   `json:"comm"`
	SrcProcess  ProcInfo `json:"src_process"`
	DstProcess  ProcInfo `json:"dst_process"`
	SrcIP       string   `json:"src_ip"`
	DstIP       string   `json:"dst_ip"`
	TimeStr     string   `json:"time_str"`
}

var (
	events     []Event
	eventsMu   sync.RWMutex
	eventChan  = make(chan Event, ChannelSize)
	totalRecv  uint64
	totalDrops uint64
)

func main() {
	stopper := make(chan os.Signal, 1)
	signal.Notify(stopper, os.Interrupt, syscall.SIGTERM)

	socketPath := "/tmp/tcp-probe.sock"

	go eventWriter()
	go connectionManager(socketPath, stopper)
	go statsPrinter(stopper)

	http.HandleFunc("/api/traces", handleTraces)
	http.HandleFunc("/api/stats", handleStats)

	fmt.Println("Collector API listening on :8090")
	fmt.Println("Endpoints:")
	fmt.Println("  GET /api/traces - Get all captured events with process info")
	fmt.Println("  GET /api/stats  - Get statistics")

	go func() {
		if err := http.ListenAndServe(":8090", nil); err != nil {
			fmt.Fprintf(os.Stderr, "HTTP server error: %v\n", err)
		}
	}()

	<-stopper
	fmt.Println("\nShutting down...")
}

func eventWriter() {
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()

	var batch []Event

	for {
		select {
		case event := <-eventChan:
			batch = append(batch, event)
			if len(batch) >= 500 {
				writeBatch(batch)
				batch = batch[:0]
			}
		case <-ticker.C:
			if len(batch) > 0 {
				writeBatch(batch)
				batch = batch[:0]
			}
		}
	}
}

func writeBatch(batch []Event) {
	eventsMu.Lock()
	defer eventsMu.Unlock()

	events = append(events, batch...)
	if len(events) > MaxEvents {
		events = events[len(events)-MaxEvents:]
	}

	atomic.AddUint64(&totalRecv, uint64(len(batch)))
}

func connectionManager(socketPath string, stopper <-chan os.Signal) {
	reconnectDelay := 100 * time.Millisecond
	maxDelay := 5 * time.Second

	for {
		fmt.Printf("Connecting to probe at %s...\n", socketPath)
		conn, err := net.Dial("unix", socketPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Connection failed: %v, retrying in %v...\n", err, reconnectDelay)
			select {
			case <-time.After(reconnectDelay):
				reconnectDelay = minDuration(reconnectDelay*2, maxDelay)
				continue
			case <-stopper:
				return
			}
		}

		fmt.Println("Connected to probe!")
		reconnectDelay = 100 * time.Millisecond

		if err := readConnection(conn); err != nil {
			fmt.Fprintf(os.Stderr, "Connection error: %v\n", err)
		}
		conn.Close()

		select {
		case <-stopper:
			return
		default:
		}
	}
}

func readConnection(conn net.Conn) error {
	reader := bufio.NewReaderSize(conn, 512*1024)
	decoder := json.NewDecoder(reader)

	for {
		var event Event
		if err := decoder.Decode(&event); err != nil {
			return err
		}

		select {
		case eventChan <- event:
		default:
			atomic.AddUint64(&totalDrops, 1)
		}
	}
}

func handleTraces(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	eventsMu.RLock()
	defer eventsMu.RUnlock()

	sorted := make([]Event, len(events))
	copy(sorted, events)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Timestamp > sorted[j].Timestamp
	})

	limit := r.URL.Query().Get("limit")
	if limit != "" {
		var n int
		if _, err := fmt.Sscanf(limit, "%d", &n); err == nil && n < len(sorted) {
			sorted = sorted[:n]
		}
	}

	response := map[string]interface{}{
		"count": len(sorted),
		"data":  sorted,
	}

	json.NewEncoder(w).Encode(response)
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	eventsMu.RLock()
	eventCount := len(events)
	eventsMu.RUnlock()

	response := map[string]interface{}{
		"received":   atomic.LoadUint64(&totalRecv),
		"drops":      atomic.LoadUint64(&totalDrops),
		"stored":     eventCount,
		"max_stored": MaxEvents,
		"queue_size": len(eventChan),
		"queue_max":  ChannelSize,
		"updated_at": time.Now().Format(time.RFC3339),
	}

	json.NewEncoder(w).Encode(response)
}

func statsPrinter(stopper <-chan os.Signal) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	var lastRecv uint64

	for {
		select {
		case <-ticker.C:
			current := atomic.LoadUint64(&totalRecv)
			drops := atomic.LoadUint64(&totalDrops)
			rate := float64(current-lastRecv) / 5.0

			eventsMu.RLock()
			stored := len(events)
			eventsMu.RUnlock()

			fmt.Printf("Stats: Received=%d, Rate=%.1f evt/s, Stored=%d, Drops=%d, Queue=%d/%d\n",
				current, rate, stored, drops, len(eventChan), ChannelSize)
			lastRecv = current
		case <-stopper:
			return
		}
	}
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
