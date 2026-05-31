package master

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"mqtt-benchmark/internal/distributed/protocol"
)

type MasterNode struct {
	address      string
	slaves       map[string]*protocol.NodeStatus
	slavesLock   sync.RWMutex
	config       *protocol.BenchmarkConfig
	status       string
	ctx          context.Context
	cancel       context.CancelFunc
	httpServer   *http.Server

	activeConnections   prometheus.Gauge
	totalConnections    prometheus.Gauge
	totalMessages       prometheus.Gauge
	latencyP50          prometheus.Gauge
	latencyP99          prometheus.Gauge
	latencyP999         prometheus.Gauge
	slaveCount          prometheus.Gauge
	throughput          prometheus.Gauge
}

func NewMasterNode(address string) *MasterNode {
	ctx, cancel := context.WithCancel(context.Background())
	m := &MasterNode{
		address: address,
		slaves:  make(map[string]*protocol.NodeStatus),
		status:  protocol.StatusIdle,
		ctx:     ctx,
		cancel:  cancel,
	}
	m.initMetrics()
	return m
}

func (m *MasterNode) initMetrics() {
	m.activeConnections = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "distributed_active_connections",
		Help: "Total active connections across all slaves",
	})
	m.totalConnections = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "distributed_total_connections",
		Help: "Total connections across all slaves",
	})
	m.totalMessages = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "distributed_messages_total",
		Help: "Total messages published across all slaves",
	})
	m.latencyP50 = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "distributed_latency_p50_ms",
		Help: "P50 message latency in ms",
	})
	m.latencyP99 = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "distributed_latency_p99_ms",
		Help: "P99 message latency in ms",
	})
	m.latencyP999 = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "distributed_latency_p999_ms",
		Help: "P99.9 message latency in ms",
	})
	m.slaveCount = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "distributed_slave_count",
		Help: "Number of active slave nodes",
	})
	m.throughput = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "distributed_throughput_msg_per_sec",
		Help: "Total messages per second across all slaves",
	})

	prometheus.MustRegister(m.activeConnections)
	prometheus.MustRegister(m.totalConnections)
	prometheus.MustRegister(m.totalMessages)
	prometheus.MustRegister(m.latencyP50)
	prometheus.MustRegister(m.latencyP99)
	prometheus.MustRegister(m.latencyP999)
	prometheus.MustRegister(m.slaveCount)
	prometheus.MustRegister(m.throughput)
}

func (m *MasterNode) Start(ctx context.Context) error {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/slaves/heartbeat", m.handleHeartbeat)
	mux.HandleFunc("/api/slaves", m.handleSlaves)
	mux.HandleFunc("/api/benchmark/start", m.handleStartBenchmark)
	mux.HandleFunc("/api/benchmark/stop", m.handleStopBenchmark)
	mux.HandleFunc("/api/benchmark/status", m.handleBenchmarkStatus)
	mux.HandleFunc("/api/metrics/aggregated", m.handleAggregatedMetrics)
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/", m.handleDashboard)

	m.httpServer = &http.Server{
		Addr:    m.address,
		Handler: mux,
	}

	go m.cleanupStaleSlaves()
	go m.updateMetricsLoop()

	go func() {
		if err := m.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("Master HTTP server error: %v\n", err)
		}
	}()

	fmt.Printf("Master node started on %s\n", m.address)
	fmt.Printf("Dashboard available at: http://%s/\n", m.address)
	return nil
}

func (m *MasterNode) Stop(ctx context.Context) error {
	m.cancel()

	if m.httpServer != nil {
		if err := m.httpServer.Shutdown(ctx); err != nil {
			return err
		}
	}

	return nil
}

func (m *MasterNode) RegisterSlave(ctx context.Context, status *protocol.NodeStatus) error {
	m.slavesLock.Lock()
	defer m.slavesLock.Unlock()

	status.LastHeartbeat = time.Now()
	m.slaves[status.NodeID] = status

	fmt.Printf("Slave registered: %s (%s)\n", status.NodeID, status.Address)
	return nil
}

func (m *MasterNode) ReportMetrics(ctx context.Context, status *protocol.NodeStatus) error {
	m.slavesLock.Lock()
	defer m.slavesLock.Unlock()

	if existing, ok := m.slaves[status.NodeID]; ok {
		existing.Status = status.Status
		existing.Connected = status.Connected
		existing.TotalClients = status.TotalClients
		existing.MessagesPublished = status.MessagesPublished
		existing.MessagesReceived = status.MessagesReceived
		existing.P50LatencyMs = status.P50LatencyMs
		existing.P99LatencyMs = status.P99LatencyMs
		existing.P999LatencyMs = status.P999LatencyMs
		existing.CPUUsage = status.CPUUsage
		existing.MemoryUsageMB = status.MemoryUsageMB
		existing.Goroutines = status.Goroutines
		existing.LastHeartbeat = time.Now()
	}

	return nil
}

func (m *MasterNode) GetSlaves(ctx context.Context) ([]*protocol.NodeStatus, error) {
	m.slavesLock.RLock()
	defer m.slavesLock.RUnlock()

	slaves := make([]*protocol.NodeStatus, 0, len(m.slaves))
	for _, slave := range m.slaves {
		slaves = append(slaves, slave)
	}
	return slaves, nil
}

func (m *MasterNode) StartDistributedBenchmark(ctx context.Context, config *protocol.BenchmarkConfig, clientsPerSlave int) error {
	m.slavesLock.Lock()
	m.config = config
	m.status = protocol.StatusRunning
	m.slavesLock.Unlock()

	slaves, _ := m.GetSlaves(ctx)
	if len(slaves) == 0 {
		return fmt.Errorf("no slaves registered")
	}

	slaveConfig := *config
	slaveConfig.ClientCount = clientsPerSlave

	var wg sync.WaitGroup
	for _, slave := range slaves {
		wg.Add(1)
		go func(s *protocol.NodeStatus) {
			defer wg.Done()
			if err := m.sendStartCommand(s.Address, &slaveConfig); err != nil {
				fmt.Printf("Failed to start benchmark on slave %s: %v\n", s.NodeID, err)
			}
		}(slave)
	}
	wg.Wait()

	fmt.Printf("Distributed benchmark started with %d slaves, %d total clients\n",
		len(slaves), len(slaves)*clientsPerSlave)
	return nil
}

func (m *MasterNode) StopDistributedBenchmark(ctx context.Context) error {
	slaves, _ := m.GetSlaves(ctx)

	var wg sync.WaitGroup
	for _, slave := range slaves {
		wg.Add(1)
		go func(s *protocol.NodeStatus) {
			defer wg.Done()
			m.sendStopCommand(s.Address)
		}(slave)
	}
	wg.Wait()

	m.slavesLock.Lock()
	m.status = protocol.StatusIdle
	m.slavesLock.Unlock()

	fmt.Println("Distributed benchmark stopped")
	return nil
}

func (m *MasterNode) GetAggregatedMetrics(ctx context.Context) (*protocol.AggregatedMetrics, error) {
	m.slavesLock.RLock()
	defer m.slavesLock.RUnlock()

	var (
		totalNodes            = len(m.slaves)
		activeNodes           = 0
		totalConnections      = 0
		successfulConnections = 0
		totalPublished        uint64
		totalReceived         uint64
		latencySamples        []float64
	)

	for _, slave := range m.slaves {
		if time.Since(slave.LastHeartbeat) < protocol.SlaveTimeout {
			activeNodes++
		}
		totalConnections += slave.TotalClients
		successfulConnections += slave.Connected
		totalPublished += slave.MessagesPublished
		totalReceived += slave.MessagesReceived
		if slave.P50LatencyMs > 0 {
			latencySamples = append(latencySamples, slave.P50LatencyMs)
		}
	}

	var p50, p99, p999 float64
	if len(latencySamples) > 0 {
		sort.Float64s(latencySamples)
		p50 = percentile(latencySamples, 50)
		p99 = percentile(latencySamples, 99)
		p999 = percentile(latencySamples, 99.9)
	}

	successRate := 0.0
	if totalConnections > 0 {
		successRate = float64(successfulConnections) / float64(totalConnections)
	}

	return &protocol.AggregatedMetrics{
		TotalNodes:            totalNodes,
		ActiveNodes:           activeNodes,
		TotalConnections:      totalConnections,
		SuccessfulConnections: successfulConnections,
		ConnectionSuccessRate: successRate,
		TotalMessagesPublished: totalPublished,
		TotalMessagesReceived:  totalReceived,
		P50LatencyMs:          p50,
		P99LatencyMs:          p99,
		P999LatencyMs:         p999,
		Timestamp:             time.Now(),
	}, nil
}

func (m *MasterNode) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var status protocol.NodeStatus
	if err := json.NewDecoder(r.Body).Decode(&status); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := m.ReportMetrics(r.Context(), &status); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (m *MasterNode) handleSlaves(w http.ResponseWriter, r *http.Request) {
	slaves, err := m.GetSlaves(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(slaves)
}

func (m *MasterNode) handleStartBenchmark(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		protocol.BenchmarkConfig
		ClientsPerSlave int `json:"clients_per_slave"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := m.StartDistributedBenchmark(r.Context(), &req.BenchmarkConfig, req.ClientsPerSlave); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (m *MasterNode) handleStopBenchmark(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := m.StopDistributedBenchmark(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (m *MasterNode) handleBenchmarkStatus(w http.ResponseWriter, r *http.Request) {
	m.slavesLock.RLock()
	status := m.status
	m.slavesLock.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": status,
	})
}

func (m *MasterNode) handleAggregatedMetrics(w http.ResponseWriter, r *http.Request) {
	metrics, err := m.GetAggregatedMetrics(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}

func (m *MasterNode) handleDashboard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html")
	fmt.Fprintf(w, `
<!DOCTYPE html>
<html>
<head>
    <title>MQTT Distributed Benchmark - Master Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        h1 { color: #333; }
        .card { background: white; padding: 20px; margin: 10px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .metric { display: inline-block; margin: 10px 20px; }
        .value { font-size: 32px; font-weight: bold; color: #2196F3; }
        .label { font-size: 14px; color: #666; }
        .slave-list { margin-top: 20px; }
        .slave-item { background: #f9f9f9; padding: 10px; margin: 5px 0; border-radius: 4px; }
        .status-running { color: #4CAF50; font-weight: bold; }
        .status-idle { color: #9E9E9E; }
    </style>
</head>
<body>
    <h1>MQTT Distributed Benchmark - Master Dashboard</h1>
    
    <div class="card">
        <h2>Aggregated Metrics</h2>
        <div class="metric"><div class="value" id="slaveCount">0</div><div class="label">Active Slaves</div></div>
        <div class="metric"><div class="value" id="connections">0</div><div class="label">Active Connections</div></div>
        <div class="metric"><div class="value" id="p50">0 ms</div><div class="label">P50 Latency</div></div>
        <div class="metric"><div class="value" id="p99">0 ms</div><div class="label">P99 Latency</div></div>
    </div>

    <div class="card">
        <h2>Slave Nodes</h2>
        <div class="slave-list" id="slaveList"></div>
    </div>

    <script>
        function refreshDashboard() {
            fetch('/api/metrics/aggregated')
                .then(res => res.json())
                .then(data => {
                    document.getElementById('slaveCount').textContent = data.active_nodes;
                    document.getElementById('connections').textContent = data.successful_connections;
                    document.getElementById('p50').textContent = data.p50_latency_ms.toFixed(3) + ' ms';
                    document.getElementById('p99').textContent = data.p99_latency_ms.toFixed(3) + ' ms';
                });

            fetch('/api/slaves')
                .then(res => res.json())
                .then(slaves => {
                    const list = document.getElementById('slaveList');
                    list.innerHTML = '';
                    slaves.forEach(slave => {
                        const div = document.createElement('div');
                        div.className = 'slave-item';
                        div.innerHTML = '<strong>' + slave.node_id + '</strong> (' + slave.address + 
                            ') - Status: <span class="status-' + slave.status + '">' + slave.status + 
                            '</span> - ' + slave.connected + '/' + slave.total_clients + ' connections';
                        list.appendChild(div);
                    });
                });
        }
        refreshDashboard();
        setInterval(refreshDashboard, 5000);
    </script>
</body>
</html>
	`)
}

func (m *MasterNode) sendStartCommand(addr string, config *protocol.BenchmarkConfig) error {
	data, err := json.Marshal(config)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("http://%s/start", addr)
	resp, err := http.Post(url, "application/json", bytes.NewReader(data))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	return nil
}

func (m *MasterNode) sendStopCommand(addr string) error {
	url := fmt.Sprintf("http://%s/stop", addr)
	resp, err := http.Post(url, "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

func (m *MasterNode) cleanupStaleSlaves() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-m.ctx.Done():
			return
		case <-ticker.C:
			m.slavesLock.Lock()
			for id, slave := range m.slaves {
				if time.Since(slave.LastHeartbeat) > protocol.SlaveTimeout {
					delete(m.slaves, id)
					fmt.Printf("Slave %s removed due to timeout\n", id)
				}
			}
			m.slavesLock.Unlock()
		}
	}
}

func (m *MasterNode) updateMetricsLoop() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-m.ctx.Done():
			return
		case <-ticker.C:
			metrics, _ := m.GetAggregatedMetrics(m.ctx)
			m.activeConnections.Set(float64(metrics.SuccessfulConnections))
			m.totalConnections.Set(float64(metrics.TotalConnections))
			m.totalMessages.Set(float64(metrics.TotalMessagesPublished))
			m.latencyP50.Set(metrics.P50LatencyMs)
			m.latencyP99.Set(metrics.P99LatencyMs)
			m.latencyP999.Set(metrics.P999LatencyMs)
			m.slaveCount.Set(float64(metrics.ActiveNodes))
		}
	}
}

func percentile(samples []float64, p float64) float64 {
	if len(samples) == 0 {
		return 0
	}
	index := int(float64(len(samples)-1) * p / 100)
	if index >= len(samples) {
		index = len(samples) - 1
	}
	return samples[index]
}
