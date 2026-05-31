# TCP Probe - eBPF 流量监控系统 (高性能版)

使用 Go 语言和 eBPF (通过 cilium/ebpf 库) 实现的无侵入式 TCP 流量监控系统。针对高并发场景优化，支持每秒数千事件捕获，同时关联进程信息。

## 优化亮点 (v3.0)

### 新增进程信息关联功能
- ✅ **双端进程识别**: 同时捕获客户端和服务端的 PID 与进程名
- ✅ **socket cookie 关联**: 通过内核唯一标识符关联同一连接的所有事件
- ✅ **多点捕获机制**: 在 connect、accept、state change 等多个 hook 点捕获进程信息
- ✅ **智能填充机制**: 利用 eBPF Map 存储和补全过程信息
- ✅ **API 字段扩展**: `src_process` / `dst_process` 字段包含完整进程上下文

## 优化亮点 (v2.0)

### eBPF 层优化
- ✅ **RingBuffer 取代 PerfBuffer**: 更高效的内存管理，减少数据拷贝
- ✅ **16MB 大缓冲区**: 应对突发流量峰值
- ✅ **事件结构紧凑化**: `__attribute__((packed))` 减少内存占用
- ✅ **连接去重机制**: 避免重复上报同一连接
- ✅ **自动清理过期连接**: 防止 Map 内存泄漏

### 用户态探针优化
- ✅ **多通道流水线架构**: RingBuf 读取 → 事件处理 → 批量发送
- ✅ **事件批处理 (Batch Processing)**: 每 100 个事件或 10ms 批量发送
- ✅ **10000 事件缓冲队列**: 平滑流量波动
- ✅ **原子计数统计**: 实时监控吞吐量和丢包率
- ✅ **写入超时保护**: 防止网络IO阻塞

### 收集器优化
- ✅ **异步写入架构**: 接收和存储分离，避免阻塞
- ✅ **50000 事件大容量存储**: 保留更多历史数据
- ✅ **512KB 大读取缓冲区**: 提高网络IO效率
- ✅ **按时间戳排序查询**: API 返回最新事件优先
- ✅ **重连退避机制**: 指数退避避免频繁重连
- ✅ **详细统计接口**: `/api/stats` 监控系统运行状态

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                     Kernel Space                        │
│  ┌──────────────┐     ┌──────────────┐                 │
│  │ tcp_connect  │     │ tcp_recvmsg  │  Tracepoints    │
│  └──────┬───────┘     └──────┬───────┘                 │
│         │                     │                         │
│         └──────────┬──────────┘                         │
│                    │                                    │
│              ┌─────▼──────┐                             │
│              │  eBPF Probe│                             │
│              └─────┬──────┘                             │
│                    │                                    │
│              ┌─────▼──────┐                             │
│              │ Perf Buffer│                             │
│              └─────┬──────┘                             │
└────────────────────┼────────────────────────────────────┘
                     │
┌────────────────────┼────────────────────────────────────┐
│                  User Space                             │
│              ┌─────▼──────┐                             │
│              │ Go Probe    │  Unix Domain Socket Server │
│              └─────┬──────┘                             │
│                    │                                     │
│              ┌─────▼──────┐                             │
│              │Unix Socket  │  /tmp/tcp-probe.sock       │
│              └─────┬──────┘                             │
│                    │                                     │
│              ┌─────▼──────┐                             │
│              │  Collector  │  HTTP API on :8090         │
│              └────────────┘                             │
└──────────────────────────────────────────────────────────┘
```

## 功能特性

- 无侵入式监控：不需要修改应用程序代码
- 实时捕获 TCP 连接事件 (CONNECT) 和数据接收事件 (RECV)
- 监控指定端口（默认为 8080）的流量
- 捕获源 IP、目的 IP、端口、PID、时间戳等信息
- 通过 Unix Domain Socket 高效传输数据
- 提供 RESTful HTTP API 查询捕获的数据

## 前置要求

### 系统要求
- Linux 内核 5.8+ (支持 BPF CO-RE)
- root 权限 (运行 eBPF 程序需要)
- clang/llvm 14+

### 依赖安装

```bash
# Ubuntu/Debian
sudo apt install -y clang-14 llvm-14 libbpf-dev linux-tools-$(uname -r)

# CentOS/RHEL
sudo yum install -y clang llvm libbpf-devel

# 安装 Go 依赖
go install github.com/cilium/ebpf/cmd/bpf2go@latest
```

### 获取 vmlinux.h

eBPF 程序需要 vmlinux.h 头文件，可以通过以下方式获取：

```bash
# 方式1: 使用 bpftool 从当前内核生成
bpftool btf dump file /sys/kernel/btf/vmlinux format c > headers/vmlinux.h

# 方式2: 下载对应内核版本的 vmlinux.h
# 从 https://github.com/libbpf/libbpf-bootstrap/tree/master/vmlinux 下载
```

## 编译运行

### 1. 准备工作

```bash
# 创建 headers 目录
mkdir -p headers

# 生成或下载 vmlinux.h
bpftool btf dump file /sys/kernel/btf/vmlinux format c > headers/vmlinux.h

# 下载 Go 依赖
make deps
```

### 2. 编译

```bash
# 编译所有组件
make all

# 或者单独编译
make build-probe    # 编译探针
make build-collector # 编译收集器
```

### 3. 运行

**终端 1 - 运行探针 (需要 root 权限):**
```bash
sudo make run-probe
# 或者
sudo ./bin/probe
```

**终端 2 - 运行收集器:**
```bash
make run-collector
# 或者
./bin/collector
```

**终端 3 - 测试 API:**
```bash
# 查询捕获的流量数据
curl http://localhost:8090/api/traces | jq .
```

**测试流量:**
```bash
# 启动一个测试服务
nc -l 8080

# 在另一个终端连接
nc localhost 8080
```

## API 文档

### GET /api/traces

返回所有捕获的流量事件。

**响应示例:**
```json
{
  "count": 2,
  "data": [
    {
      "type": 1,
      "pid": 12345,
      "saddr": 16777343,
      "daddr": 16777343,
      "sport": 54321,
      "dport": 8080,
      "timestamp": 1234567890123,
      "cookie": 987654321,
      "comm": "curl",
      "src_process": {
        "pid": 12345,
        "comm": "curl"
      },
      "dst_process": {
        "pid": 9876,
        "comm": "nginx"
      },
      "src_ip": "127.0.0.1",
      "dst_ip": "127.0.0.1",
      "time_str": "2024-01-15T10:30:45.123456789+08:00"
    }
  ]
}
```

**字段说明:**
- `type`: 0 = CONNECT (连接事件), 1 = RECV (数据接收事件)
- `pid`: 进程 ID
- `saddr`/`daddr`: 源/目的 IP 地址 (整数形式)
- `sport`/`dport`: 源/目的端口
- `src_ip`/`dst_ip`: 格式化的 IP 地址字符串
- `time_str`: 可读的时间戳

## 项目结构

```
.
├── Makefile              # 构建脚本
├── go.mod                # Go 模块配置
├── probe.c               # eBPF C 代码
├── headers/              # eBPF 头文件目录
│   └── vmlinux.h         # 内核类型定义 (需要自行生成)
├── probe/                # Go 探针程序
│   └── main.go
├── collector/            # Go 收集器程序
│   └── main.go
└── bin/                  # 编译输出目录
    ├── probe
    └── collector
```

## 自定义配置

### 修改监控端口

编辑 `probe.c` 中的 `TARGET_PORT` 定义:
```c
#define TARGET_PORT 8080  // 修改为你需要监控的端口
```

### 修改 API 端口

编辑 `collector/main.go` 中的监听地址:
```go
if err := http.ListenAndServe(":8090", nil); err != nil {
```

### 修改 Unix Socket 路径

修改 `probe/main.go` 和 `collector/main.go` 中的 `socketPath` 变量。

## 注意事项

1. **Windows 开发注意**: eBPF 只能在 Linux 上运行。如果你在 Windows 上开发，需要:
   - 使用 WSL2 (Windows Subsystem for Linux)
   - 使用 Linux 虚拟机
   - 使用远程 Linux 服务器

2. **权限要求**: eBPF 探针需要 root 权限运行。

3. **内核版本**: 确保 Linux 内核版本 >= 5.8，并且开启了 BPF CONFIG。

4. **防火墙**: 确保 8090 端口没有被防火墙阻止。

## 性能调优指南

### 针对 >10k QPS 场景

**1. 增大 eBPF RingBuffer (probe.c):**
```c
#define RINGBUF_SIZE (64 * 1024 * 1024)  // 从 16MB 改为 64MB
```

**2. 增大用户态缓冲区 (probe/main.go):**
```go
const (
    ChannelSize = 50000   // 从 10000 增大
    BatchSize   = 500     // 从 100 增大
)
```

**3. 增大收集器队列 (collector/main.go):**
```go
const (
    MaxEvents   = 200000  // 从 50000 增大
    ChannelSize = 50000   // 从 10000 增大
)
```

**4. 优化内核参数:**
```bash
# 增大 socket 缓冲区
sysctl -w net.core.rmem_max=16777216
sysctl -w net.core.wmem_max=16777216

# 提升 epoll 性能
sysctl -w fs.epoll.max_user_watches=1048576
```

### 监控性能指标

```bash
# 探针端输出（每5秒）
Stats: Total=125000, Dropped=0, Rate=2500.0 evt/s

# 收集器端输出
Stats: Received=125000, Rate=2500.0 evt/s, Stored=50000, Drops=0, Queue=0/10000

# 通过 API 查询
curl -s http://localhost:8090/api/stats | jq .
```

### 性能瓶颈分析

| 现象 | 可能原因 | 解决方案 |
|------|----------|----------|
| 探针 `Dropped` > 0 | RingBuffer 太小 | 增大 `RINGBUF_SIZE` |
| 收集器 `drops` > 0 | 收集器队列满 | 增大 `ChannelSize` |
| 事件丢失但两边都没 drop | Unix Socket 缓冲区满 | 增大发送 batch 大小 |
| CPU 使用率高 | JSON 序列化开销 | 考虑改用 binary 协议 |

## 故障排查

### "operation not permitted"
- 确保使用 sudo 运行探针
- 检查内核是否支持 eBPF
- 检查 `/sys/kernel/btf/vmlinux` 是否存在

### "failed to load BPF objects"
- 确保 vmlinux.h 存在且正确
- 检查内核版本是否 >= 5.8
- 确认 BTF 已开启: `grep BTF /boot/config-$(uname -r)`

### 无法连接 Unix Socket
- 检查探针是否正在运行
- 确认 /tmp/tcp-probe.sock 文件存在
- 检查文件权限: `ls -l /tmp/tcp-probe.sock`

### 高丢包率排查
```bash
# 1. 检查 RingBuffer 是否满
cat /sys/kernel/debug/tracing/perf_buffer/*/lost

# 2. 监控系统负载
htop

# 3. 检查网络栈
ss -ti
```

## 许可证

Dual BSD/GPL (与 eBPF 代码一致)
