# JS/TS 依赖分析服务

一个完整的 JavaScript/TypeScript 项目依赖分析系统，包含 Webhook 监听、AST 解析、依赖图构建、REST API 和可视化前端。

**✨ 新特性: 依赖变更预测 (朴素贝叶斯)** - 基于历史 Git 提交记录，预测某个文件修改后最可能受影响的 5 个文件，并在前端高亮显示。

**✨ 新特性: 异步任务 + WebSocket 实时推送** - 解决大型项目（1000+ 文件）首次分析超时问题，分析耗时不再阻塞 HTTP 请求。

## 功能特性

- 🔗 **Git Push Webhook**: 监听 Git 仓库 push 事件，自动触发依赖分析
- 🔍 **AST 解析**: 使用 Babel 解析 JS/TS 文件的 import/export 语句
- 🗺️ **全量依赖图**: 构建完整的文件依赖关系图，支持 npm 包和路径别名
- 📊 **REST API**: 查询文件引用、循环依赖检测、删除影响分析
- 🎨 **力导向图**: Svelte 前端展示交互式依赖图
- 🗃️ **Neo4j 存储**: 使用 Neo4j 图数据库存储和查询依赖关系
- ⚡ **异步任务队列**: 支持大型项目（1000+ 文件）分析，不阻塞 HTTP
- 📡 **WebSocket 实时推送**: 实时获取分析进度、百分比、阶段信息
- 🚫 **任务取消**: 支持中途取消正在运行的分析任务
- 📈 **增量进度报告**: 解析、构图阶段分步报告进度
- 🤖 **变更预测**: 基于 Git 历史的朴素贝叶斯预测，高亮显示最可能受影响的文件

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python + FastAPI + WebSocket |
| 任务管理 | 异步队列 + 线程池 + 事件驱动 |
| AST 解析 | Babel (Node.js 子进程) |
| 图数据库 | Neo4j |
| 前端 | Svelte + D3-Force + WebSocket |
| 部署 | Docker Compose |

## 架构概览

```
┌─────────────┐   HTTP 202   ┌──────────────────┐   异步任务   ┌─────────────┐
│ Git Webhook │ ───────────> │  FastAPI Server  │ ───────────> │ Babel Parser│
│  / Client   │              │  (立即返回)      │              └──────┬──────┘
└─────────────┘              └────────┬─────────┘                     │
              ▲                       │ WebSocket                     │
              │                       │ 推送                         │
              │                       ▼                               │
              │              ┌──────────────────┐                     │
              │              │  Task Manager    │                     │
              │              │  (进度/状态/事件)│                     │
              │              └────────┬─────────┘                     │
              │                       │                               │
              │                       ▼                               │
              │              ┌──────────────────┐                     │
              └──────────────│   Neo4j 图数据库  │ <───────────────────┘
                             └──────────────────┘
```

## 快速开始

### 前置条件

- Docker & Docker Compose
- 或: Python 3.12+, Node.js 20+, Neo4j 5+

### 使用 Docker Compose (推荐)

```bash
# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

服务地址:
- 前端: http://localhost:5173
- 后端 API: http://localhost:8000
- Neo4j 浏览器: http://localhost:7474

### 本地开发

#### 1. 安装依赖

```bash
# 后端
cd backend
pip install -r requirements.txt

# Babel 解析器
cd babel-parser
npm install

# 前端
cd frontend
npm install
```

#### 2. 配置环境

```bash
cd backend
cp .env.example .env
# 编辑 .env 修改 Neo4j 连接信息
```

#### 3. 启动服务

```bash
# 终端 1: 启动后端
cd backend
python app.py

# 终端 2: 启动前端
cd frontend
npm run dev
```

## API 文档

### Webhook 端点 (异步)

#### 监听 Git Push 事件
```
POST /webhook/git-push
Content-Type: application/json
```

GitHub Webhook 配置:
- Payload URL: `http://your-server:8000/webhook/git-push`
- Content type: `application/json`
- Events: `Push events`

**响应 (立即返回)**:
```json
{
  "task_id": "a1b2c3d4-...",
  "status": "queued",
  "message": "分析任务已排队。通过 WebSocket /ws/tasks/{task_id} 获取实时进度"
}
```

#### 手动触发分析
```
POST /webhook/build
Content-Type: application/json

{
  "repo_path": "/path/to/your/project",
  "branch": "main"
}
```

**响应 (立即返回)**:
```json
{
  "task_id": "a1b2c3d4-...",
  "status": "queued",
  "message": "分析任务已排队。通过 WebSocket /ws/tasks/{task_id} 获取实时进度"
}
```

#### 清除图数据
```
POST /webhook/clear
```

### WebSocket 实时推送

#### 单任务监听
```
WS /ws/tasks/{task_id}
```

**推送消息类型**:

| 类型 | 说明 | 数据结构 |
|------|------|----------|
| `init` | 连接建立，返回任务信息 | `{ type: "init", task: {...} }` |
| `progress` | 进度更新 | `{ type: "progress", data: { status: "running", progress: {...} } }` |
| `status_change` | 状态变更 | `{ type: "status_change", data: { status: "...", message: "..." } }` |
| `completed` | 分析完成 | `{ type: "completed", data: { result: {...} } }` |
| `failed` | 分析失败 | `{ type: "failed", data: { error: "..." } }` |
| `cancelled` | 任务取消 | `{ type: "cancelled", data: {...} }` |

**进度对象结构**:
```json
{
  "current_file": 156,
  "total_files": 1024,
  "current_filename": "src/utils/helpers.ts",
  "nodes_created": 1420,
  "edges_created": 3850,
  "errors_count": 3,
  "phase": "parsing",
  "message": "[156/1024] 解析 src/utils/helpers.ts"
}
```

**客户端发送命令**:
```json
{ "action": "ping" }          // 心跳
{ "action": "cancel" }        // 取消当前任务
```

#### 多任务监听
```
WS /ws/tasks
```

**客户端命令**:
```json
{ "action": "subscribe", "task_id": "a1b2c3..." }
{ "action": "unsubscribe", "task_id": "a1b2c3..." }
{ "action": "subscribe_all" }
{ "action": "cancel", "task_id": "a1b2c3..." }
```

### REST API (任务管理)

#### 列出所有任务
```
GET /api/tasks?skip=0&limit=50
```

#### 获取任务详情
```
GET /api/tasks/{task_id}
```

**响应**:
```json
{
  "task_id": "a1b2c3d4-...",
  "status": "running",
  "repo_path": "/path/to/project",
  "created_at": "2026-05-25T10:30:00",
  "started_at": "2026-05-25T10:30:05",
  "progress": {
    "current_file": 456,
    "total_files": 1024,
    "phase": "parsing",
    "message": "[456/1024] 解析 src/components/App.tsx"
  }
}
```

#### 取消任务
```
POST /api/tasks/{task_id}/cancel
```

### REST API (图查询)

#### 获取所有文件
```
GET /api/files
```

#### 获取文件引用情况
```
GET /api/files/{path}/references
GET /api/files/{path}/references?recursive=true
```

#### 循环依赖检测
```
GET /api/check-cycle?file_a=path/to/a.ts&file_b=path/to/b.ts
```

#### 删除影响分析
```
GET /api/files/{path}/impact
```

#### 获取图数据
```
GET /api/graph
```

#### 获取统计信息
```
GET /api/stats
```

## 项目结构

```
├── backend/
│   ├── app.py              # FastAPI 主应用 + WebSocket
│   ├── config.py           # 配置管理
│   ├── schemas.py          # Pydantic 模型 (含任务/进度)
│   ├── task_manager.py     # ⭐ 异步任务管理器 (单例, 事件驱动)
│   ├── babel_client.py     # Babel 解析器客户端
│   ├── resolver.py         # 路径别名解析器
│   ├── extractor.py        # ⭐ 依赖提取器 (支持进度回调+取消检查)
│   ├── neo4j_client.py     # Neo4j 图数据库客户端
│   ├── requirements.txt    # Python 依赖
│   ├── .env.example        # 环境变量示例
│   ├── Dockerfile
│   └── routes/
│       ├── __init__.py
│       ├── api.py          # REST API (含任务管理)
│       ├── webhook.py      # 异步 Webhook + Build 端点
│       └── websocket.py    # ⭐ WebSocket 实时推送
├── babel-parser/
│   ├── package.json
│   └── parse.js            # Babel AST 解析脚本
├── frontend/
│   ├── src/
│   │   ├── App.svelte      # 主应用 (含任务进度弹层)
│   │   ├── TaskProgress.svelte  # ⭐ 实时进度组件 (WebSocket)
│   │   ├── ForceGraph.svelte
│   │   ├── FileList.svelte
│   │   ├── DetailPanel.svelte
│   │   ├── StatsPanel.svelte
│   │   ├── BuildForm.svelte
│   │   └── main.js
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## 异步任务工作流程

### 状态流转
```
   ┌─────────┐   任务入队   ┌─────────┐  开始执行  ┌───────────┐
   │ (初始)  │ ──────────> │ queued  │ ────────> │  running  │
   └─────────┘             └─────────┘            └─────┬─────┘
                                                        │
                          ┌─────────┐      完成      │
                          │completed│ <───────────────┤
                          └─────────┘                 │
                          ┌─────────┐      失败      │
                          │ failed  │ <───────────────┤
                          └─────────┘                 │
                          ┌─────────┐      取消      │
                          │cancelled│ <───────────────┘
                          └─────────┘
```

### 任务阶段 (phase)
1. **queued** - 任务已排队，等待执行
2. **scanning** - 扫描项目文件，统计文件总数
3. **parsing** - 解析 AST，提取 import/export
4. **building_graph** - 写入 Neo4j，构建依赖图
5. **completed** - 分析完成
6. **failed / cancelled** - 失败或已取消

### 进度推送频率
- **每个文件**: 更新当前文件名和序号（用于显示）
- **每 50 个文件**: 推送完整进度快照
- **阶段切换**: 推送阶段变更和消息
- **完成/失败/取消**: 推送最终状态和结果

## 任务管理器核心特性

- **单例模式**: `AsyncTaskManager` 全局单例，线程安全
- **事件驱动**: 基于监听器模式，支持多 WebSocket 订阅同一任务
- **取消检查**: 解析过程中每步检查取消标志，可立即中断
- **线程安全**: 任务状态使用 `threading.Lock` 保护
- **自动重连**: WebSocket 断线自动重连（最多 5 次）
- **历史保留**: 保留最近 50 个任务记录

## 性能优化

| 优化点 | 说明 | 效果 |
|--------|------|------|
| **异步任务** | HTTP 请求立即返回 202，不阻塞 | 支持 1000+ 文件项目 |
| **线程池执行** | `loop.run_in_executor` + 进度回调 | 不阻塞事件循环 |
| **批量推送** | 每 50 个文件推送一次完整进度 | 减少 WebSocket 流量 |
| **增量写入** | 解析即写入 Neo4j，无需全量内存缓存 | 降低内存占用 |
| **取消检查** | 每步可中断，资源及时释放 | 支持任务取消 |

## 配置选项

环境变量 (`.env`):

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j 连接地址 |
| `NEO4J_USER` | `neo4j` | Neo4j 用户名 |
| `NEO4J_PASSWORD` | `neo4j1234` | Neo4j 密码 |
| `BABEL_PARSER_DIR` | `babel-parser` | Babel 解析器目录 |
| `GIT_WEBHOOK_SECRET` | `""` | Git Webhook 密钥 |
| `REPOS_DIR` | `./repos` | Git 仓库存储目录 |
| `HOST` | `0.0.0.0` | 服务监听地址 |
| `PORT` | `8000` | 服务监听端口 |

## 依赖类型

- `import` - ES import 语句 (实线)
- `require` - CommonJS require (实线)
- `reexport` - re-export 语句 (`export ... from`) (橙色实线)
- `dynamic_import` - 动态 import (`import()`) (紫色虚线)

## 前端使用说明

1. 打开 http://localhost:5173
2. 输入项目路径（如 `/path/to/your/react-app`）
3. 点击"开始分析"
4. 实时查看进度条和阶段信息
5. 分析完成后自动加载力导向图
6. 点击节点查看引用关系和删除影响
7. 支持中途点击 ✕ 取消分析

## 触发分析的方式

### 方式 1: 前端手动输入路径
打开前端 → 输入路径 → 点击"开始分析"

### 方式 2: API 调用
```bash
curl -X POST http://localhost:8000/webhook/build \
  -H "Content-Type: application/json" \
  -d '{"repo_path": "/absolute/path/to/project"}'
```

### 方式 3: Git Webhook
配置 GitHub Webhook 指向 `http://your-server:8000/webhook/git-push`，每次 push 自动触发分析。

## 诊断与调试

### 查看任务列表
```bash
curl http://localhost:8000/api/tasks
```

### 查看任务详情
```bash
curl http://localhost:8000/api/tasks/{task_id}
```

### 测试 WebSocket
使用 `wscat` 或浏览器控制台:
```javascript
const ws = new WebSocket('ws://localhost:8000/ws/tasks/{task_id}')
ws.onmessage = e => console.log(JSON.parse(e.data))
```

### 健康检查
```bash
curl http://localhost:8000/health
```
