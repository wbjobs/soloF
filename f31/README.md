# OTA 固件升级中心

基于 MQTT 协议的轻量级固件升级系统，支持断点续传和 AES-128 加密。

## 系统架构

```
┌─────────────┐     MQTT      ┌──────────────┐     HTTP     ┌──────────┐
│  设备端     │ ◄────────────► │  后端服务    │ ◄──────────► │  前端    │
│  (Python)   │                │  (Go + MQTT) │              │  (Vue3) │
└─────────────┘                └──────────────┘              └──────────┘
```

## 功能特性

- ✅ MQTT 内置 Broker，无需额外部署
- ✅ 固件分片传输
- ✅ 断点续传支持
- ✅ AES-128 加密传输
- ✅ MD5 校验和验证
- ✅ 实时升级进度显示

## 快速开始

### 1. 启动后端服务

```bash
cd backend
go mod download
go run cmd/main.go
```

后端会启动：
- MQTT Broker: `tcp://localhost:1883`
- HTTP API: `http://localhost:8080`

### 2. 启动前端

```bash
cd frontend
npm install
npm run dev
```

访问: `http://localhost:3000`

### 3. 启动模拟设备

```bash
cd client
pip install -r requirements.txt
python device.py
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/devices | 获取设备列表 |
| GET | /api/firmwares | 获取固件列表 |
| POST | /api/firmwares | 上传固件 (multipart/form-data) |
| POST | /api/upgrade | 开始升级 (JSON: {device_id, firmware_id}) |
| GET | /api/gray-config | 获取灰度发布配置 |
| POST | /api/gray-config | 设置灰度发布配置 (JSON: {enabled, allowed_prefixes}) |

## MQTT Topic 定义

| Topic | 方向 | 说明 |
|-------|------|------|
| device/{id}/heartbeat | 设备 → 服务端 | 心跳包 |
| device/{id}/version | 设备 → 服务端 | 版本上报 |
| device/{id}/upgrade/cmd | 服务端 → 设备 | 升级命令 |
| device/{id}/upgrade/data | 服务端 → 设备 | 固件分片数据 |
| device/{id}/upgrade/ack | 设备 → 服务端 | 接收确认 |

## 升级流程

1. 前端选择设备和固件，发送升级指令
2. 后端发送升级命令，包含固件信息、大小、校验和、加密密钥
3. 后端开始发送加密的固件分片
4. 设备接收分片，解密后写入缓冲区，发送确认
5. 后端根据确认发送下一分片，支持断点续传
6. 传输完成后，设备验证 MD5 校验和
7. 设备保存固件文件

## 项目结构

```
.
├── backend/           # Go 后端
│   ├── cmd/
│   │   └── main.go   # 入口文件
│   ├── internal/
│   │   ├── mqtt/     # MQTT Broker 实现
│   │   └── server/   # HTTP API 服务
│   └── go.mod
├── frontend/          # Vue3 前端
│   ├── src/
│   │   └── App.vue   # 主界面
│   └── package.json
├── client/            # Python 模拟设备
│   ├── device.py
│   └── requirements.txt
└── firmware_storage/  # 固件存储目录
```
