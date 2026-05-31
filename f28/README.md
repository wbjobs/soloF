# 任务调度系统

基于 Go (Gin) + Vue3 开发的任务调度系统，支持 Cron 定时任务和任务依赖。

## 功能特性

- 任务管理：增删改查
- 基于 Cron 表达式的定时调度
- 任务依赖支持（任务B依赖任务A，需等A执行成功后才触发B）
- 任务执行日志存入 MySQL
- 前端显示任务状态、执行结果、下次执行时间

## 项目结构

```
f28/
├── backend/                 # Go 后端
│   ├── config/             # 数据库配置
│   ├── controllers/        # API 控制器
│   ├── models/             # 数据模型
│   ├── routes/             # 路由
│   ├── scheduler/          # 调度器
│   ├── utils/              # 工具函数（循环依赖检测）
│   ├── websocket/          # WebSocket 管理器
│   ├── main.go             # 入口文件
│   └── go.mod              # 依赖管理
└── frontend/               # Vue3 前端
    ├── src/
    │   ├── App.vue         # 主组件
    │   └── main.js         # 入口文件
    ├── index.html
    ├── package.json
    └── vite.config.js
```

## 后端启动

1. 配置 MySQL 数据库连接（修改 backend/config/config.go）
2. 创建数据库 `task_scheduler`
3. 进入后端目录：
   ```bash
   cd backend
   go mod tidy
   go run main.go
   ```
4. 后端服务运行在 http://localhost:8080

## 前端启动

1. 进入前端目录：
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
2. 前端服务运行在 http://localhost:3000

## API 接口

- `GET /api/tasks` - 获取任务列表
- `GET /api/tasks/:id` - 获取单个任务
- `POST /api/tasks` - 创建任务
- `PUT /api/tasks/:id` - 更新任务
- `DELETE /api/tasks/:id` - 删除任务
- `POST /api/tasks/:id/start` - 启动任务
- `POST /api/tasks/:id/stop` - 停止任务
- `GET /api/tasks/:id/logs` - 获取任务日志

## Cron 表达式格式

```
* * * * * *
| | | | | |
| | | | | +--- 星期 (0 - 6)
| | | | +----- 月份 (1 - 12)
| | | +------- 日期 (1 - 31)
| | +--------- 小时 (0 - 23)
| +----------- 分钟 (0 - 59)
+------------- 秒 (0 - 59, 可选)
```

## 任务依赖

依赖任务ID使用JSON数组格式，例如：`[1, 2]`

表示当前任务依赖ID为1和2的任务，只有这两个任务都执行成功后，当前任务才会执行。
