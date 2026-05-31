package protocol

import (
	"context"
	"time"
)

type BenchmarkConfig struct {
	BrokerURL     string
	ClientCount   int
	Topic         string
	MessageSize   int
	PublishRate   int
	Duration      time.Duration
	QoS           int
	Username      string
	Password      string
	Concurrency   int
}

type NodeStatus struct {
	NodeID        string
	Address       string
	Status        string
	Connected     int
	TotalClients  int
	MessagesPublished uint64
	MessagesReceived uint64
	P50LatencyMs  float64
	P99LatencyMs  float64
	P999LatencyMs float64
	CPUUsage      float64
	MemoryUsageMB float64
	Goroutines    int
	LastHeartbeat time.Time
}

type AggregatedMetrics struct {
	TotalNodes            int
	ActiveNodes           int
	TotalConnections      int
	SuccessfulConnections int
	ConnectionSuccessRate float64
	TotalMessagesPublished uint64
	TotalMessagesReceived uint64
	P50LatencyMs          float64
	P99LatencyMs          float64
	P999LatencyMs         float64
	AverageThroughput     float64
	Timestamp             time.Time
}

type SlaveService interface {
	StartBenchmark(ctx context.Context, config *BenchmarkConfig) error
	StopBenchmark(ctx context.Context) error
	GetStatus(ctx context.Context) (*NodeStatus, error)
}

type MasterService interface {
	RegisterSlave(ctx context.Context, status *NodeStatus) error
	ReportMetrics(ctx context.Context, status *NodeStatus) error
	GetSlaves(ctx context.Context) ([]*NodeStatus, error)
	StartDistributedBenchmark(ctx context.Context, config *BenchmarkConfig, clientsPerSlave int) error
	StopDistributedBenchmark(ctx context.Context) error
	GetAggregatedMetrics(ctx context.Context) (*AggregatedMetrics, error)
}

const (
	StatusIdle       = "idle"
	StatusConnecting = "connecting"
	StatusRunning    = "running"
	StatusStopping   = "stopping"
	StatusFinished   = "finished"
	StatusError      = "error"
)

const (
	DefaultMasterPort = 8999
	DefaultSlavePort  = 9000
	HeartbeatInterval = 5 * time.Second
	SlaveTimeout      = 15 * time.Second
)
