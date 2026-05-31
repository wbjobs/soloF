# 🌾 农业物联网监控系统

基于 Vue3 + TypeScript + FastAPI + InfluxDB + PostgreSQL 的农业物联网监控系统。

## 功能特性

### 前端 (Vue3 + TypeScript)
- 📍 **Leaflet 地图显示** - 实时展示传感器地理位置分布
- 📊 **数据仪表盘** - 土壤湿度、温度实时数据卡片
- ⚠️ **异常记录** - 异常数据检测结果展示
- 🔄 **自动刷新** - 每5秒自动更新数据

### 后端 (FastAPI + Python)
- 📡 **LoRaWAN 数据接收** - POST `/api/lora/data` 接收传感器JSON数据
- 📈 **InfluxDB 时序存储** - 存储传感器时序数据
- 🔍 **滑动窗口异常检测** - 使用 NumPy 实现3σ异常检测算法
- 🗄️ **PostgreSQL 异常存储** - 异常数据持久化存储

### 异常检测算法
- 滑动窗口大小：10个数据点
- 检测逻辑：连续3个数据点超过均值±2倍标准差即判定为异常

## 快速开始

### 环境要求
- Docker & Docker Compose
- Python 3.8+ (用于运行测试脚本)

### 启动服务

```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps
```

### 访问地址
- 前端仪表盘: http://localhost:3000
- 后端API文档: http://localhost:8000/docs
- InfluxDB管理界面: http://localhost:8086

### 发送测试数据

```bash
# 安装依赖
pip install requests

# 运行测试数据模拟器
python test_sensor_data.py
```

模拟器会：
- 每3秒发送一次正常传感器数据
- 发送10次后会连续发送3次异常数据
- 包含3个虚拟传感器（北京地区坐标）

## API 接口

### 接收 LoRaWAN 传感器数据
```bash
POST /api/lora/data

# 请求体示例
{
  "device_id": "sensor_001",
  "timestamp": "2024-01-01T12:00:00Z",
  "latitude": 39.9042,
  "longitude": 116.4074,
  "soil_moisture": 45.5,
  "temperature": 22.3
}
```

### 获取最新传感器数据
```bash
GET /api/sensors/latest
```

### 获取异常记录
```bash
GET /api/anomalies?limit=100
```

## 项目结构

```
agri-iot/
├── backend/                 # 后端服务
│   ├── main.py             # FastAPI 主程序
│   ├── requirements.txt    # Python 依赖
│   ├── Dockerfile          # Docker 镜像配置
│   └── .env               # 环境变量
├── frontend/              # 前端应用
│   ├── src/
│   │   ├── components/    # Vue 组件
│   │   │   ├── SensorMap.vue   # 地图组件
│   │   │   └── DataCard.vue    # 数据卡片
│   │   ├── App.vue       # 主应用
│   │   ├── main.ts       # 入口文件
│   │   ├── api.ts        # API 调用
│   │   └── types.ts      # 类型定义
│   ├── package.json      # Node 依赖
│   ├── vite.config.ts    # Vite 配置
│   └── Dockerfile        # Docker 镜像配置
├── docker-compose.yml    # Docker 编排配置
└── test_sensor_data.py   # 测试数据模拟器
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 前端框架 | Vue 3 + TypeScript |
| 构建工具 | Vite |
| 地图库 | Leaflet + @vue-leaflet |
| HTTP客户端 | Axios |
| 后端框架 | FastAPI |
| 时序数据库 | InfluxDB 2.7 |
| 关系数据库 | PostgreSQL 15 |
| 科学计算 | NumPy |
| 容器化 | Docker + Docker Compose |

## 停止服务

```bash
# 停止所有服务
docker-compose down

# 停止并删除数据卷（清空所有数据）
docker-compose down -v
```
