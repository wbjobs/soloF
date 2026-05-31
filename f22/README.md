# Rust 日志收集系统

一个基于 Rust 的分布式日志收集系统，包含 CLI 工具和后端服务。

## 项目结构

```
f22/
├── Cargo.toml          # 工作空间配置
├── proto/
│   └── log_service.proto  # gRPC 服务定义
├── common/             # 共享库
│   ├── Cargo.toml
│   ├── build.rs
│   └── src/
│       └── lib.rs
├── cli/                # CLI 工具
│   ├── Cargo.toml
│   └── src/
│       └── main.rs
└── backend/            # 后端服务
    ├── Cargo.toml
    └── src/
        ├── main.rs
        ├── parser.rs
        ├── elasticsearch.rs
        └── grpc_service.rs
```

## 功能特性

### CLI 工具
- 从多个服务器拉取日志文件
- 支持本地文件系统读取
- 通过 gRPC 发送到后端服务
- 命令行参数：
  - `--servers`: 服务器列表，逗号分隔
  - `--log-path`: 日志路径
  - `--grpc-addr`: 后端 gRPC 地址

### 后端服务
- 使用 Actix-Web 提供 HTTP 服务
- 使用 Tonic 提供 gRPC 服务
- 支持 JSON 和纯文本格式日志解析
- 提取 ERROR/WARN 级别日志
- 存储到 Elasticsearch（按日期分索引）

## 快速开始

### 1. 编译项目

```bash
cargo build --release
```

### 2. 启动后端服务

```bash
# 使用默认配置
cargo run --release -p log-collector-backend

# 或使用环境变量配置
export ELASTICSEARCH_URL="http://localhost:9200"
export HTTP_PORT=8080
export GRPC_PORT=50051
cargo run --release -p log-collector-backend
```

### 3. 运行 CLI 工具

```bash
# 测试模式（生成示例日志）
cargo run --release -p log-collector-cli -- \
  --servers "server1,server2" \
  --log-path "/var/log/app" \
  --grpc-addr "http://localhost:50051"

# 本地日志读取模式
cargo run --release -p log-collector-cli -- \
  --servers "localhost" \
  --log-path "./test-logs" \
  --grpc-addr "http://localhost:50051"
```

## 环境变量配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ELASTICSEARCH_URL` | `http://localhost:9200` | Elasticsearch 地址 |
| `ELASTICSEARCH_INDEX_PREFIX` | `logs` | 索引前缀 |
| `HTTP_PORT` | `8080` | HTTP 服务端口 |
| `GRPC_PORT` | `50051` | gRPC 服务端口 |

## API 端点

### HTTP 端点
- `GET /health` - 服务健康检查
- `GET /health/es` - Elasticsearch 健康检查

### gRPC 服务
- `SendLogEntries` - 批量发送日志
- `StreamLogEntries` - 流式发送日志

## 日志格式支持

### JSON 格式
支持从以下字段提取日志级别：
- `level` / `log_level` / `severity`
- `timestamp` / `time` / `@timestamp`

示例：
```json
{
  "timestamp": "2024-01-15T10:00:00Z",
  "level": "ERROR",
  "message": "Connection failed",
  "service": "api-gateway"
}
```

### 纯文本格式
通过正则表达式匹配日志级别关键词（ERROR/WARN/INFO/DEBUG）。

示例：
```
2024-01-15 10:00:00 ERROR Database connection timeout
```

## Elasticsearch 索引

日志按日期存储，索引名称格式：
```
{prefix}-YYYY.MM.DD
```

示例：
```
logs-2024.01.15
```

## 开发

### 运行测试

```bash
cargo test
```

### 代码检查

```bash
cargo clippy
```

## 修复说明

### 1. 中文编码乱码问题修复

CLI 工具现在支持自动检测和转换多种编码格式：

- **UTF-8**: 默认编码
- **GBK/GB18030**: 简体中文常用编码
- **BIG5**: 繁体中文编码

实现方式：
- 使用 `encoding_rs` 库进行编码检测和转换
- 读取文件时先按字节读取，再自动检测编码
- 支持 Windows 系统下常见的 GBK 编码日志文件

### 2. Elasticsearch 索引 Mapping 修复

为解决 `log_level` 等字段无法聚合的问题，现在自动创建索引模板：

- **log_level**: `keyword` 类型，支持按日志级别聚合统计
- **server_name**: `keyword` 类型，支持按服务器聚合
- **file_path**: `keyword` 类型，支持按文件路径聚合
- **log_type**: `keyword` 类型，支持按日志类型聚合
- **content**: `text` + `keyword` 双类型，支持全文搜索和精确匹配
- **timestamp**: `date` 类型，支持时间范围查询

索引模板特性：
- 按日期自动创建索引（格式：`{prefix}-YYYY.MM.DD`）
- 单分片零副本（适合开发环境）
- 5秒刷新间隔

## CLI 进度条功能

CLI 工具现在具有美观的进度条显示：

- **多服务器并行进度显示**: 使用 MultiProgress 展示每个服务器的拉取进度
- **实时状态更新**: 显示当前处理的文件名和编码信息
- **彩色输出**: 使用 colored 库提供友好的终端输出
- **动画效果**: Spinner 动画和进度条动画

## 日志查询 API

后端提供 RESTful API 进行按时间范围查询错误和警告日志：

### 查询错误日志

**端点**: `GET /api/logs/errors`

**查询参数**:
- `start`: 开始时间 (ISO 8601 格式, 如: `2024-01-15T10:00:00Z`)
- `end`: 结束时间 (ISO 8601 格式, 默认: 当前时间)
- `level`: 日志级别过滤 (可选, `ERROR` 或 `WARN`)
- `limit`: 返回结果数量限制 (默认: 100, 最大: 1000)

**示例请求**:
```bash
# 查询最近24小时的所有错误和警告日志
curl "http://localhost:8080/api/logs/errors"

# 查询指定时间范围内的ERROR级别日志
curl "http://localhost:8080/api/logs/errors?start=2024-01-15T00:00:00Z&end=2024-01-16T00:00:00Z&level=ERROR&limit=200"
```

**响应格式**:
```json
{
  "status": "ok",
  "count": 42,
  "time_range": {
    "start": "2024-01-15T00:00:00Z",
    "end": "2024-01-16T00:00:00Z"
  },
  "logs": [
    {
      "server_name": "server1",
      "file_path": "/var/log/app.log",
      "content": "Database connection failed",
      "timestamp": "2024-01-15T10:30:00Z",
      "log_level": "ERROR",
      "log_type": "text",
      "metadata": {}
    }
  ]
}
```

### 获取日志统计信息

**端点**: `GET /api/logs/stats`

**查询参数**:
- `start`: 开始时间 (ISO 8601 格式)
- `end`: 结束时间 (ISO 8601 格式)

**示例请求**:
```bash
curl "http://localhost:8080/api/logs/stats?start=2024-01-01T00:00:00Z&end=2024-02-01T00:00:00Z"
```

**响应格式**:
```json
{
  "status": "ok",
  "stats": {
    "total": 156,
    "by_level": [
      { "key": "ERROR", "doc_count": 89 },
      { "key": "WARN", "doc_count": 67 }
    ],
    "by_server": [
      { "key": "server1", "doc_count": 78 },
      { "key": "server2", "doc_count": 78 }
    ],
    "time_range": {
      "start": "2024-01-01T00:00:00Z",
      "end": "2024-02-01T00:00:00Z"
    }
  }
}
```

## 技术栈

- **语言**: Rust
- **异步运行时**: Tokio
- **Web 框架**: Actix-Web
- **gRPC 框架**: Tonic
- **序列化**: Serde, Prost
- **数据存储**: Elasticsearch
- **日志**: Tracing
- **编码处理**: encoding_rs
- **进度条**: indicatif
- **彩色输出**: colored
