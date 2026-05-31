# 法律合同协同编辑平台

一个基于 Vue 3 + ProseMirror + FastAPI + Yjs 的法律合同协同编辑平台，支持多用户实时协作编辑。

## 功能特性

- **富文本编辑**：基于 ProseMirror 实现，支持复杂的法律条款格式化
- **实时协同**：使用 Yjs (CRDT) 实现多用户并发编辑，自动处理冲突
- **离线支持**：数据先存储在 IndexedDB，网络恢复后自动与后端同步
- **角色权限控制**：
  - 管理员/律师：可编辑文档
  - 客户：仅可评论，不可编辑
- **评论系统**：支持对文档内容进行评论
- **法律条款模板**：支持插入法律条款块、定义块等专业格式

## 技术栈

### 前端
- Vue 3 + Composition API
- ProseMirror (富文本编辑器)
- Yjs (CRDT 协同编辑)
- y-websocket (WebSocket 同步)
- y-indexeddb (离线存储)
- Element Plus (UI 组件库)
- Pinia (状态管理)
- Vue Router (路由)
- Vite (构建工具)

### 后端
- Python 3.8+
- FastAPI (Web 框架)
- WebSocket (实时通信)
- SQLite (数据库)
- JWT (认证)
- Passlib (密码加密)

## 项目结构

```
legal-contract-editor/
├── backend/                    # 后端代码
│   ├── main.py                # FastAPI 应用入口
│   ├── requirements.txt       # Python 依赖
│   ├── .env.example           # 环境变量示例
│   └── legal_contract.db      # SQLite 数据库文件 (运行后生成)
├── frontend/                   # 前端代码
│   ├── src/
│   │   ├── components/        # 公共组件
│   │   │   └── ProseEditor.vue    # ProseMirror 编辑器组件
│   │   ├── editor/            # 编辑器核心逻辑
│   │   │   ├── schema.js      # ProseMirror Schema 定义
│   │   │   ├── plugins.js     # 编辑器插件
│   │   │   └── yjs.js         # Yjs 协同编辑集成
│   │   ├── stores/            # Pinia 状态管理
│   │   │   ├── auth.js        # 认证状态
│   │   │   └── document.js    # 文档状态
│   │   ├── views/             # 页面视图
│   │   │   ├── Login.vue      # 登录页
│   │   │   ├── Documents.vue  # 文档列表页
│   │   │   └── Editor.vue     # 编辑器页面
│   │   ├── router/            # 路由配置
│   │   ├── styles/            # 全局样式
│   │   ├── App.vue
│   │   └── main.js
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
└── README.md
```

## 快速开始

### 1. 启动后端服务

```bash
cd backend

# 安装依赖
pip install -r requirements.txt

# 启动服务
python main.py
```

后端服务将在 http://localhost:8000 启动

API 文档：http://localhost:8000/docs

### 2. 启动前端服务

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端服务将在 http://localhost:3000 启动

## 演示账号

系统预置以下测试账号：

| 用户名 | 密码 | 角色 | 权限 |
|--------|------|------|------|
| admin | admin123 | 管理员 | 完全访问，可创建/编辑文档 |
| lawyer1 | lawyer123 | 律师 | 可创建/编辑文档 |
| client1 | client123 | 客户 | 仅可查看和评论文档 |

## 使用说明

### 文档编辑

1. 使用律师或管理员账号登录
2. 点击"新建合同"创建新文档
3. 在编辑器中编辑内容
4. 支持的格式：
   - 标题（H1/H2/H3）
   - 粗体、斜体、下划线
   - 有序/无序列表
   - 引用块
   - 代码块
   - 法律条款块（点击"插入条款"按钮）
   - 重要内容高亮（黄色背景）

### 协同编辑

1. 多个用户同时打开同一个文档
2. 所有编辑操作会实时同步到其他用户
3. 即使离线，编辑内容也会保存在本地
4. 网络恢复后自动与服务器同步

### 评论功能

1. 客户角色登录后，可以查看文档
2. 选中要评论的文本
3. 在右侧评论面板输入评论内容
4. 点击"发表评论"

## 核心技术说明

### CRDT 协同编辑

使用 Yjs 实现 CRDT (Conflict-free Replicated Data Type)：
- 每个客户端维护完整的文档副本
- 编辑操作转换为 Yjs 操作进行同步
- 自动解决并发冲突，保证最终一致性

### 离线优先

- 使用 y-indexeddb 将文档状态持久化到浏览器 IndexedDB
- 离线时所有编辑操作保存在本地
- 网络恢复后，通过 y-websocket 自动同步

### ProseMirror 法律格式

自定义 Schema 支持法律文档特有的格式：
- `clause` 节点：法律条款块
- `definition` 节点：定义块
- `important` 标记：重要内容高亮
- `comment` 标记：评论锚点

## API 接口

### 认证

- `POST /api/token` - 登录获取访问令牌
- `GET /api/users/me` - 获取当前用户信息

### 文档

- `GET /api/documents` - 获取文档列表
- `POST /api/documents` - 创建新文档
- `GET /api/documents/{id}` - 获取文档详情
- `WebSocket /ws/{doc_id}` - 文档实时同步

### 评论

- `GET /api/documents/{id}/comments` - 获取评论列表
- `POST /api/documents/{id}/comments` - 添加评论

## 注意事项

1. 本项目使用 SQLite 作为数据库，适合开发和小规模部署
2. 生产环境建议使用 PostgreSQL 或 MySQL
3. JWT 密钥请在 .env 文件中修改
4. WebSocket 连接默认使用明文，生产环境请启用 HTTPS/WSS

## 许可证

MIT License