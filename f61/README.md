# 分布式任务调度平台

一个简化版的 Airflow 任务调度平台，使用 Go + React + PostgreSQL 构建。

## 功能特性

- ✅ **定时任务调度**: 基于 gocron 实现分布式任务调度
- ✅ **Cron 表达式**: 支持标准的 Cron 表达式配置执行周期
- ✅ **Shell 命令执行**: 可执行任意 Shell 命令
- ✅ **任务管理**: 创建、查看、暂停、启用、删除任务
- ✅ **执行日志**: 完整记录每次执行的 stdout、stderr、退出码
- ✅ **实时状态**: 自动刷新任务状态和执行结果
- ✅ **RESTful API**: 完整的 HTTP API 接口

## 技术栈

### 后端
- **Go 1.21+**
- **Gin**: Web 框架
- **gocron**: 任务调度库
- **GORM**: ORM 框架
- **PostgreSQL**: 数据存储

### 前端
- **React 18**
- **Ant Design 5**: UI 组件库
- **Vite**: 构建工具
- **Axios**: HTTP 客户端

## 项目结构

```
.
├── backend/                 # Go 后端
│   ├── cmd/server/         # 主程序入口
│   ├── internal/
│   │   ├── api/            # API 层
│   │   │   ├── handlers/   # 请求处理器
│   │   │   └── routes/     # 路由配置
│   │   ├── config/         # 配置管理
│   │   ├── database/       # 数据库连接
│   │   ├── models/         # 数据模型
│   │   └── scheduler/      # 任务调度器
│   └── go.mod
├── frontend/               # React 前端
│   ├── src/
│   │   ├── pages/          # 页面组件
│   │   ├── services/       # API 服务
│   │   └── types/          # 类型定义
│   └── package.json
├── database/               # 数据库脚本
│   └── schema.sql
└── README.md
```

## 快速开始

### 前置要求

1. **PostgreSQL** (版本 12+)
2. **Go** (版本 1.21+)
3. **Node.js** (版本 18+)
4. **npm** 或 **yarn**

### 1. 数据库准备

创建数据库并执行初始化脚本：

```sql
-- 创建数据库
CREATE DATABASE task_scheduler;

-- 执行 database/schema.sql 中的脚本
```

### 2. 后端启动

```bash
cd backend

# 复制并修改配置
cp .env.example .env
# 编辑 .env 文件，配置数据库连接信息

# 安装依赖
go mod download

# 启动服务
go run cmd/server/main.go
```

后端服务将在 `http://localhost:8080` 启动

### 3. 前端启动

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端服务将在 `http://localhost:3000` 启动

## API 接口

### 创建任务

```http
POST /api/tasks
Content-Type: application/json

{
  "name": "测试任务",
  "cron_expression": "* * * * *",
  "command": "echo Hello World"
}
```

### 获取任务列表

```http
GET /api/tasks
```

### 获取单个任务

```http
GET /api/tasks/:id
```

### 更新任务状态

```http
PUT /api/tasks/:id/status
Content-Type: application/json

{
  "status": "paused"
}
```

状态值: `active` (运行中), `paused` (已暂停), `inactive` (已停用)

### 删除任务

```http
DELETE /api/tasks/:id
```

### 获取任务执行日志

```http
GET /api/tasks/:id/executions?limit=20
```

## Cron 表达式说明

标准 5 位 Cron 表达式格式：

```
┌───────────── 分钟 (0 - 59)
│ ┌───────────── 小时 (0 - 23)
│ │ ┌───────────── 日 (1 - 31)
│ │ │ ┌───────────── 月 (1 - 12)
│ │ │ │ ┌───────────── 星期 (0 - 6) (0 = 星期日)
│ │ │ │ │
│ │ │ │ │
* * * * *
```

常用示例：

| 表达式 | 说明 |
|--------|------|
| `* * * * *` | 每分钟执行 |
| `0 * * * *` | 每小时执行 |
| `0 0 * * *` | 每天 0 点执行 |
| `0 0 * * 1` | 每周一 0 点执行 |
| `0 0 1 * *` | 每月 1 号 0 点执行 |
| `*/5 * * * *` | 每 5 分钟执行 |

## 使用说明

1. 打开浏览器访问 `http://localhost:3000`
2. 点击「创建任务」按钮
3. 填写任务名称、Cron 表达式和要执行的命令
4. 在任务列表中查看所有任务的状态
5. 点击「详情」查看任务的执行历史和日志
6. 可以暂停/启用/删除任务

## 注意事项

1. **安全性**: 任务执行的命令直接在服务器上运行，请确保只允许可信用户创建任务，防止命令注入攻击
2. **跨平台**: 当前 Shell 执行命令针对 Windows 系统 (`cmd /C`)，如需在 Linux 运行，请修改 `scheduler.go` 中的 `exec.Command` 调用为 `bash -c`
3. **超时**: 单个任务执行超时时间为 10 分钟
4. **并发**: 任务执行是异步的，不会阻塞调度器

## 许可证

MIT License
