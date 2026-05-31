package report

import (
	"fmt"
	"strings"
	"time"

	"github.com/jung-kurt/gofpdf"
	"mqtt-benchmark/internal/metrics"
)

type ReportConfig struct {
	Title       string
	BrokerURL   string
	ClientCount int
	MessageSize int
	QoSLevels   string
}

func GeneratePDFReport(result *metrics.BenchmarkResult, config ReportConfig, outputPath string) error {
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(20, 20, 20)
	pdf.AddPage()

	pdf.SetFont("Arial", "B", 24)
	pdf.Cell(0, 15, "MQTT Broker 压测报告")
	pdf.Ln(20)

	pdf.SetFont("Arial", "", 12)
	pdf.CellFormat(0, 10, fmt.Sprintf("生成时间: %s", result.Timestamp.Format("2006-01-02 15:04:05")), "", 1, "L", false, 0, "")
	pdf.CellFormat(0, 10, fmt.Sprintf("压测时长: %v", result.Duration.Round(time.Second)), "", 1, "L", false, 0, "")
	pdf.Ln(10)

	pdf.SetFont("Arial", "B", 16)
	pdf.Cell(0, 10, "一、压测配置")
	pdf.Ln(15)

	pdf.SetFont("Arial", "", 12)
	configData := [][]string{
		{"Broker地址", config.BrokerURL},
		{"客户端数量", fmt.Sprintf("%d", config.ClientCount)},
		{"消息大小", fmt.Sprintf("%d bytes", config.MessageSize)},
		{"QoS 级别", config.QoSLevels},
	}

	for _, row := range configData {
		pdf.CellFormat(60, 8, row[0], "1", 0, "L", false, 0, "")
		pdf.CellFormat(0, 8, row[1], "1", 1, "L", false, 0, "")
	}

	pdf.Ln(15)
	pdf.SetFont("Arial", "B", 16)
	pdf.Cell(0, 10, "二、连接统计")
	pdf.Ln(15)

	pdf.SetFont("Arial", "", 12)
	connectionData := [][]string{
		{"总连接数", fmt.Sprintf("%d", result.TotalConnections)},
		{"成功连接", fmt.Sprintf("%d", result.SuccessfulConnections)},
		{"连接成功率", fmt.Sprintf("%.2f%%", result.ConnectionSuccessRate*100)},
	}

	for _, row := range connectionData {
		pdf.CellFormat(60, 8, row[0], "1", 0, "L", false, 0, "")
		pdf.CellFormat(0, 8, row[1], "1", 1, "L", false, 0, "")
	}

	pdf.Ln(15)
	pdf.SetFont("Arial", "B", 16)
	pdf.Cell(0, 10, "三、消息延迟分布")
	pdf.Ln(15)

	pdf.SetFont("Arial", "", 12)
	latencyData := [][]string{
		{"P50 延迟", fmt.Sprintf("%.3f ms", result.P50LatencyMs)},
		{"P99 延迟", fmt.Sprintf("%.3f ms", result.P99LatencyMs)},
		{"P99.9 延迟", fmt.Sprintf("%.3f ms", result.P999LatencyMs)},
	}

	for _, row := range latencyData {
		pdf.CellFormat(60, 8, row[0], "1", 0, "L", false, 0, "")
		pdf.CellFormat(0, 8, row[1], "1", 1, "L", false, 0, "")
	}

	pdf.Ln(15)
	pdf.SetFont("Arial", "B", 16)
	pdf.Cell(0, 10, "四、吞吐量统计")
	pdf.Ln(15)

	pdf.SetFont("Arial", "", 12)
	throughputData := [][]string{
		{"消息发布总量", fmt.Sprintf("%d", result.MessagesPublished)},
		{"消息接收总量", fmt.Sprintf("%d", result.MessagesReceived)},
		{"发布错误数", fmt.Sprintf("%d", result.PublishErrors)},
		{"平均吞吐量", fmt.Sprintf("%.2f msg/s", result.AverageThroughput)},
	}

	for _, row := range throughputData {
		pdf.CellFormat(60, 8, row[0], "1", 0, "L", false, 0, "")
		pdf.CellFormat(0, 8, row[1], "1", 1, "L", false, 0, "")
	}

	pdf.Ln(20)
	pdf.SetFont("Arial", "I", 10)
	pdf.Cell(0, 10, "本报告由 MQTT Benchmark Tool 自动生成")

	return pdf.OutputFileAndClose(outputPath)
}

func PrintConsoleSummary(result *metrics.BenchmarkResult, config ReportConfig) {
	fmt.Println("\n" + strings.Repeat("=", 60))
	fmt.Println("MQTT BROKER 压测结果摘要")
	fmt.Println(strings.Repeat("=", 60))
	
	fmt.Printf("\n压测配置:\n")
	fmt.Printf("  Broker:        %s\n", config.BrokerURL)
	fmt.Printf("  客户端数:      %d\n", config.ClientCount)
	fmt.Printf("  消息大小:      %d bytes\n", config.MessageSize)
	fmt.Printf("  QoS 级别:      %s\n", config.QoSLevels)
	
	fmt.Printf("\n连接统计:\n")
	fmt.Printf("  成功/总数:     %d/%d\n", result.SuccessfulConnections, result.TotalConnections)
	fmt.Printf("  成功率:        %.2f%%\n", result.ConnectionSuccessRate*100)
	
	fmt.Printf("\n延迟分布:\n")
	fmt.Printf("  P50:           %.3f ms\n", result.P50LatencyMs)
	fmt.Printf("  P99:           %.3f ms\n", result.P99LatencyMs)
	fmt.Printf("  P99.9:         %.3f ms\n", result.P999LatencyMs)
	
	fmt.Printf("\n吞吐量:\n")
	fmt.Printf("  发布消息:      %d\n", result.MessagesPublished)
	fmt.Printf("  接收消息:      %d\n", result.MessagesReceived)
	fmt.Printf("  发布错误:      %d\n", result.PublishErrors)
	fmt.Printf("  平均吞吐:      %.2f msg/s\n", result.AverageThroughput)
	
	fmt.Printf("\n压测时长:        %v\n", result.Duration.Round(time.Second))
	fmt.Println(strings.Repeat("=", 60))
}
