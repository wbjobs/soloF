# 待办清单 PWA 应用

一个支持离线编辑、联网后自动合并冲突的待办清单应用，使用 Yjs CRDT 技术实现数据一致性。

## 技术栈

- **前端**: React + Vite
- **CRDT**: Yjs (处理数据一致性和冲突合并)
- **本地存储**: IndexedDB (y-indexeddb)
- **同步**: WebSocket (y-websocket)
- **PWA**: vite-plugin-pwa
- **拖拽排序**: react-beautiful-dnd

## 核心功能

1. ✅ 添加、完成、删除待办任务
2. ✅ 拖拽排序
3. ✅ 离线模式 - 断网时正常使用
4. ✅ 自动同步 - 恢复网络后自动同步
5. ✅ 冲突解决 - 使用 CRDT 自动合并冲突
6. ✅ PWA - 可安装到桌面，支持离线访问
7. ✅ 多端实时同步

## 项目结构

```
.
├── src/
│   ├── store/
│   │   └── ydoc.js          # Yjs CRDT 数据层
│   ├── hooks/
│   │   └── useTodoStore.js  # React Hook
│   ├── App.jsx              # 主应用组件
│   ├── main.jsx             # 入口文件
│   └── index.css            # 样式文件
├── server/
│   └── index.js             # WebSocket 服务端
├── index.html
├── vite.config.js
└── package.json
```

## 安装和运行

### 1. 安装依赖

```bash
npm install
```

### 2. 启动 WebSocket 服务端

```bash
npm run server
```

服务端将运行在 `ws://localhost:1234`

### 3. 启动前端开发服务器

```bash
npm run dev
```

前端将运行在 `http://localhost:3000`

### 4. 构建生产版本

```bash
npm run build
```

## 离线测试

1. 打开浏览器开发者工具 (F12)
2. 进入 Network 标签页
3. 选择 "Offline" 模拟离线状态
4. 在离线状态下添加、修改、删除任务
5. 恢复网络连接，观察数据自动同步

## 多端同步测试

1. 在两个不同的浏览器窗口打开应用
2. 在一个窗口添加任务
3. 观察另一个窗口实时更新
4. 尝试在两个窗口同时操作，验证冲突自动合并

## CRDT 工作原理

Yjs CRDT (Conflict-free Replicated Data Type) 确保：

- 每个客户端都有完整的数据副本
- 本地操作立即生效，无需等待服务器响应
- 所有操作自动同步到其他客户端
- 冲突自动合并，无需人工干预
- 最终所有客户端达到一致状态

## 数据持久化

- **客户端**: IndexedDB 本地持久化
- **服务端**: LevelDB 持久化存储

## 连接状态

- 🟢 **已连接**: WebSocket 正常连接
- 🟡 **连接中**: 正在尝试连接
- 🔴 **离线模式**: 网络断开，使用本地数据
