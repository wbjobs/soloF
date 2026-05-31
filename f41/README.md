# 农业土壤墒情监测系统

一个基于 LoRaWAN 物联网技术的农业土壤墒情实时监测系统。

## 系统架构

- **后端**: Node.js + Express + PostgreSQL + Socket.io
- **前端**: React + Recharts
- **通信协议**: LoRaWAN (模拟实现)

## 功能特性

- ✅ LoRaWAN 网络服务器模拟，接收传感器上行数据
- ✅ 自定义 Payload 编解码（包含湿度、温度、电导率）
- ✅ PostgreSQL 数据持久化存储
- ✅ 实时数据推送（Socket.io）
- ✅ 响应式仪表盘界面
- ✅ 24小时数据趋势图表
- ✅ 多传感器节点支持

## 快速开始

### 1. 数据库准备

确保已安装 PostgreSQL，然后执行初始化脚本：

```bash
psql -U postgres -f backend/src/database/init.sql
```

数据库配置在 `backend/.env` 文件中：

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=soil_monitoring
DB_USER=postgres
DB_PASSWORD=postgres
```

### 2. 启动后端服务

```bash
cd backend
npm install
npm start
```

后端服务将在 `http://localhost:3001` 启动，LoRaWAN 服务器监听 UDP 1700 端口。

### 3. 启动前端服务

```bash
cd frontend
npm install
npm start
```

前端应用将在 `http://localhost:3000` 自动打开。

## API 接口

- `GET /api/nodes` - 获取所有传感器节点信息
- `GET /api/data/:devEui?hours=24` - 获取指定节点的历史数据
- `GET /api/data/latest` - 获取所有节点的最新数据

## Payload 格式

系统使用 6 字节的二进制 Payload：

| 字节偏移 | 数据类型 | 描述       | 单位    |
|---------|---------|------------|---------|
| 0-1     | uint16  | 土壤湿度    | % (x100)|
| 2-3     | int16   | 温度        | °C (x100)|
| 4-5     | uint16  | 电导率      | μS/cm   |

## 数据模拟

系统内置数据模拟功能，启动后会自动生成3个传感器节点的数据，每5秒更新一次：

- 节点1: A区农田 (湿度~45%, 温度~22°C, 电导率~1200)
- 节点2: B区农田 (湿度~52%, 温度~24°C, 电导率~1500)
- 节点3: C区果园 (湿度~38%, 温度~20°C, 电导率~900)

## 项目结构

```
f41/
├── backend/
│   ├── src/
│   │   ├── config/          # 配置文件
│   │   ├── database/        # 数据库脚本
│   │   ├── routes/          # API 路由
│   │   ├── services/        # 业务逻辑
│   │   ├── utils/           # 工具函数
│   │   └── server.js        # 主入口
│   ├── package.json
│   └── .env
└── frontend/
    ├── src/
    │   ├── components/      # React 组件
    │   ├── App.js
    │   ├── index.js
    │   └── index.css
    └── package.json
```
