package metrics

import (
	"net/http"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/montanaflynn/stats"
)

type Collector struct {
	connectionAttempts prometheus.Counter
	connectionSuccess  prometheus.Counter
	connectionFailures prometheus.Counter
	connectionLatency  prometheus.Histogram

	messagesPublished prometheus.Counter
	messagesReceived  prometheus.Counter
	publishErrors     prometheus.Counter
	messageLatency    prometheus.Histogram

	activeConnections prometheus.Gauge
	throughput        prometheus.Gauge

	latencySamples []float64
	mu             sync.RWMutex
}

func NewCollector() *Collector {
	c := &Collector{
		connectionAttempts: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "mqtt_connection_attempts_total",
			Help: "Total number of connection attempts",
		}),
		connectionSuccess: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "mqtt_connection_success_total",
			Help: "Total number of successful connections",
		}),
		connectionFailures: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "mqtt_connection_failures_total",
			Help: "Total number of failed connections",
		}),
		connectionLatency: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "mqtt_connection_latency_seconds",
			Help:    "Connection latency in seconds",
			Buckets: prometheus.ExponentialBuckets(0.001, 2, 15),
		}),
		messagesPublished: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "mqtt_messages_published_total",
			Help: "Total number of messages published",
		}),
		messagesReceived: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "mqtt_messages_received_total",
			Help: "Total number of messages received",
		}),
		publishErrors: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "mqtt_publish_errors_total",
			Help: "Total number of publish errors",
		}),
		messageLatency: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "mqtt_message_latency_seconds",
			Help:    "Message latency in seconds",
			Buckets: prometheus.ExponentialBuckets(0.0001, 2, 20),
		}),
		activeConnections: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "mqtt_active_connections",
			Help: "Current number of active connections",
		}),
		throughput: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "mqtt_throughput_messages_per_second",
			Help: "Current throughput in messages per second",
		}),
		latencySamples: make([]float64, 0, 100000),
	}

	prometheus.MustRegister(
		c.connectionAttempts,
		c.connectionSuccess,
		c.connectionFailures,
		c.connectionLatency,
		c.messagesPublished,
		c.messagesReceived,
		c.publishErrors,
		c.messageLatency,
		c.activeConnections,
		c.throughput,
	)

	return c
}

func (c *Collector) RecordConnection(success bool, latency time.Duration) {
	c.connectionAttempts.Inc()
	c.connectionLatency.Observe(latency.Seconds())
	
	if success {
		c.connectionSuccess.Inc()
		c.activeConnections.Inc()
	} else {
		c.connectionFailures.Inc()
	}
}

func (c *Collector) RecordMessageLatency(latency time.Duration) {
	c.messageLatency.Observe(latency.Seconds())
	c.mu.Lock()
	if len(c.latencySamples) < 100000 {
		c.latencySamples = append(c.latencySamples, float64(latency.Microseconds()))
	}
	c.mu.Unlock()
}

func (c *Collector) IncrementMessagesPublished() {
	c.messagesPublished.Inc()
}

func (c *Collector) IncrementMessagesReceived() {
	c.messagesReceived.Inc()
}

func (c *Collector) IncrementPublishErrors() {
	c.publishErrors.Inc()
}

func (c *Collector) SetActiveConnections(count int) {
	c.activeConnections.Set(float64(count))
}

func (c *Collector) DecrementActiveConnections() {
	c.activeConnections.Dec()
}

func (c *Collector) ResetAll() {
	c.activeConnections.Set(0)
}

func (c *Collector) SetThroughput(mps float64) {
	c.throughput.Set(mps)
}

func (c *Collector) GetLatencyPercentiles() (p50, p99, p999 float64) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if len(c.latencySamples) == 0 {
		return 0, 0, 0
	}

	p50, _ = stats.Percentile(c.latencySamples, 50)
	p99, _ = stats.Percentile(c.latencySamples, 99)
	p999, _ = stats.Percentile(c.latencySamples, 99.9)
	
	return p50 / 1000, p99 / 1000, p999 / 1000
}

func (c *Collector) ResetLatencySamples() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.latencySamples = make([]float64, 0, 100000)
}

func StartMetricsServer(addr string) {
	http.Handle("/metrics", promhttp.Handler())
	go http.ListenAndServe(addr, nil)
}

type BenchmarkResult struct {
	ConnectionSuccessRate float64
	TotalConnections      int
	SuccessfulConnections int
	P50LatencyMs          float64
	P99LatencyMs          float64
	P999LatencyMs         float64
	MessagesPublished     uint64
	MessagesReceived      uint64
	PublishErrors         uint64
	AverageThroughput     float64
	Duration              time.Duration
	Timestamp             time.Time
}
