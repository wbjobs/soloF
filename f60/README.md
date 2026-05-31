# trace-cli - 高性能分布式日志聚合工具

一个使用 Zig 语言编写的高性能日志聚合 CLI 工具，支持从多个远程服务器读取日志，按 Trace-ID 过滤，并按时间轴聚合输出。

## 功能特性

- 🔄 **多源日志读取**: 通过 SSH 从多个远程服务器流式读取日志
- 🔍 **Trace-ID 过滤**: 基于 Trace-ID 过滤分散在不同服务中的日志
- ⏱️ **时间轴聚合**: 自动按时间戳排序，还原完整调用链路
- 🎨 **彩色终端输出**: 不同服务显示不同颜色，便于区分
- 🚀 **高性能**: 多线程并发读取，内存高效管理
- 📁 **灵活配置**: 支持 JSON 配置文件或命令行参数

## 架构设计

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  SSH Reader 1   │────▶│                 │────▶│                 │
├─────────────────┤     │   Log Parser    │     │  Color Output   │
│  SSH Reader 2   │────▶│                 │────▶│                 │
├─────────────────┤     └─────────────────┘     └─────────────────┘
│      ...        │              │                        ▲
├─────────────────┤              ▼                        │
│  SSH Reader N   │     ┌─────────────────┐               │
└─────────────────┘     │   Aggregator    │───────────────┘
                        └─────────────────┘
                               ▲
                               │
                        ┌─────────────────┐
                        │   Sort & Filter │
                        └─────────────────┘
```

## 项目结构

```
trace-cli/
├── build.zig              # Zig 构建配置
├── config.example.json    # 配置文件示例
├── README.md              # 项目文档
├── sample_logs/           # 示例日志文件
│   ├── gateway.log
│   ├── auth.log
│   └── order.log
└── src/
    ├── main.zig           # 主程序入口
    ├── types.zig          # 类型定义
    ├── ssh_reader.zig     # SSH 日志读取模块
    ├── log_parser.zig     # 日志解析模块
    ├── aggregator.zig     # 日志聚合模块
    ├── color_output.zig   # 彩色输出模块
    └── config.zig         # 配置加载模块
```

## 安装

### 前置要求

- Zig 0.13.0 或更高版本

### 构建

```bash
# 克隆项目
git clone <repository-url>
cd trace-cli

# 构建 Release 版本
zig build -Doptimize=ReleaseSafe

# 可执行文件将在 zig-out/bin/trace-cli
```

## 使用方法

### 1. 使用配置文件

创建 `config.json`:

```json
{
  "services": [
    {
      "name": "gateway",
      "host": "192.168.1.100",
      "user": "admin",
      "port": 22,
      "log_path": "/var/log/gateway/app.log",
      "color": "cyan"
    },
    {
      "name": "auth",
      "host": "192.168.1.101",
      "user": "admin",
      "log_path": "/var/log/auth/app.log",
      "color": "green"
    }
  ]
}
```

运行：

```bash
# 读取最近 100 行，按 Trace-ID 过滤
trace-cli -c config.json -t abc123def456

# 实时跟踪日志
trace-cli -c config.json -t abc123def456 -f

# 指定读取行数
trace-cli -c config.json -t abc123def456 -n 500
```

### 2. 使用命令行参数

```bash
trace-cli \
  -s gateway:admin@192.168.1.100:/var/log/gateway.log \
  -s auth:admin@192.168.1.101:/var/log/auth.log \
  -s order:admin@192.168.1.102:/var/log/order.log \
  -t abc123def456
```

### 命令行选项

| 选项 | 缩写 | 说明 | 默认值 |
|------|------|------|--------|
| `--config <path>` | `-c` | 配置文件路径 | - |
| `--trace-id <id>` | `-t` | 要过滤的 Trace-ID | - |
| `--follow` | `-f` | 实时跟踪日志 (类似 tail -f) | false |
| `--lines <num>` | `-n` | 读取的日志行数 | 100 |
| `--service <spec>` | `-s` | 服务规格: name:user@host:log_path | - |
| `--help` | `-h` | 显示帮助信息 | - |

### 支持的颜色

- `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`
- `bright_black`, `bright_red`, `bright_green`, `bright_yellow`, `bright_blue`, `bright_magenta`, `bright_cyan`, `bright_white`

## 日志格式支持

工具可以自动解析以下常见的日志格式：

### 文本格式
```
2024-01-15T10:30:01.123Z INFO  [gateway] trace_id=abc123def456 Request received
```

### JSON 格式
```json
{"timestamp":"2024-01-15T10:30:01.123Z","level":"INFO","trace_id":"abc123def456","message":"Request received"}
```

### 支持的 Trace-ID 格式
- `trace_id=xxx`
- `traceId=xxx`
- `X-B3-TraceId: xxx`
- `"trace_id":"xxx"`
- 16 或 32 位十六进制字符串

## 输出示例

```
╔══════════════════════════════════════════════════════════════════════════╗
║ Trace-ID: abc123def456
╠══════════════════════════════════════════════════════════════════════════╣
Services: gateway, auth, order
[2024-01-15 10:30:01] INFO     gateway    abc123def456 Request received: GET /api/v1/order/123
[2024-01-15 10:30:01] INFO     gateway    abc123def456 Routing to auth-service
[2024-01-15 10:30:01] INFO     auth       abc123def456 Validating token for user: user@example.com
[2024-01-15 10:30:01] DEBUG    auth       abc123def456 Token valid, roles: [user, admin]
[2024-01-15 10:30:01] INFO     auth       abc123def456 Authentication successful
[2024-01-15 10:30:01] INFO     gateway    abc123def456 Auth passed, forwarding to order-service
[2024-01-15 10:30:01] INFO     order      abc123def456 Fetching order #123 from database
[2024-01-15 10:30:01] DEBUG    order      abc123def456 Order found: status=completed, total=$99.99
[2024-01-15 10:30:02] INFO     order      abc123def456 Preparing order response
[2024-01-15 10:30:02] INFO     gateway    abc123def456 Response sent: 200 OK
╠══════════════════════════════════════════════════════════════════════════╣
║ Total: 14 | Filtered: 10 | Services: 3
╚══════════════════════════════════════════════════════════════════════════╝
```

## 本地测试

使用提供的示例日志进行本地测试：

```bash
# 首先将示例日志复制到可访问的位置
cp -r sample_logs /tmp/

# 模拟 SSH 访问（需要本地 SSH 服务）
trace-cli \
  -s gateway:$USER@localhost:/tmp/sample_logs/gateway.log \
  -s auth:$USER@localhost:/tmp/sample_logs/auth.log \
  -s order:$USER@localhost:/tmp/sample_logs/order.log \
  -t abc123def456
```

## 性能特性

- **并发读取**: 每个服务在独立线程中读取，互不阻塞
- **流式处理**: 边读取边解析，内存占用低
- **高效排序**: 使用 Zig 标准库的快速排序实现
- **内存安全**: 完整的资源管理，无内存泄漏

## 故障排除

### SSH 连接失败
- 确保目标主机的 SSH 服务正在运行
- 检查 SSH 密钥配置或使用 ssh-agent
- 确认目标主机在 `~/.ssh/known_hosts` 中

### 日志解析不准确
- 检查日志格式是否包含标准的时间戳和 Trace-ID
- 可以通过修改 `log_parser.zig` 扩展支持的格式

### 颜色不显示
- 确保终端支持 ANSI 颜色转义序列
- 非 TTY 输出会自动禁用颜色

## 许可证

MIT License
