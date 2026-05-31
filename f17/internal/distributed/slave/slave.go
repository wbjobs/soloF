package slave

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"runtime"
	"sync"
	"time"

	"mqtt-benchmark/internal/benchmark"
	"mqtt-benchmark/internal/distributed/protocol"
	"mqtt-benchmark/internal/metrics"
)

type SlaveNode struct {
	nodeID      string
	address     string
	masterAddr  string
	pool        *benchmark.ConnectionPool
	metrics     *metrics.Collector
	status      string
	config      *protocol.BenchmarkConfig
	ctx         context.Context
	cancel      context.CancelFunc
	mu          sync.RWMutex
	httpServer  *http.Server
	startTime   time.Time
}

func NewSlaveNode(nodeID, address, masterAddr string) *SlaveNode {
	ctx, cancel := context.WithCancel(context.Background())
	return &SlaveNode{
		nodeID:     nodeID,
		address:    address,
		masterAddr: masterAddr,
		status:     protocol.StatusIdle,
		ctx:        ctx,
		cancel:     cancel,
	}
}

func (s *SlaveNode) Start(ctx context.Context) error {
	s.mu.Lock()
	s.metrics = metrics.NewCollector()
	s.mu.Unlock()

	mux := http.NewServeMux()
	mux.HandleFunc("/status", s.handleStatus)
	mux.HandleFunc("/start", s.handleStart)
	mux.HandleFunc("/stop", s.handleStop)

	s.httpServer = &http.Server{
		Addr:    s.address,
		Handler: mux,
	}

	go func() {
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("Slave HTTP server error: %v\n", err)
		}
	}()

	go s.heartbeatLoop()

	fmt.Printf("Slave node %s started on %s, master: %s\n", s.nodeID, s.address, s.masterAddr)
	return nil
}

func (s *SlaveNode) Stop(ctx context.Context) error {
	s.cancel()

	if s.httpServer != nil {
		if err := s.httpServer.Shutdown(ctx); err != nil {
			return err
		}
	}

	s.mu.RLock()
	if s.pool != nil {
		s.pool.ForceCleanup()
	}
	s.mu.RUnlock()

	return nil
}

func (s *SlaveNode) StartBenchmark(ctx context.Context, config *protocol.BenchmarkConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.status == protocol.StatusRunning {
		return fmt.Errorf("benchmark already running")
	}

	s.config = config
	s.status = protocol.StatusConnecting

	clientConfig := benchmark.ClientConfig{
		BrokerURL:    config.BrokerURL,
		Username:     config.Username,
		Password:     config.Password,
		KeepAlive:    30 * time.Second,
		CleanSession: true,
	}

	s.pool = benchmark.NewConnectionPool(clientConfig, s.metrics, config.ClientCount)
	s.pool.CreateClients(config.ClientCount, fmt.Sprintf("%s-slave-%d", s.nodeID, rand.Int()))

	s.startTime = time.Now()

	go func() {
		fmt.Printf("Slave %s starting benchmark with %d clients...\n", s.nodeID, config.ClientCount)

		successCount, totalCount := s.pool.ConnectAll(context.Background(), config.Concurrency)
		fmt.Printf("Slave %s connected %d/%d clients\n", s.nodeID, successCount, totalCount)

		s.mu.Lock()
		s.status = protocol.StatusRunning
		s.mu.Unlock()

		s.pool.SubscribeAll(config.Topic)

		publishInterval := time.Duration(1000/config.PublishRate) * time.Millisecond
		benchCtx, benchCancel := context.WithTimeout(context.Background(), config.Duration)
		defer benchCancel()

		s.pool.StartPublishing(benchCtx, config.Topic, config.MessageSize, publishInterval)

		<-benchCtx.Done()

		s.mu.Lock()
		s.status = protocol.StatusStopping
		s.mu.Unlock()

		s.pool.DisconnectAll()
		s.pool.ForceCleanup()

		s.mu.Lock()
		s.status = protocol.StatusFinished
		s.mu.Unlock()

		fmt.Printf("Slave %s benchmark finished\n", s.nodeID)
	}()

	return nil
}

func (s *SlaveNode) StopBenchmark(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.pool != nil {
		s.pool.ForceCleanup()
	}

	s.status = protocol.StatusIdle
	return nil
}

func (s *SlaveNode) GetStatus(ctx context.Context) (*protocol.NodeStatus, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	status := &protocol.NodeStatus{
		NodeID:        s.nodeID,
		Address:       s.address,
		Status:        s.status,
		TotalClients:  s.config.ClientCount,
		Goroutines:    runtime.NumGoroutine(),
		MemoryUsageMB: float64(m.Alloc) / 1024 / 1024,
		LastHeartbeat: time.Now(),
	}

	if s.pool != nil {
		status.Connected = s.pool.ConnectedCount()
		p50, p99, p999 := s.metrics.GetLatencyPercentiles()
		status.P50LatencyMs = p50
		status.P99LatencyMs = p99
		status.P999LatencyMs = p999
	}

	return status, nil
}

func (s *SlaveNode) heartbeatLoop() {
	ticker := time.NewTicker(protocol.HeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.sendHeartbeat()
		}
	}
}

func (s *SlaveNode) sendHeartbeat() {
	status, err := s.GetStatus(s.ctx)
	if err != nil {
		return
	}

	data, err := json.Marshal(status)
	if err != nil {
		return
	}

	url := fmt.Sprintf("http://%s/api/slaves/heartbeat", s.masterAddr)
	req, err := http.NewRequest("POST", url, bytes.NewReader(data))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 5 * time.Second}
	client.Do(req)
}

func (s *SlaveNode) handleStatus(w http.ResponseWriter, r *http.Request) {
	status, err := s.GetStatus(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

func (s *SlaveNode) handleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var config protocol.BenchmarkConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := s.StartBenchmark(r.Context(), &config); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (s *SlaveNode) handleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := s.StopBenchmark(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

import "bytes"
