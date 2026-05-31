# 多人实时协同白板系统

基于 React + Node.js + WebRTC + CRDT 的多人实时白板协同系统。

## 功能特性

- 🎨 **多种绘图工具**: 支持画笔、矩形、圆形、文本四种图形
- 🔄 **无冲突合并**: 使用 CRDT（无冲突复制数据类型）算法保证多人同时编辑无冲突
- 🌐 **WebRTC 点对点**: 低延迟实时数据传输
- 📜 **历史版本回放**: 时间轴滑块可拖动回看任意历史版本
- 💾 **自动持久化**: 每 5 秒自动保存版本快照到 PostgreSQL 数据库
- 👥 **多人协作**: 支持 10+ 人同时在线绘图

## 技术栈

### 后端
- Node.js + Express
- WebSocket (ws 库) - 信令服务器
- PostgreSQL - 数据持久化
- pg - PostgreSQL 驱动

### 前端
- React 18
- WebRTC - 点对点数据传输
- Canvas API - 白板渲染
- uuid - 唯一标识生成

## 项目结构

```
f14/
├── server/                 # 后端服务
│   ├── src/
│   │   ├── config/
│   │   │   └── database.js # 数据库配置
│   │   └── index.js       # 主服务入口
│   ├── init-db.sql        # 数据库初始化脚本
│   └── package.json
├── client/                 # 前端应用
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── components/
│   │   │   ├── Whiteboard.js  # 白板组件
│   │   │   ├── Toolbar.js     # 工具栏
│   │   │   └── Timeline.js    # 时间轴
│   │   ├── utils/
│   │   │   ├── crdt.js        # CRDT 实现
│   │   │   └── webrtc.js      # WebRTC 管理
│   │   ├── App.js
│   │   └── index.js
│   └── package.json
└── package.json             # 根项目配置
```

## 安装和运行

### 前置要求
- Node.js >= 16.0.0
- PostgreSQL >= 12.0
- npm 或 yarn

### 1. 数据库准备

启动 PostgreSQL 服务，创建数据库：

```bash
psql -U postgres -f server/init-db.sql
```

或者手动执行 SQL 命令：
```sql
CREATE DATABASE whiteboard;
```

### 2. 安装依赖

```bash
# 安装后端依赖
cd server
npm install

# 安装前端依赖
cd ../client
npm install

# 或者在根目录一次性安装全部（需要先进入各目录安装）
cd ..
npm install
```

### 3. 配置数据库

如果你的 PostgreSQL 配置与默认不同，请修改 `server/src/config/database.js` 中的连接配置：

```javascript
const pool = new Pool({
  user: 'postgres',           // 你的数据库用户名
  host: 'localhost',          // 数据库地址
  database: 'whiteboard',     // 数据库名
  password: 'your-password',  // 你的数据库密码
  port: 5432,                 // 数据库端口
});
```

### 4. 启动服务

#### 方式一：分别启动

```bash
# 启动后端服务 (端口 3001)
cd server
npm run dev

# 启动前端服务 (端口 3000)
cd ../client
npm start
```

#### 方式二：使用 concurrently 同时启动（需要先安装根目录依赖）

```bash
npm run dev
```

### 5. 使用系统

1. 打开浏览器访问 `http://localhost:3000`
2. 点击"连接服务器"按钮加入白板房间
3. 使用工具栏选择绘图工具开始绘图
4. 打开多个浏览器标签页测试多人协作
5. 点击"加载历史"查看历史快照，拖动时间轴回放

## 使用说明

### 绘图工具
- **画笔 ✏️**: 自由绘制曲线
- **矩形 ⬜**: 绘制矩形边框
- **圆形 ⭕**: 绘制椭圆形/圆形边框
- **文本 T**: 在画布上添加文字

### 颜色和粗细
- 支持 8 种预设颜色
- 笔触粗细可调节 (1-20px)

### 历史回放
1. 点击"加载历史"按钮获取所有快照
2. 拖动时间轴滑块跳转到指定时间点
3. 点击"播放"按钮自动回放历史
4. 点击"退出预览模式"回到实时编辑

## 核心实现原理

### CRDT (无冲突复制数据类型)
- 每个操作生成唯一 ID（站点 ID + 时钟）
- 远程操作合并时自动去重
- 按时间戳排序保证最终一致性
- 支持离线编辑后同步

### WebRTC 数据通道
- 信令服务器用于交换 SDP 和 ICE 候选
- 建立点对点 RTCDataChannel
- 操作通过数据通道直接广播给所有对等方
- 低延迟，支持大规模并发

### 自动快照
- 服务器每 5 秒自动保存房间状态
- 快照包含所有 CRDT 操作
- 支持按时间范围查询历史
- 新用户加入时自动加载最新快照

## 浏览器兼容性

- Chrome >= 56
- Firefox >= 50
- Safari >= 11
- Edge >= 79

注意：WebRTC 在非 HTTPS 环境下仅支持 localhost。

## 开发说明

### 后端开发
- `server/src/index.js`: WebSocket 服务器和房间管理
- `server/src/config/database.js`: PostgreSQL 数据库操作

### 前端开发
- `client/src/utils/crdt.js`: CRDT 文档管理
- `client/src/utils/webrtc.js`: WebRTC 连接管理
- `client/src/components/Whiteboard.js`: Canvas 绘图组件
- `client/src/App.js`: 主应用逻辑

## 许可证

MIT
