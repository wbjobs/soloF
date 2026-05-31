# MQTT Broker 压测平台

一个功能强大的MQTT Broker压测平台，支持单机和分布式两种压测模式，最高支持10万级并发连接。

## 功能特性

### 单机压测模式
- 支持最多10000个并发MQTT客户端连接
- 支持QoS 0/1/2混合发布消息
- 可配置消息大小（256B - 64KB）
- 可配置发布频率

### 分布式压测模式
- Master-Slave架构，支持横向扩展
- 10个Slave节点最高支持10万并发连接
- 实时节点健康检查和心跳机制
- 集中式指标聚合
- Web仪表板实时监控

### 通用功能
- Prometheus指标实时采集
- Grafana仪表板可视化监控
- PDF压测报告导出
- TCP连接泄漏防护
- 优雅关闭和资源清理
- Docker Compose一键部署

## 项目结构

```
mqtt-benchmark/
├── cmd/
│   └── main.go              # CLI主程序
├── internal/
│   ├── benchmark/
│   │   └── client.go        # MQTT客户端和连接池实现
│   ├── metrics/
│   │   └── collector.go     # Prometheus指标收集器
│   └── report/
│       └── pdf.go           # PDF报告生成
├── configs/
│   ├── prometheus.yml       # Prometheus配置
│   └── grafana-datasource.yml  # Grafana数据源配置
├── dashboards/
│   └── mqtt-benchmark.json  # Grafana仪表板
├── docker-compose.yml       # Docker Compose配置
├── go.mod                   # Go模块依赖
└── README.md                # 本文档
```

## 快速开始

### 1. 启动监控环境

```bash
docker-compose up -d
```

这将启动以下服务：
- Mosquitto MQTT Broker (端口: 1883)
- Prometheus (端口: 9091)
- Grafana (端口: 3000)

### 2. 编译压测工具

```bash
go mod download
go build -o mqtt-benchmark ./cmd/
```

### 3. 运行压测

```bash
# 基础压测（100客户端，持续60秒）
./mqtt-benchmark -b tcp://localhost:1883 -c 100 -d 60s

# 高强度压测（1000客户端，1KB消息，每秒5条）
./mqtt-benchmark -b tcp://localhost:1883 -c 1000 -s 1024 -r 5 -d 300s

# 导出PDF报告
./mqtt-benchmark -b tcp://localhost:1883 -c 500 -d 120s --output-pdf report.pdf
```

### 4. 访问Grafana仪表板

打开浏览器访问: http://localhost:3000
- 用户名: `admin`
- 密码: `admin123`

## CLI命令说明

### 全局命令

| 命令 | 说明 |
|------|------|
| `standalone` | 单机压测模式 |
| `master` | 启动Master节点（分布式模式） |
| `slave` | 启动Slave节点（分布式模式） |
| `run` | 启动分布式压测任务 |
| `stop` | 停止分布式压测任务 |
| `status` | 查看分布式压测状态 |

### standalone 模式参数

| 参数 | 短选项 | 默认值 | 说明 |
|------|--------|--------|------|
| --broker | -b | tcp://localhost:1883 | MQTT Broker地址 |
| --clients | -c | 100 | 并发客户端数量 |
| --topic | -t | benchmark/test | MQTT主题 |
| --message-size | -s | 256 | 消息大小（字节，256-65536） |
| --rate | -r | 10 | 每个客户端每秒发布消息数 |
| --duration | -d | 60s | 压测持续时间 |
| --qos | -q | 0 | QoS级别 |
| --username | -u | | 用户名 |
| --password | -p | | 密码 |
| --metrics-addr | | :9090 | Prometheus指标暴露地址 |
| --output-pdf | | | PDF报告输出路径 |
| --concurrency | | 500 | 连接并发数 |

### master 模式参数

| 参数 | 短选项 | 默认值 | 说明 |
|------|--------|--------|------|
| --listen | -l | :8999 | Master节点监听地址 |

### slave 模式参数

| 参数 | 短选项 | 默认值 | 说明 |
|------|--------|--------|------|
| --listen | -l | :9000 | Slave节点监听地址 |
| --master | -m | localhost:8999 | Master节点地址 |
| --id | | | Slave节点ID（默认自动生成） |

### run 模式参数

| 参数 | 短选项 | 默认值 | 说明 |
|------|--------|--------|------|
| --master | -m | localhost:8999 | Master节点地址 |
| --broker | -b | tcp://localhost:1883 | MQTT Broker地址 |
| --clients-per-slave | -c | 1000 | 每个Slave的客户端数量 |
| --topic | -t | benchmark/test | MQTT主题 |
| --message-size | -s | 256 | 消息大小（字节，256-65536） |
| --rate | -r | 10 | 每个客户端每秒发布消息数 |
| --duration | -d | 300s | 压测持续时间 |
| --qos | -q | 0 | QoS级别 |
| --username | -u | | 用户名 |
| --password | -p | | 密码 |
| --concurrency | | 500 | 每个Slave的连接并发数 |

### status/stop 模式参数

| 参数 | 短选项 | 默认值 | 说明 |
|------|--------|--------|------|
| --master | -m | localhost:8999 | Master节点地址 |

## 监控指标

平台采集以下关键指标：

### 连接指标
- `mqtt_active_connections` - 当前活跃连接数
- `mqtt_connection_attempts_total` - 总连接尝试数
- `mqtt_connection_success_total` - 成功连接数
- `mqtt_connection_failures_total` - 失败连接数
- `mqtt_connection_latency_seconds` - 连接延迟分布

### 消息指标
- `mqtt_messages_published_total` - 已发布消息总数
- `mqtt_messages_received_total` - 已接收消息总数
- `mqtt_publish_errors_total` - 发布错误数
- `mqtt_message_latency_seconds` - 消息延迟分布
- `mqtt_throughput_messages_per_second` - 消息吞吐量

## Grafana仪表板

预置仪表板包含以下面板：
1. 活跃连接数统计
2. 消息延迟分布（P50/P99/P99.9）
3. 消息吞吐量
4. 消息总数统计
5. 发布错误统计

## PDF报告

生成的PDF报告包含以下内容：
- 压测配置信息
- 连接成功率统计
- 延迟分布详情（P50/P99/P99.9）
- 吞吐量统计
- 错误统计

## 性能优化建议

### 客户端侧
1. 增加文件描述符限制：`ulimit -n 65535`
2. 调整TCP参数：
```bash
sysctl -w net.ipv4.ip_local_port_range="1024 65535"
sysctl -w net.core.somaxconn=65535
```

### Broker侧
1. 确保Broker有足够的内存和CPU资源
2. 调整Broker的最大连接数配置
3. 启用持久化时注意磁盘I/O性能

## 注意事项

1. 大规模压测时请确保网络带宽充足
2. 建议在非生产环境进行高压测试
3. 注意监控系统资源使用情况
4. 超过5000客户端时建议分布式部署

## 故障排查

### 客户端连接失败
- 检查Broker是否正常运行
- 验证端口是否开放
- 检查用户名密码是否正确
- 查看Broker日志

### Prometheus无法采集指标
- 检查压测工具是否正常运行
- 验证9090端口是否可访问
- 检查防火墙设置

### Grafana无数据
- 检查Prometheus数据源配置
- 确认时间范围是否正确
- 查看Prometheus目标状态

## 许可证

MIT License
