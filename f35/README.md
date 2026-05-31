# Note Sync App

基于 Tauri + Svelte 构建的笔记同步应用，支持文件系统监听、Markdown 编辑和 P2P 局域网发现。

## 功能特性

### 1. 文件系统监听
- 使用 Rust `notify` crate 监听指定目录的文件变化
- 支持 Create/Modify/Delete 三种事件
- 实时更新前端 UI 和哈希记录

### 2. Markdown 编辑器
- 支持实时编辑和预览模式切换
- 自动保存（1秒延迟）
- 完整的 Markdown 语法渲染支持
- 文件树导航

### 3. P2P 发现协议
- 基于 UDP 广播的局域网节点发现
- 每 5 秒发送一次广播宣告
- 自动发现并显示局域网内其他运行实例
- 节点超时自动移除（15秒）

### 4. 文件哈希记录
- 使用 SHA256 算法计算文件哈希
- JSON 格式存储在 `.file_hashes.json`
- 记录文件路径、哈希值和修改时间
- 用于版本比对和同步检测

## 项目结构

```
.
├── src/                          # Svelte 前端
│   ├── App.svelte               # 主应用组件
│   ├── FileTree.svelte          # 文件树组件
│   ├── MarkdownEditor.svelte    # Markdown 编辑器
│   ├── PeerList.svelte          # P2P 节点列表
│   └── main.js                  # 入口文件
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs              # 主入口和 Tauri 命令
│   │   ├── file_watcher.rs      # 文件系统监听
│   │   ├── p2p_discovery.rs     # P2P 发现协议
│   │   └── hash_manager.rs      # 哈希管理
│   ├── Cargo.toml               # Rust 依赖
│   └── tauri.conf.json          # Tauri 配置
├── package.json                  # Node 依赖
├── vite.config.js               # Vite 配置
└── svelte.config.js             # Svelte 配置
```

## 安装与运行

### 前置要求

- [Rust](https://www.rust-lang.org/tools/install) (1.70+)
- [Node.js](https://nodejs.org/) (18+)
- [Tauri CLI](https://tauri.app/v1/api/cli/)

### 开发模式

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run tauri dev
```

### 构建生产版本

```bash
npm run tauri build
```

## 核心技术栈

### 后端 (Rust)
- **Tauri**: 桌面应用框架
- **tokio**: 异步运行时
- **notify**: 文件系统事件监听
- **sha2**: 哈希计算
- **serde**: 序列化/反序列化
- **walkdir**: 目录遍历

### 前端 (Svelte)
- **Svelte**: 前端框架
- **Vite**: 构建工具
- **marked**: Markdown 解析器
- **@tauri-apps/api**: Tauri 前端 API

## P2P 协议说明

### 广播地址
- 端口: 45678
- 地址: 255.255.255.255:45678

### 消息类型

1. **Announce (宣告)**
```json
{
  "id": "uuid-v4",
  "name": "hostname",
  "timestamp": 1234567890
}
```

2. **Discovery (发现请求)**
```json
{
  "id": "uuid-v4",
  "timestamp": 1234567890
}
```

## 哈希记录格式

文件 `.file_hashes.json` 格式：

```json
{
  "files": {
    "note1.md": {
      "path": "note1.md",
      "hash": "a1b2c3d4...",
      "modified": 1234567890
    }
  },
  "last_updated": 1234567890
}
```

## 使用说明

### 基础操作

1. **选择笔记目录**: 启动应用后，点击"选择笔记目录"按钮选择一个文件夹
2. **创建笔记**: 点击"+ 文件"创建新的 Markdown 文件
3. **编辑笔记**: 在左侧选择文件，右侧编辑器进行编辑
4. **查看哈希**: 底部状态栏显示当前文件数和最后更新时间

### P2P 节点发现

#### 方式一: UDP 广播模式（默认）

1. 在左侧面板选择 **📡 UDP 广播** 模式
2. 点击顶部 **🔌 启动P2P** 按钮
3. 局域网内其他运行相同应用的节点会被自动发现
4. 发现的节点显示在"发现的节点"列表中

#### 方式二: TCP 中继模式（防火墙备选方案）

**作为中继服务器:**
1. 在左侧面板选择 **🔗 TCP 中继** 模式
2. 点击 **🚀 启动服务器** 按钮
3. 服务器将在默认端口 45679 启动
4. 其他机器可连接到你的服务器

**连接到中继服务器:**
1. 选择 **🔗 TCP 中继** 模式
2. 方式一: 点击 **🔍 扫描局域网服务器** 自动发现
3. 方式二: 手动输入服务器地址（如 `192.168.1.100:45679`）并点击"连接"
4. 连接成功后，所有连接到同一服务器的节点会被显示

## 注意事项

### UDP 广播模式
- 确保防火墙允许 UDP 45678 端口入站/出站
- 仅在同一局域网内有效
- 某些路由器可能阻止广播包

### TCP 中继模式
- 确保防火墙允许 TCP 45679 端口入站（作为服务器时）
- 所有客户端必须连接到同一台中继服务器
- 中继服务器需要保持运行状态

### 通用注意事项
- 哈希文件 `.file_hashes.json` 会自动创建在笔记目录
- 文件系统事件可能会有轻微延迟
- 节点心跳超时时间为 15 秒
