# 分布式任务调度系统

基于 Python + Celery + Redis + Vue3 的分布式任务调度系统，支持通过前端拖拽生成 DAG 工作流。

## 功能特性

- 可视化 DAG 编辑器，拖拽式创建工作流
- 支持三种任务类型：Shell 命令、Python 脚本、HTTP 请求
- 任务失败自动重试（最多 3 次）
- 任务超时控制（单任务最长 10 分钟）
- 任务执行历史记录
- 任务状态实时监控
- API 触发工作流执行

## 技术栈

### 后端
- FastAPI: Web 框架
- Celery: 分布式任务队列
- Redis: 任务结果存储和缓存
- RabbitMQ: 消息代理
- SQLAlchemy: ORM

### 前端
- Vue3: 前端框架
- Element Plus: UI 组件库
- Vue Router: 路由管理
- Axios: HTTP 客户端

## 项目结构

```
.
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py          # FastAPI 主应用
│   │   ├── celery_app.py    # Celery 配置
│   │   ├── database.py      # 数据库配置
│   │   ├── models.py        # 数据模型
│   │   ├── schemas.py       # Pydantic 模型
│   │   └── tasks/           # 任务定义
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── main.js
    │   ├── App.vue
    │   ├── api/             # API 封装
    │   ├── router/          # 路由配置
    │   └── views/           # 页面组件
    ├── index.html
    ├── package.json
    └── vite.config.js
```

## 安装与运行

### 前置依赖

- Python 3.8+
- Node.js 16+
- Redis
- RabbitMQ

### 后端启动

1. 进入后端目录
```bash
cd backend
```

2. 安装依赖
```bash
pip install -r requirements.txt
```

3. 启动 FastAPI 服务
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

4. 启动 Celery Worker（新终端）
```bash
cd backend
celery -A app.celery_app.celery worker --loglevel=info --pool=solo
```

### 前端启动

1. 进入前端目录
```bash
cd frontend
```

2. 安装依赖
```bash
npm install
```

3. 启动开发服务器
```bash
npm run dev
```

4. 访问 http://localhost:3000

## 使用说明

1. 创建工作流：进入 DAG 编辑器页面，从左侧拖拽节点到画布
2. 配置节点：选中节点后在右侧面板配置任务参数
3. 连接节点：拖拽节点输出端口到另一个节点的输入端口
4. 保存工作流：填写工作流名称和描述后点击保存
5. 执行工作流：在工作流列表中点击"执行"按钮
6. 查看执行结果：在执行历史中查看执行详情和任务结果

## API 接口

- `GET /workflows`: 获取工作流列表
- `POST /workflows`: 创建工作流
- `GET /workflows/{id}`: 获取工作流详情
- `PUT /workflows/{id}`: 更新工作流
- `DELETE /workflows/{id}`: 删除工作流
- `POST /execute`: 执行工作流
- `GET /executions`: 获取执行历史
- `GET /executions/{id}`: 获取执行详情
- `GET /tasks/{id}/status`: 获取任务状态