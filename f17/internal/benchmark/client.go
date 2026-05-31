package benchmark

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"sync/atomic"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"mqtt-benchmark/internal/metrics"
)

const (
	DefaultConnectTimeout  = 30 * time.Second
	DefaultDisconnectWait = 5 * time.Second
	MaxConnectRetries      = 3
)

type ClientConfig struct {
	BrokerURL    string
	ClientID     string
	Username     string
	Password     string
	QoS          byte
	KeepAlive    time.Duration
	CleanSession bool
}

type BenchmarkClient struct {
	config       ClientConfig
	client       mqtt.Client
	metrics      *metrics.Collector
	connected    int32
	disconnected int32
	publishCount uint64
	mu           sync.Mutex
}

func NewBenchmarkClient(config ClientConfig, mc *metrics.Collector) *BenchmarkClient {
	return &BenchmarkClient{
		config:  config,
		metrics: mc,
	}
}

func (bc *BenchmarkClient) Connect(ctx context.Context) error {
	bc.mu.Lock()
	defer bc.mu.Unlock()

	if atomic.LoadInt32(&bc.connected) == 1 {
		return nil
	}

	opts := mqtt.NewClientOptions()
	opts.AddBroker(bc.config.BrokerURL)
	opts.SetClientID(bc.config.ClientID)
	opts.SetUsername(bc.config.Username)
	opts.SetPassword(bc.config.Password)
	opts.SetKeepAlive(bc.config.KeepAlive)
	opts.SetCleanSession(bc.config.CleanSession)
	opts.SetAutoReconnect(false)
	opts.SetConnectTimeout(DefaultConnectTimeout)
	opts.SetOrderMatters(false)
	opts.SetWriteTimeout(10 * time.Second)

	bc.client = mqtt.NewClient(opts)
	atomic.StoreInt32(&bc.disconnected, 0)

	var lastErr error
	for retry := 0; retry < MaxConnectRetries; retry++ {
		startTime := time.Now()
		token := bc.client.Connect()

		select {
		case <-token.Done():
			if token.Error() != nil {
				lastErr = token.Error()
				bc.metrics.RecordConnection(false, time.Since(startTime))
				time.Sleep(time.Duration(retry+1) * 100 * time.Millisecond)
				continue
			}
			atomic.StoreInt32(&bc.connected, 1)
			bc.metrics.RecordConnection(true, time.Since(startTime))
			return nil
		case <-ctx.Done():
			bc.forceCleanup()
			return ctx.Err()
		}
	}

	bc.forceCleanup()
	return fmt.Errorf("connect failed after %d retries: %w", MaxConnectRetries, lastErr)
}

func (bc *BenchmarkClient) forceCleanup() {
	if bc.client != nil {
		bc.client.Disconnect(100)
	}
	atomic.StoreInt32(&bc.connected, 0)
	atomic.StoreInt32(&bc.disconnected, 1)
}

func (bc *BenchmarkClient) Disconnect() {
	bc.mu.Lock()
	defer bc.mu.Unlock()

	if atomic.LoadInt32(&bc.connected) == 1 && atomic.LoadInt32(&bc.disconnected) == 0 {
		if bc.client != nil {
			bc.client.Disconnect(uint(DefaultDisconnectWait.Milliseconds()))
		}
		atomic.StoreInt32(&bc.connected, 0)
		atomic.StoreInt32(&bc.disconnected, 1)
		bc.metrics.DecrementActiveConnections()
	}
}

func (bc *BenchmarkClient) Subscribe(topic string, qos byte) error {
	if atomic.LoadInt32(&bc.connected) != 1 {
		return fmt.Errorf("client not connected")
	}

	token := bc.client.Subscribe(topic, qos, func(client mqtt.Client, msg mqtt.Message) {
		latency := time.Since(time.Unix(0, int64(msg.Qos())))
		bc.metrics.RecordMessageLatency(latency)
		bc.metrics.IncrementMessagesReceived()
	})

	if token.WaitTimeout(10*time.Second) && token.Error() != nil {
		return fmt.Errorf("subscribe failed: %w", token.Error())
	}
	return nil
}

func (bc *BenchmarkClient) Publish(topic string, qos byte, payload []byte) error {
	if atomic.LoadInt32(&bc.connected) != 1 {
		return fmt.Errorf("client not connected")
	}

	startTime := time.Now()
	token := bc.client.Publish(topic, qos, false, payload)

	if token.WaitTimeout(5*time.Second) && token.Error() != nil {
		bc.metrics.IncrementPublishErrors()
		return fmt.Errorf("publish failed: %w", token.Error())
	}

	atomic.AddUint64(&bc.publishCount, 1)
	bc.metrics.RecordMessageLatency(time.Since(startTime))
	bc.metrics.IncrementMessagesPublished()
	return nil
}

func (bc *BenchmarkClient) IsConnected() bool {
	return atomic.LoadInt32(&bc.connected) == 1 && atomic.LoadInt32(&bc.disconnected) == 0
}

func (bc *BenchmarkClient) Reset() {
	bc.mu.Lock()
	defer bc.mu.Unlock()

	if bc.client != nil {
		bc.client.Disconnect(100)
	}
	atomic.StoreInt32(&bc.connected, 0)
	atomic.StoreInt32(&bc.disconnected, 0)
	atomic.StoreUint64(&bc.publishCount, 0)
	bc.client = nil
}

type ConnectionPool struct {
	clients    []*BenchmarkClient
	config     ClientConfig
	metrics    *metrics.Collector
	mu         sync.RWMutex
	freeList   chan *BenchmarkClient
}

func NewConnectionPool(baseConfig ClientConfig, mc *metrics.Collector, maxSize int) *ConnectionPool {
	return &ConnectionPool{
		config:   baseConfig,
		metrics:  mc,
		freeList: make(chan *BenchmarkClient, maxSize),
	}
}

func (cp *ConnectionPool) CreateClients(count int, baseClientID string) {
	cp.mu.Lock()
	defer cp.mu.Unlock()

	cp.clients = make([]*BenchmarkClient, count)
	for i := 0; i < count; i++ {
		config := cp.config
		config.ClientID = fmt.Sprintf("%s-%d", baseClientID, i)
		config.QoS = byte(rand.Intn(3))
		cp.clients[i] = NewBenchmarkClient(config, cp.metrics)
	}
}

func (cp *ConnectionPool) ConnectAll(ctx context.Context, concurrency int) (successCount int, totalCount int) {
	cp.mu.RLock()
	defer cp.mu.RUnlock()

	totalCount = len(cp.clients)
	semaphore := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	var success int32

	for _, client := range cp.clients {
		select {
		case <-ctx.Done():
			return int(atomic.LoadInt32(&success)), totalCount
		default:
		}

		semaphore <- struct{}{}
		wg.Add(1)

		go func(c *BenchmarkClient) {
			defer wg.Done()
			defer func() { <-semaphore }()

			if err := c.Connect(ctx); err == nil {
				atomic.AddInt32(&success, 1)
			}
		}(client)
	}

	wg.Wait()
	return int(atomic.LoadInt32(&success)), totalCount
}

func (cp *ConnectionPool) DisconnectAll() {
	cp.mu.RLock()
	defer cp.mu.RUnlock()

	semaphore := make(chan struct{}, 200)
	var wg sync.WaitGroup

	for _, client := range cp.clients {
		semaphore <- struct{}{}
		wg.Add(1)

		go func(c *BenchmarkClient) {
			defer wg.Done()
			defer func() { <-semaphore }()
			c.Disconnect()
		}(client)
	}

	wg.Wait()

	time.Sleep(DefaultDisconnectWait)
}

func (cp *ConnectionPool) ForceCleanup() {
	cp.mu.Lock()
	defer cp.mu.Unlock()

	semaphore := make(chan struct{}, 500)
	var wg sync.WaitGroup

	for _, client := range cp.clients {
		semaphore <- struct{}{}
		wg.Add(1)

		go func(c *BenchmarkClient) {
			defer wg.Done()
			defer func() { <-semaphore }()
			c.forceCleanup()
		}(client)
	}

	wg.Wait()
}

func (cp *ConnectionPool) ResetAll() {
	cp.mu.Lock()
	defer cp.mu.Unlock()

	for _, client := range cp.clients {
		client.Reset()
	}
}

func (cp *ConnectionPool) ReuseClients(ctx context.Context, concurrency int) (successCount int, totalCount int) {
	cp.mu.RLock()
	defer cp.mu.RUnlock()

	totalCount = len(cp.clients)
	semaphore := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	var success int32

	for _, client := range cp.clients {
		select {
		case <-ctx.Done():
			return int(atomic.LoadInt32(&success)), totalCount
		default:
		}

		if client.IsConnected() {
			atomic.AddInt32(&success, 1)
			continue
		}

		semaphore <- struct{}{}
		wg.Add(1)

		go func(c *BenchmarkClient) {
			defer wg.Done()
			defer func() { <-semaphore }()

			if err := c.Connect(ctx); err == nil {
				atomic.AddInt32(&success, 1)
			}
		}(client)
	}

	wg.Wait()
	return int(atomic.LoadInt32(&success)), totalCount
}

func (cp *ConnectionPool) SubscribeAll(topic string) (successCount int) {
	cp.mu.RLock()
	defer cp.mu.RUnlock()

	var success int32
	var wg sync.WaitGroup
	semaphore := make(chan struct{}, 200)

	for _, client := range cp.clients {
		if !client.IsConnected() {
			continue
		}
		semaphore <- struct{}{}
		wg.Add(1)

		go func(c *BenchmarkClient) {
			defer wg.Done()
			defer func() { <-semaphore }()

			qos := byte(rand.Intn(3))
			if err := c.Subscribe(topic, qos); err == nil {
				atomic.AddInt32(&success, 1)
			}
		}(client)
	}

	wg.Wait()
	return int(atomic.LoadInt32(&success))
}

func (cp *ConnectionPool) StartPublishing(ctx context.Context, topic string, msgSize int, interval time.Duration) {
	cp.mu.RLock()
	defer cp.mu.RUnlock()

	payload := make([]byte, msgSize)
	rand.Read(payload)

	for _, client := range cp.clients {
		if !client.IsConnected() {
			continue
		}

		go func(c *BenchmarkClient) {
			ticker := time.NewTicker(interval)
			defer ticker.Stop()

			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if !c.IsConnected() {
						return
					}
					qos := byte(rand.Intn(3))
					c.Publish(topic, qos, payload)
				}
			}
		}(client)
	}
}

func (cp *ConnectionPool) ConnectedCount() int {
	cp.mu.RLock()
	defer cp.mu.RUnlock()

	count := 0
	for _, client := range cp.clients {
		if client.IsConnected() {
			count++
		}
	}
	return count
}

func (cp *ConnectionPool) Size() int {
	cp.mu.RLock()
	defer cp.mu.RUnlock()
	return len(cp.clients)
}

func (cp *ConnectionPool) GetConnectionStats() (total, connected, disconnected int) {
	cp.mu.RLock()
	defer cp.mu.RUnlock()

	total = len(cp.clients)
	for _, client := range cp.clients {
		if atomic.LoadInt32(&client.connected) == 1 {
			connected++
		}
		if atomic.LoadInt32(&client.disconnected) == 1 {
			disconnected++
		}
	}
	return total, connected, disconnected
}
