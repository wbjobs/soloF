# Celery 任务监控系统

基于 Python Celery + Redis + Node.js SSE + Vue 3 + D3.js 的分布式任务实时监控系统。

## 系统架构

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│  Python Celery  │──────▶│     Redis       │──────▶│   Node.js SSE   │
│   任务生产者     │       │  (Broker/Backend│       │   中间层服务    │
└─────────────────┘       └─────────────────┘       └─────────────────┘
                                                             │
                                                             ▼
                                                    ┌─────────────────┐
                                                    │ Vue 3 + D3.js   │
                                                    │  前端监控面板   │
                                                    └─────────────────┘
```

## 目录结构

```
f72/
├── python/              # Python Celery 任务生产者
│   ├── requirements.txt
│   └── tasks.py
├── node-server/         # Node.js 中间层服务
│   ├── package.json
│   └── server.js
└── frontend/            # Vue 3 + D3.js 前端
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.js
        ├── style.css
        └── App.vue
```

## 快速开始

### 前置要求

- Redis >= 6.0 (需要启用 Keyspace Notifications)
- Python >= 3.8
- Node.js >= 16

### 1. 启动 Redis

确保 Redis 已启动并启用 Keyspace Notifications：

```bash
redis-server
```

或者在 redis-cli 中执行：

```bash
redis-cli config set notify-keyspace-events KEA
```

### 2. 启动 Python Celery 任务生产者

```bash
cd python
pip install -r requirements.txt

# 启动 Celery Worker
celery -A tasks worker --loglevel=info -P solo

# 另开一个终端，触发任务
python tasks.py
```

### 3. 启动 Node.js 中间层服务

```bash
cd node-server
npm install
npm start
```

服务将运行在 http://localhost:3001

### 4. 启动前端监控面板

```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173 查看监控面板。

## 功能特性

### 后端 (Python Celery)

- `process_data`: 模拟数据处理任务，支持进度更新
- `analyze_result`: 结果聚合任务，接收多个任务的结果
- `chord` 工作流：5个并行任务 + 1个聚合任务
- 支持 PENDING → STARTED → SUCCESS 状态流转

### 中间层 (Node.js)

- 监听 Redis KeySpace Notifications (`__keyspace@0__:celery-task-meta-*`)
- 解析 Celery 任务元数据
- 通过 SSE (`/events`) 实时推送任务状态
- REST API:
  - `GET /api/tasks` - 获取所有任务
  - `GET /api/graph` - 获取图数据
  - `DELETE /api/tasks` - 清除所有任务

### 前端 (Vue 3 + D3.js)

- 力导向图可视化任务依赖关系
- 实时更新任务状态颜色：
  - 🟡 PENDING (等待中)
  - 🔵 STARTED (执行中) - 脉冲动画
  - 🟢 SUCCESS (成功)
  - 🔴 FAILURE (失败)
- 节点拖拽、缩放
- 鼠标悬停显示任务详情
- 侧边栏任务列表
- 顶部统计面板

## 测试命令

发送单个任务：

```bash
python -c "from tasks import process_data; process_data.delay(999)"
```

发送错误任务：

```bash
python -c "from tasks import error_task; error_task.delay()"
```

批量发送任务：

```bash
python -c "
from tasks import process_data
for i in range(10):
    process_data.delay(i)
"
```
