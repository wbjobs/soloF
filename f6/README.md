# 前后端分离项目基础结构

## 项目简介
这是一个基于 FastAPI (后端) 和 React + Vite (前端) 的前后端分离项目基础模板。

## 目录结构
```
.
├── backend/          # FastAPI 后端
│   ├── main.py       # 后端入口文件
│   └── requirements.txt  # Python依赖
├── frontend/         # React + Vite 前端
│   ├── src/          # 前端源码
│   ├── package.json  # Node.js依赖
│   └── vite.config.js # Vite配置
└── README.md         # 项目说明
```

## 快速开始

### 后端启动
```bash
cd backend
pip install -r requirements.txt
python main.py
```
后端服务将在 http://localhost:8000 启动

### 前端启动
```bash
cd frontend
npm install
npm run dev
```
前端服务将在 http://localhost:5173 启动

## API 接口
- `GET /` - 根路径
- `GET /api/health` - 健康检查
