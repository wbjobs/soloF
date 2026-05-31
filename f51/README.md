# 🔬 远程显微镜协作系统

基于 WebRTC 和 NestJS 的远程显微镜协作系统，支持多方实时视频协作和 3D 景深叠加可视化。

## ✨ 功能特性

- **WebRTC SFU 架构**: 使用 Mediasoup 作为选择性转发单元，支持多方视频流
- **主讲人模式**: 主讲人推送视频流，观众拉流观看
- **H.264 编码**: 自动协商 H.264 视频编码，确保最佳兼容性
- **3D 景深叠加**: Three.js 渲染显微镜视野的 3D 景深效果
- **实时协作**: 多人同时在线，实时查看显微镜画面
- **角色系统**: 支持主讲人 (speaker) 和观众 (viewer) 两种角色

## 🏗️ 项目结构

```
f51/
├── server/                 # NestJS 服务端 (信令 + SFU)
│   ├── src/
│   │   ├── config/         # Mediasoup 配置
│   │   ├── services/       # 业务服务 (Mediasoup, Room)
│   │   ├── gateways/       # WebSocket 信令网关
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── nest-cli.json
│
├── client/                 # React 前端
│   ├── src/
│   │   ├── components/     # UI 组件
│   │   ├── services/       # WebRTC 和信令服务
│   │   ├── hooks/          # 自定义 Hooks
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── index.html
│
└── shared/                 # 共享类型定义
    └── types.ts
```

## 🚀 快速开始

### 前置要求

- Node.js >= 18
- 浏览器支持 WebRTC (Chrome/Edge/Firefox)

### 启动服务端

```bash
cd server
npm install
npm run start:dev
```

服务端将在 `http://localhost:3001` 启动。

### 启动前端

```bash
cd client
npm install
npm run dev
```

前端将在 `http://localhost:5173` 启动。

## 📖 使用说明

1. 打开浏览器访问 `http://localhost:5173`
2. 输入房间号、你的名字
3. 选择角色：
   - **主讲人**: 共享你的摄像头/麦克风
   - **观众**: 观看主讲人的视频流
4. 点击「加入房间」
5. 在视频画面右下角可以控制：
   - 景深叠加开关
   - 线框模式
   - 景深强度调节

## 🔧 技术栈

### 服务端
- **NestJS**: 企业级 Node.js 框架
- **Mediasoup**: WebRTC SFU 服务器
- **Socket.IO**: WebSocket 信令通信
- **TypeScript**: 类型安全

### 前端
- **React 18**: UI 框架
- **Three.js**: 3D 渲染引擎
- **mediasoup-client**: WebRTC 客户端库
- **Socket.IO Client**: WebSocket 客户端
- **Vite**: 构建工具
- **TypeScript**: 类型安全

## 🔍 核心实现

### Mediasoup SFU 工作流

1. 服务端创建 Worker 和 Router
2. 客户端请求 Router RTP 能力
3. 创建 SendTransport (用于推送) 和 RecvTransport (用于拉取)
4. 主讲人通过 SendTransport 产生 Producer
5. 观众通过 RecvTransport 消费 Consumer
6. SFU 负责转发媒体流

### H.264 编码协商

```typescript
// 服务端配置 H.264 编码
{
  kind: 'video',
  mimeType: 'video/H264',
  clockRate: 90000,
  parameters: {
    'packetization-mode': 1,
    'profile-level-id': '42e01f',
  }
}
```

### 3D 景深叠加

使用 Three.js 创建动态位移的平面几何体，将视频作为纹理映射，模拟显微镜景深效果。

## 📝 开发说明

- 服务端端口: 3001
- 前端端口: 5173 (代理 WebSocket 到 3001)
- WebSocket 命名空间: `/signaling`
- Mediasoup RTC 端口范围: 10000-10100

## ⚙️ 配置说明

### 修改服务端监听 IP

编辑 `server/src/config/mediasoup.config.ts`:

```typescript
listenIps: [
  {
    ip: '0.0.0.0',
    announcedIp: '你的服务器IP',
  },
],
```

### 修改前端信令地址

编辑 `client/src/services/signaling.service.ts`:

```typescript
this.socket = io('你的服务器地址:3001/signaling');
```

## 📄 许可证

MIT License
