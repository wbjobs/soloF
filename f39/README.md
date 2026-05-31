# syscall-monitor

一个使用 eBPF 技术监控系统调用的 Go 语言 CLI 工具。

## 功能特性

- 实时监控系统调用
- 显示 PID、进程名(Comm)、系统调用名称和执行时间
- 支持指定目标 PID 进行监控
- 基于 eBPF tracepoint 技术，低性能开销

## 系统要求

- Linux 内核 4.15+ (支持 eBPF tracepoint)
- Go 1.18+
- Clang/LLVM (用于编译 eBPF 程序)
- root 权限

## 安装依赖

### Ubuntu/Debian

```bash
sudo apt-get update
sudo apt-get install -y clang llvm libbpf-dev golang-go make
```

### CentOS/RHEL

```bash
sudo yum install -y clang llvm libbpf-devel golang make
```

## 构建

### 标准构建（推荐，支持 Kernel 4.15+）

```bash
# 下载依赖
make deps

# 构建项目
make
```

### 为旧内核构建（Kernel < 5.4）

如果你的内核版本低于 5.4（没有 BTF 支持），请先安装内核头文件：

```bash
# Ubuntu/Debian
sudo apt-get install linux-headers-$(uname -r)

# CentOS/RHEL
sudo yum install kernel-devel-$(uname -r)
```

然后构建：

```bash
make build-legacy
```

构建过程会：
1. 使用 bpf2go 编译 C 语言 eBPF 程序并生成 Go 绑定
2. 使用 BPF CO-RE (Compile Once - Run Everywhere) 技术兼容不同内核版本
3. 编译 Go 二进制文件

## 使用方法

### 监控所有进程的系统调用

```bash
sudo ./syscall-monitor
```

### 监控指定 PID 的系统调用

```bash
sudo ./syscall-monitor --pid 1234
# 或者
sudo ./syscall-monitor -p 1234
```

### 统计模式（推荐）

启用统计模式，按 Ctrl+C 退出时会自动汇总并打印耗时最长的 Top 10 系统调用：

```bash
sudo ./syscall-monitor --stats
# 或者
sudo ./syscall-monitor -s
```

### 安静统计模式

只统计数据，不实时打印每个系统调用（适合长时间监控）：

```bash
sudo ./syscall-monitor --stats --quiet
# 或者
sudo ./syscall-monitor -sq
```

### 结合 PID 过滤

统计模式可以和 PID 过滤结合使用：

```bash
sudo ./syscall-monitor --pid 1234 --stats
```

### 实时输出示例

```
PID       COMM              SYSCALL               DURATION(ns)
--------  ----------------  --------------------  ------------
1234      bash              read                  5000
1234      bash              write                 3200
5678      node              epoll_wait            100000
```

输出列说明：
- **PID**: 进程 ID
- **COMM**: 进程名称（最多 16 个字符）
- **SYSCALL**: 系统调用名称
- **DURATION(ns)**: 系统调用执行时间（纳秒）

### 统计模式输出示例

按 Ctrl+C 退出后显示：

```
================================================================================
SYSTEM CALL STATISTICS
================================================================================
Monitoring duration: 10.523s
Total syscalls captured: 15234
Average rate: 1447.69 syscalls/sec

SYSCALL                  COUNT       TOTAL(ms)       AVG(us)       MIN(us)       MAX(us)
--------------------  ----------  ---------------  ------------  ------------  ------------
epoll_wait               234          5234.123       22368.045         123.456      125000.000
read                    4521           892.341         197.378           0.123        5234.567
write                   3892           623.789         160.276           0.098        4123.789
open                     234           341.234        1458.265          45.678        8923.456
close                    892           234.567         262.967           8.234        2345.678
stat                     567           189.234         333.745          12.345        3456.789
fstat                    789           156.789         198.719           5.678        1567.890
ioctl                    456           123.456         270.737          15.678        2345.678
mmap                     234            98.765         422.073          23.456        1234.567
munmap                   345            76.543         221.864           9.876         876.543
```

统计输出列说明：
- **SYSCALL**: 系统调用名称
- **COUNT**: 调用次数
- **TOTAL(ms)**: 总耗时（毫秒）
- **AVG(us)**: 平均耗时（微秒）
- **MIN(us)**: 最小耗时（微秒）
- **MAX(us)**: 最大耗时（微秒）

## 项目结构

```
.
├── bpf/
│   └── syscall.bpf.c      # eBPF C 程序
├── cmd/
│   └── syscall-monitor/
│       └── main.go        # CLI 入口
├── pkg/
│   └── ebpf/
│       ├── event.go       # 事件结构体定义
│       ├── monitor.go     # eBPF 监控逻辑
│       └── syscalls.go    # 系统调用号到名称映射
├── go.mod                 # Go 模块定义
├── Makefile               # 构建脚本
└── README.md              # 说明文档
```

## eBPF 实现原理

1. **sys_enter tracepoint**: 记录系统调用开始时间，存储在 BPF_HASH map 中
2. **sys_exit tracepoint**: 从 map 中取出开始时间，计算持续时间，通过 Perf Buffer 发送到用户空间
3. **Go 用户态**: 读取 Perf Buffer 数据，解析并格式化输出

## 清理

```bash
make clean
```

## 故障排除

### "operation not permitted" 错误

确保使用 sudo 运行程序，eBPF 需要 root 权限。

### "tracepoint not found" 错误

检查内核是否支持 syscalls tracepoint：
```bash
ls /sys/kernel/debug/tracing/events/syscalls/
```

如果目录不存在，可能需要：
1. 升级内核到 4.15+ 版本
2. 挂载 debugfs: `sudo mount -t debugfs none /sys/kernel/debug`

### 编译时找不到 clang

确保已安装 clang 并在 PATH 中：
```bash
which clang
```

### 内核 < 5.4 编译失败

1. 确保已安装对应内核版本的头文件：
```bash
# Ubuntu/Debian
sudo apt-get install linux-headers-$(uname -r)

# CentOS/RHEL
sudo yum install kernel-devel-$(uname -r)
```

2. 使用 legacy 模式构建：
```bash
make build-legacy
```

3. 检查是否有 BTF 支持：
```bash
ls /sys/kernel/btf/vmlinux
```
如果文件不存在，说明内核没有编译时开启 BTF 支持，需要使用 legacy 模式。

### "struct trace_event_raw_sys_enter" 相关编译错误

这通常是内核头文件版本不匹配导致的。确保：
1. 使用的内核头文件与运行内核版本匹配
2. vmlinux.h 是从运行内核生成的（bpf2go 会自动处理）
3. 如果问题持续，可以尝试使用 `make build-legacy`

## 许可证

GPL v2 (eBPF 程序需要 GPL 许可证才能使用某些内核功能)
