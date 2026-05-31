# IoT 设备影子服务

基于 Go (Gin 框架) 实现的 IoT 设备影子服务，提供 MQTT 协议桥接和 RESTful API。

## 功能特性

- **MQTT 协议桥接**：订阅 `device/+/report` 主题，接收设备上报状态
- **Redis 存储**：使用 Redis Hash 存储设备影子数据
- **RESTful API**：提供设备状态查询和更新接口
- **Delta 推送**：当 desired 和 reported 状态不一致时，自动计算差异并通过 MQTT 推送回设备
- **版本回溯**：PostgreSQL 记录所有状态变更，支持查询过去 24 小时内的历史记录

## 项目结构

```
.
├── cmd/
│   └── main.go              # 主程序入口
├── internal/
│   ├── api/
│   │   ├── handler.go       # API 处理器
│   │   └── router.go        # 路由配置
│   └── mqtt/
│       └── client.go        # MQTT 客户端
├── pkg/
│   └── utils/
│       ├── config.go        # 配置加载
│       ├── delta.go         # Delta 计算
│       └── json.go          # JSON 工具
├── go.mod
├── .env.example
└── README.md
```

## 快速开始

### 前置要求

- Go 1.21+
- Redis
- MQTT Broker (如 EMQX, Mosquitto)

### 安装依赖

```bash
go mod download
```

### 配置环境变量

复制 `.env.example` 为 `.env` 并修改配置：

```bash
cp .env.example .env
```

### 运行服务

```bash
go run cmd/main.go
```

## API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/devices/:device_id/shadow` | 获取设备完整影子 |
| GET | `/api/devices/:device_id/shadow/desired` | 获取期望状态 |
| GET | `/api/devices/:device_id/shadow/reported` | 获取报告状态 |
| GET | `/api/devices/:device_id/shadow/delta` | 获取差异 |
| PATCH | `/api/devices/:device_id/shadow/desired` | 更新期望状态 |

### API 示例

**更新期望状态：**
```bash
curl -X PATCH http://localhost:8080/api/devices/device001/shadow/desired \
  -H "Content-Type: application/json" \
  -d '{"desired": {"temperature": 25, "power": "on"}}'
```

**获取设备影子：**
```bash
curl http://localhost:8080/api/devices/device001/shadow
```

## MQTT 主题

| 主题 | 方向 | 描述 |
|------|------|------|
| `device/+/report` | 设备 → 服务 | 设备上报状态 |
| `device/{id}/delta` | 服务 → 设备 | 服务推送差异 |

### 设备上报示例

设备向 `device/device001/report` 发布：
```json
{
  "temperature": 24,
  "humidity": 60,
  "power": "off"
}
```

### Delta 推送示例

当 desired 和 reported 不一致时，服务向 `device/device001/delta` 推送：
```json
{
  "device_id": "device001",
  "delta": {
    "temperature": 25,
    "power": "on"
  },
  "version": 5
}
```

## Redis 存储结构

使用 Hash 结构存储设备影子，Key 格式为 `device:{device_id}:shadow`：

| 字段 | 类型 | 描述 |
|------|------|------|
| `desired` | JSON | 期望状态 |
| `reported` | JSON | 报告状态 |
| `version` | int | 版本号 |
| `timestamp` | int | 时间戳 |

## PostgreSQL 存储结构

表名 `device_shadow_logs`，记录所有状态变更：

| 字段 | 类型 | 描述 |
|------|------|------|
| `id` | bigserial | 主键 |
| `device_id` | varchar(128) | 设备 ID (索引) |
| `version` | bigint | 影子版本号 (索引) |
| `change_type` | varchar(32) | 变更类型: reported / desired |
| `desired` | text | 期望状态 JSON |
| `reported` | text | 报告状态 JSON |
| `delta` | text | Delta JSON (预留) |
| `created_at` | timestamptz | 创建时间 (索引) |
