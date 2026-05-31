package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"mqtt-benchmark/internal/benchmark"
	"mqtt-benchmark/internal/distributed/master"
	"mqtt-benchmark/internal/distributed/protocol"
	"mqtt-benchmark/internal/distributed/slave"
	"mqtt-benchmark/internal/metrics"
	"mqtt-benchmark/internal/report"
)

var (
	brokerURL       string
	clientCount     int
	topic           string
	messageSize     int
	publishRate     int
	duration        time.Duration
	qos             int
	username        string
	password        string
	metricsAddr     string
	outputPDF       string
	concurrency     int
	reuseClients    bool
	masterAddr      string
	slaveID         string
	clientsPerSlave int
)

var rootCmd = &cobra.Command{
	Use:   "mqtt-benchmark",
	Short: "MQTT Broker 压测工具 - 支持单机和分布式压测",
	Long:  `支持模拟大量并发MQTT客户端连接、订阅、发布消息，单机压测或分布式压测，集成Prometheus监控`,
}

var standaloneCmd = &cobra.Command{
	Use:   "standalone",
	Short: "单机压测模式",
	Long:  "在单机模式下运行MQTT压测",
	Run:   runBenchmark,
}

var masterCmd = &cobra.Command{
	Use:   "master",
	Short: "启动Master节点",
	Long:  "启动分布式压测的Master节点，负责协调所有Slave节点",
	Run:   runMaster,
}

var slaveCmd = &cobra.Command{
	Use:   "slave",
	Short: "启动Slave节点",
	Long:  "启动分布式压测的Slave节点，执行实际压测任务",
	Run:   runSlave,
}

var runCmd = &cobra.Command{
	Use:   "run",
	Short: "启动分布式压测",
	Long:  "向Master节点发送压测命令，启动分布式压测",
	Run:   runDistributedBenchmark,
}

var stopCmd = &cobra.Command{
	Use:   "stop",
	Short: "停止分布式压测",
	Long:  "停止所有Slave节点的压测任务",
	Run:   stopDistributedBenchmark,
}

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "查看分布式压测状态",
	Long:  "查看所有Slave节点状态和聚合指标",
	Run:   showDistributedStatus,
}

func init() {
	rootCmd.AddCommand(standaloneCmd)
	rootCmd.AddCommand(masterCmd)
	rootCmd.AddCommand(slaveCmd)
	rootCmd.AddCommand(runCmd)
	rootCmd.AddCommand(stopCmd)
	rootCmd.AddCommand(statusCmd)

	standaloneCmd.Flags().StringVarP(&brokerURL, "broker", "b", "tcp://localhost:1883", "MQTT Broker地址")
	standaloneCmd.Flags().IntVarP(&clientCount, "clients", "c", 100, "并发客户端数量 (最大10000)")
	standaloneCmd.Flags().StringVarP(&topic, "topic", "t", "benchmark/test", "MQTT主题")
	standaloneCmd.Flags().IntVarP(&messageSize, "message-size", "s", 256, "消息大小 (字节, 256-65536)")
	standaloneCmd.Flags().IntVarP(&publishRate, "rate", "r", 10, "每个客户端每秒发布消息数")
	standaloneCmd.Flags().DurationVarP(&duration, "duration", "d", 60*time.Second, "压测持续时间")
	standaloneCmd.Flags().IntVarP(&qos, "qos", "q", 0, "QoS级别 (0/1/2)")
	standaloneCmd.Flags().StringVarP(&username, "username", "u", "", "用户名")
	standaloneCmd.Flags().StringVarP(&password, "password", "p", "", "密码")
	standaloneCmd.Flags().StringVar(&metricsAddr, "metrics-addr", ":9090", "Prometheus指标暴露地址")
	standaloneCmd.Flags().StringVar(&outputPDF, "output-pdf", "", "PDF报告输出路径")
	standaloneCmd.Flags().IntVar(&concurrency, "concurrency", 500, "连接并发数")

	masterCmd.Flags().StringVarP(&metricsAddr, "listen", "l", ":8999", "Master节点监听地址")

	slaveCmd.Flags().StringVarP(&metricsAddr, "listen", "l", ":9000", "Slave节点监听地址")
	slaveCmd.Flags().StringVarP(&masterAddr, "master", "m", "localhost:8999", "Master节点地址")
	slaveCmd.Flags().StringVar(&slaveID, "id", "", "Slave节点ID (默认自动生成)")

	runCmd.Flags().StringVarP(&masterAddr, "master", "m", "localhost:8999", "Master节点地址")
	runCmd.Flags().StringVarP(&brokerURL, "broker", "b", "tcp://localhost:1883", "MQTT Broker地址")
	runCmd.Flags().IntVarP(&clientsPerSlave, "clients-per-slave", "c", 1000, "每个Slave的客户端数量")
	runCmd.Flags().StringVarP(&topic, "topic", "t", "benchmark/test", "MQTT主题")
	runCmd.Flags().IntVarP(&messageSize, "message-size", "s", 256, "消息大小 (字节, 256-65536)")
	runCmd.Flags().IntVarP(&publishRate, "rate", "r", 10, "每个客户端每秒发布消息数")
	runCmd.Flags().DurationVarP(&duration, "duration", "d", 300*time.Second, "压测持续时间")
	runCmd.Flags().IntVarP(&qos, "qos", "q", 0, "QoS级别 (0/1/2)")
	runCmd.Flags().StringVarP(&username, "username", "u", "", "用户名")
	runCmd.Flags().StringVarP(&password, "password", "p", "", "密码")
	runCmd.Flags().IntVar(&concurrency, "concurrency", 500, "每个Slave的连接并发数")

	stopCmd.Flags().StringVarP(&masterAddr, "master", "m", "localhost:8999", "Master节点地址")

	statusCmd.Flags().StringVarP(&masterAddr, "master", "m", "localhost:8999", "Master节点地址")
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

func runMaster(cmd *cobra.Command, args []string) {
	fmt.Println("=" * 70)
	fmt.Println("MQTT Distributed Benchmark - Master Node")
	fmt.Println("=" * 70)
	fmt.Printf("Listening on: %s\n", metricsAddr)
	fmt.Printf("Dashboard URL: http://%s/\n", metricsAddr)
	fmt.Println("=" * 70)

	masterNode := master.NewMasterNode(metricsAddr)
	if err := masterNode.Start(context.Background()); err != nil {
		fmt.Printf("Failed to start master: %v\n", err)
		os.Exit(1)
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	fmt.Println("\nShutting down master node...")
	masterNode.Stop(context.Background())
	fmt.Println("Master node stopped")
}

func runSlave(cmd *cobra.Command, args []string) {
	if slaveID == "" {
		hostname, _ := os.Hostname()
		slaveID = fmt.Sprintf("%s-%d", hostname, os.Getpid())
	}

	fmt.Println("=" * 70)
	fmt.Println("MQTT Distributed Benchmark - Slave Node")
	fmt.Println("=" * 70)
	fmt.Printf("Slave ID: %s\n", slaveID)
	fmt.Printf("Listening on: %s\n", metricsAddr)
	fmt.Printf("Master: %s\n", masterAddr)
	fmt.Println("=" * 70)

	slaveNode := slave.NewSlaveNode(slaveID, metricsAddr, masterAddr)
	if err := slaveNode.Start(context.Background()); err != nil {
		fmt.Printf("Failed to start slave: %v\n", err)
		os.Exit(1)
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	fmt.Println("\nShutting down slave node...")
	slaveNode.Stop(context.Background())
	fmt.Println("Slave node stopped")
}

func runDistributedBenchmark(cmd *cobra.Command, args []string) {
	fmt.Println("=" * 70)
	fmt.Println("Starting Distributed MQTT Benchmark")
	fmt.Println("=" * 70)

	config := protocol.BenchmarkConfig{
		BrokerURL:   brokerURL,
		ClientCount: clientsPerSlave,
		Topic:       topic,
		MessageSize: messageSize,
		PublishRate: publishRate,
		Duration:    duration,
		QoS:         qos,
		Username:    username,
		Password:    password,
		Concurrency: concurrency,
	}

	reqBody := map[string]interface{}{
		"broker_url":       config.BrokerURL,
		"client_count":     config.ClientCount,
		"topic":            config.Topic,
		"message_size":     config.MessageSize,
		"publish_rate":     config.PublishRate,
		"duration_ms":      config.Duration.Milliseconds(),
		"qos":              config.QoS,
		"username":         config.Username,
		"password":         config.Password,
		"concurrency":      config.Concurrency,
		"clients_per_slave": clientsPerSlave,
	}

	data, _ := json.Marshal(reqBody)
	url := fmt.Sprintf("http://%s/api/benchmark/start", masterAddr)
	resp, err := http.Post(url, "application/json", bytes.NewReader(data))
	if err != nil {
		fmt.Printf("Failed to start benchmark: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		fmt.Printf("Master returned error: %d\n", resp.StatusCode)
		os.Exit(1)
	}

	fmt.Printf("✓ Distributed benchmark started!\n")
	fmt.Printf("  Broker:        %s\n", brokerURL)
	fmt.Printf("  Clients/Slave: %d\n", clientsPerSlave)
	fmt.Printf("  Duration:      %v\n", duration)
	fmt.Printf("  Message Size:  %d bytes\n", messageSize)
	fmt.Printf("\nMonitor dashboard: http://%s/\n", masterAddr)
}

func stopDistributedBenchmark(cmd *cobra.Command, args []string) {
	url := fmt.Sprintf("http://%s/api/benchmark/stop", masterAddr)
	resp, err := http.Post(url, "application/json", nil)
	if err != nil {
		fmt.Printf("Failed to stop benchmark: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	fmt.Println("Distributed benchmark stopped")
}

func showDistributedStatus(cmd *cobra.Command, args []string) {
	slavesURL := fmt.Sprintf("http://%s/api/slaves", masterAddr)
	metricsURL := fmt.Sprintf("http://%s/api/metrics/aggregated", masterAddr)

	resp, err := http.Get(slavesURL)
	if err != nil {
		fmt.Printf("Failed to get slaves: %v\n", err)
		os.Exit(1)
	}

	var slaves []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&slaves)
	resp.Body.Close()

	resp, err = http.Get(metricsURL)
	if err != nil {
		fmt.Printf("Failed to get metrics: %v\n", err)
		os.Exit(1)
	}

	var metrics map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&metrics)
	resp.Body.Close()

	fmt.Println("=" * 70)
	fmt.Println("Distributed Benchmark Status")
	fmt.Println("=" * 70)

	fmt.Printf("\nSlave Nodes: %d\n", len(slaves))
	for _, slave := range slaves {
		fmt.Printf("  • %s (%s) - %s - %v connections\n",
			slave["node_id"], slave["address"], slave["status"], slave["connected"])
	}

	fmt.Printf("\nAggregated Metrics:\n")
	fmt.Printf("  Active Nodes:       %.0f\n", metrics["active_nodes"])
	fmt.Printf("  Total Connections:  %.0f\n", metrics["total_connections"])
	fmt.Printf("  Success Rate:       %.1f%%\n", metrics["connection_success_rate"].(float64)*100)
	fmt.Printf("  P50 Latency:        %.3f ms\n", metrics["p50_latency_ms"])
	fmt.Printf("  P99 Latency:        %.3f ms\n", metrics["p99_latency_ms"])
	fmt.Printf("  P99.9 Latency:      %.3f ms\n", metrics["p999_latency_ms"])
	fmt.Printf("  Total Messages:     %.0f\n", metrics["total_messages_published"])

	fmt.Println("\n" + strings.Repeat("=", 70))
}

func printConnectionStats(pool *benchmark.ConnectionPool, stage string) {
	total, connected, disconnected := pool.GetConnectionStats()
	fmt.Printf("[%s] 连接统计: 总数=%d, 已连接=%d, 已断开=%d\n",
		stage, total, connected, disconnected)
}

func printSystemStats(stage string) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	fmt.Printf("[%s] 系统状态: Goroutines=%d, 内存=%.2fMB\n",
		stage, runtime.NumGoroutine(), float64(m.Alloc)/1024/1024)
}

func runBenchmark(cmd *cobra.Command, args []string) {
	if clientCount > 10000 {
		fmt.Println("警告: 客户端数量超过10000，可能导致系统资源不足")
	}

	if messageSize < 256 || messageSize > 65536 {
		fmt.Printf("错误: 消息大小必须在256-65536字节之间\n")
		os.Exit(1)
	}

	fmt.Printf("="*70 + "\n")
	fmt.Printf("MQTT BROKER 压测工具启动 (单机模式)\n")
	fmt.Printf("="*70 + "\n")
	fmt.Printf("配置信息:\n")
	fmt.Printf("  Broker:        %s\n", brokerURL)
	fmt.Printf("  客户端数:      %d\n", clientCount)
	fmt.Printf("  主题:          %s\n", topic)
	fmt.Printf("  消息大小:      %d bytes\n", messageSize)
	fmt.Printf("  发布频率:      %d msg/s/client\n", publishRate)
	fmt.Printf("  压测时长:      %v\n", duration)
	fmt.Printf("  QoS:           %d\n", qos)
	fmt.Printf("  指标地址:      http://localhost%s/metrics\n", metricsAddr)
	fmt.Printf("="*70 + "\n\n")

	printSystemStats("启动")

	metricsCollector := metrics.NewCollector()
	metrics.StartMetricsServer(metricsAddr)

	clientConfig := benchmark.ClientConfig{
		BrokerURL:    brokerURL,
		Username:     username,
		Password:     password,
		KeepAlive:    30 * time.Second,
		CleanSession: true,
	}

	pool := benchmark.NewConnectionPool(clientConfig, metricsCollector, clientCount)

	fmt.Printf("正在创建 %d 个客户端...\n", clientCount)
	pool.CreateClients(clientCount, "mqtt-bench")
	printSystemStats("创建客户端后")

	ctx, cancel := context.WithTimeout(context.Background(), duration+2*time.Minute)
	defer cancel()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	fmt.Printf("开始连接客户端 (并发数: %d)...\n", concurrency)
	startTime := time.Now()

	var successCount, totalCount int
	if reuseClients {
		successCount, totalCount = pool.ReuseClients(ctx, concurrency)
	} else {
		successCount, totalCount = pool.ConnectAll(ctx, concurrency)
	}

	fmt.Printf("连接完成: %d/%d (%.2f%%)\n", successCount, totalCount,
		float64(successCount)/float64(totalCount)*100)
	printConnectionStats(pool, "连接后")
	printSystemStats("连接后")

	if successCount == 0 {
		fmt.Println("错误: 没有客户端成功连接")
		pool.ForceCleanup()
		return
	}

	fmt.Printf("开始订阅主题...\n")
	subSuccess := pool.SubscribeAll(topic)
	fmt.Printf("订阅完成: %d 个客户端\n", subSuccess)

	publishInterval := time.Duration(1000/publishRate) * time.Millisecond
	fmt.Printf("开始发布消息 (间隔: %v)...\n", publishInterval)

	publishCtx, publishCancel := context.WithTimeout(ctx, duration)
	defer publishCancel()

	pool.StartPublishing(publishCtx, topic, messageSize, publishInterval)

	fmt.Printf("\n压测进行中... (按 Ctrl+C 提前结束)\n")
	fmt.Printf("\n%10s %15s %15s %15s %15s\n",
		"时间(秒)", "活跃连接", "发布消息", "P50延迟(ms)", "Goroutines")
	fmt.Println(strings.Repeat("-", 75))

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	elapsed := 0
	for {
		select {
		case <-sigChan:
			fmt.Println("\n\n收到中断信号，停止压测...")
			cancel()
			goto finish
		case <-publishCtx.Done():
			fmt.Println("\n\n压测时间结束")
			goto finish
		case <-ticker.C:
			elapsed += 5
			p50, p99, _ := metricsCollector.GetLatencyPercentiles()
			active := pool.ConnectedCount()
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			fmt.Printf("%10d %15d %15.0f %15.3f %15d\n",
				elapsed, active, 0.0, p50, runtime.NumGoroutine())
		}
	}

finish:
	fmt.Println("\n正在优雅断开客户端连接...")

	disconnectStart := time.Now()
	pool.DisconnectAll()
	fmt.Printf("断开连接耗时: %v\n", time.Since(disconnectStart))

	printConnectionStats(pool, "断开后")
	printSystemStats("断开后")

	fmt.Println("执行强制清理...")
	pool.ForceCleanup()
	time.Sleep(1 * time.Second)

	printConnectionStats(pool, "清理后")
	printSystemStats("清理后")

	testDuration := time.Since(startTime)
	p50, p99, p999 := metricsCollector.GetLatencyPercentiles()

	result := &metrics.BenchmarkResult{
		ConnectionSuccessRate: float64(successCount) / float64(totalCount),
		TotalConnections:      totalCount,
		SuccessfulConnections: successCount,
		P50LatencyMs:          p50,
		P99LatencyMs:          p99,
		P999LatencyMs:         p999,
		MessagesPublished:     0,
		MessagesReceived:      0,
		PublishErrors:         0,
		AverageThroughput:     0,
		Duration:              testDuration,
		Timestamp:             time.Now(),
	}

	qosStr := fmt.Sprintf("QoS %d", qos)

	reportConfig := report.ReportConfig{
		BrokerURL:   brokerURL,
		ClientCount: clientCount,
		MessageSize: messageSize,
		QoSLevels:   qosStr,
	}

	report.PrintConsoleSummary(result, reportConfig)

	if outputPDF != "" {
		if err := report.GeneratePDFReport(result, reportConfig, outputPDF); err != nil {
			fmt.Printf("生成PDF报告失败: %v\n", err)
		} else {
			fmt.Printf("\nPDF报告已保存: %s\n", outputPDF)
		}
	}

	fmt.Printf("\n清理完成，等待 %d 秒确保所有资源释放...\n", 5)
	time.Sleep(5 * time.Second)
	printSystemStats("最终")

	fmt.Println("\n压测完成!")
}
