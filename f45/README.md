# 离线 Markdown 笔记应用

一个支持离线编辑和实时协作的 Markdown 笔记应用，基于 Vue 3、Pinia、Yjs CRDT 技术构建。

## ✨ 已修复的核心问题

### 图片粘贴导致的同步冲突

**问题描述**：当用户在离线状态下粘贴图片，而另一个客户端在同一位置输入文字时，重新上线后文档结构损坏，Yjs 抛出 "Update decoding failed" 错误。

**解决方案**：

1. **重构数据模型**：
   - 使用 `Y.Text` 类型处理文本内容（标题和正文），支持增量更新
   - 使用独立的 `Y.Map` 存储图片数据，与文本分离
   - 每篇笔记使用嵌套的 `Y.Map` 结构组织所有数据

2. **增量文本同步**：
   - 实现 `YTextBinding` 类，将 textarea 直接绑定到 Y.Text
   - 计算文本差异，只同步变更的部分（插入/删除），而不是每次替换整个文本
   - 支持输入法组合（中文输入等）的正确处理

3. **图片独立存储**：
   - 图片以 Base64 格式存储在独立的 `Y.Map` 中
   - 文本中只保存图片引用标记 `![imageId](imageId)`
   - 渲染时动态替换为实际的图片数据

## 技术栈

- **前端**: Vue 3 + Pinia + Vite
- **后端**: Node.js + ws (WebSocket)
- **CRDT**: Yjs (实现无冲突合并)
- **离线存储**: IndexedDB (y-indexeddb)
- **服务端持久化**: LevelDB

## 核心特性

1. ✅ 离线编辑 - 断网时也能正常编辑笔记
2. ✅ 实时同步 - 多客户端实时同步编辑
3. ✅ 自动合并 - 基于 CRDT 技术，离线编辑后自动合并，无冲突
4. ✅ 图片粘贴 - 支持直接粘贴图片到编辑器
5. ✅ Markdown 预览 - 实时预览 Markdown 渲染
6. ✅ 本地持久化 - 使用 IndexedDB 本地存储

## 安装和运行

### 1. 安装依赖

```bash
# 安装服务端依赖
cd server
npm install

# 安装客户端依赖
cd ../client
npm install
```

### 2. 启动服务

**启动 WebSocket 同步服务器**

```bash
cd server
npm start
```

服务器将在 `ws://localhost:1234` 运行

**启动前端开发服务器**

```bash
cd client
npm run dev
```

前端应用将在 `http://localhost:3003` 运行

## 功能测试指南

### 📝 测试 1: 离线编辑 + 图片同步（无冲突）

1. 打开两个浏览器窗口，都访问 `http://localhost:3000`
2. 在窗口 A 创建一篇新笔记，输入一些文字
3. **停止 WebSocket 服务器**（模拟离线）- 状态栏显示"离线模式"
4. 在窗口 A 粘贴一张图片
5. 在窗口 B 的同一篇笔记中继续输入文字
6. **重启 WebSocket 服务器**
7. ✅ 观察：两个窗口的内容**自动合并**，图片和文字正确显示，**无冲突！**

---

### 📜 测试 2: 版本历史 + 回滚功能

1. 打开浏览器访问 `http://localhost:3000`，创建一篇笔记
2. 点击右上角 **"📜 版本历史"** 按钮
3. 点击 **"📷 创建快照"** 按钮手动保存当前版本
4. 继续编辑笔记，修改内容
5. 再次创建第二个快照
6. 在版本列表中点击第一个版本的 **"恢复到此版本"**
7. ✅ 观察：笔记内容回滚到第一个快照的状态，所有客户端同步更新

---

### ⏱️ 测试 3: 自动快照功能

1. 打开一篇笔记并进行编辑
2. 点击 "创建快照" 注册该笔记到自动快照列表
3. 等待 60 秒（服务器自动快照间隔）
4. 再次查看版本历史，会看到新增的自动快照
5. ✅ 观察：服务器自动为活跃笔记创建版本快照

## 项目结构

```
.
├── client/                 # 前端应用
│   ├── src/
│   │   ├── stores/
│   │   │   └── notes.js   # Pinia store + Yjs 集成
│   │   ├── utils/
│   │   │   └── y-text-binding.js  # Y.Text 增量同步绑定
│   │   ├── App.vue         # 主组件
│   │   └── style.css       # 样式文件
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── server/                 # 后端服务器
│   ├── index.js            # WebSocket 服务器
│   └── package.json
└── README.md
```

## CRDT 数据结构

```
Y.Doc
└── notes (Y.Map)
    └── noteId (Y.Map)
        ├── id (string)
        ├── title (Y.Text)    ← 支持增量同步
        ├── content (Y.Text)  ← 支持增量同步
        ├── images (Y.Map)    ← 独立存储图片
        ├── createdAt (number)
        └── updatedAt (number)
```

## 关键实现说明

### Y.Text 绑定 (`y-text-binding.js`)

- 监听 textarea 的 input 事件
- 计算新旧文本的差异（公共前缀/后缀）
- 只对变更部分执行 `delete/insert` 操作
- 使用 `transaction.origin` 标识来源，避免循环更新

### 图片处理流程

1. 用户粘贴图片 → 转换为 Base64
2. 生成唯一 imageId
3. 将 Base64 数据存入 `images` Map
4. 在文本光标位置插入图片 Markdown 标记
5. 渲染时将标记替换为实际 `<img>` 标签
