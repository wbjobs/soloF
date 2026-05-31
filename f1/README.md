# WebRTC 音视频会议系统

基于 Vue3 + Node.js 的实时音视频会议系统，核心特性为动态噪声抑制和回声消除的自适应校准。

## 功能特性

### 核心功能
- ✅ 会议室创建与加入
- ✅ 实时音视频传输 (WebRTC)
- ✅ 动态音频校准系统
- ✅ 噪声抑制 (ANS) 自动优化
- ✅ 回声消除 (AEC) 自适应校准
- ✅ 校准前后效果对比开关
- ✅ 参数持久化存储 (IndexedDB)
- ✅ 房间状态管理 (Redis)
- ✅ Socket.io 信令服务

### 音频校准流程
1. **1kHz 正弦波测试** - 检测频率响应
2. **粉红噪声测试** - 测量房间声学特性
3. **语音片段测试** - 使用 Web Speech API 生成测试语音
4. **参数计算** - 计算房间脉冲响应、噪声底噪、回声延迟等
5. **自动优化** - 根据计算结果调整 AEC/ANS 参数

## 技术栈

### 前端
- **Vue 3.4** - 渐进式 JavaScript 框架
- **TypeScript 5** - 类型安全
- **Pinia** - 状态管理
- **Vue Router 4** - 路由管理
- **Vite 5** - 构建工具
- **Element Plus** - UI 组件库
- **Tailwind CSS 3** - CSS 框架
- **Socket.io Client** - WebSocket 客户端
- **Web Audio API** - 音频处理
- **IndexedDB** - 本地存储

### 后端
- **Node.js** - 运行环境
- **Express 4** - Web 框架
- **Socket.io 4** - WebSocket 服务
- **Redis** - 房间状态存储

## 项目结构

```
.
├── frontend/                    # 前端项目
│   ├── src/
│   │   ├── views/              # 页面组件
│   │   │   ├── HomePage.vue   # 首页 - 创建/加入会议室
│   │   │   └── RoomPage.vue   # 会议室页面 - 视频通话+校准
│   │   ├── stores/             # Pinia 状态管理
│   │   │   └── meeting.ts     # 会议状态存储
│   │   ├── utils/              # 工具函数
│   │   │   ├── audioCalibration.ts  # 音频校准服务
│   │   │   ├── webrtc.ts      # WebRTC 通信服务
│   │   │   └── idb.ts         # IndexedDB 存储服务
│   │   ├── types/              # TypeScript 类型定义
│   │   ├── router/             # 路由配置
│   │   ├── main.ts             # 入口文件
│   │   ├── App.vue             # 根组件
│   │   └── style.css           # 全局样式
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── package.json
│
├── backend/                     # 后端项目
│   ├── src/
│   │   ├── server.js           # 主服务器入口
│   │   └── redis.js            # Redis 服务
│   └── package.json
│
└── .trae/documents/             # 项目文档
    ├── prd.md                  # 产品需求文档
    └── tech-arch.md            # 技术架构文档
```

## 快速开始

### 前置要求
- Node.js >= 18.0.0
- Redis >= 6.0 (用于房间状态管理)

### 安装与运行

#### 1. 启动 Redis
```bash
# 使用 Docker 启动 Redis
docker run -d -p 6379:6379 --name webrtc-redis redis:alpine

# 或使用本地安装的 Redis
redis-server
```

#### 2. 启动后端服务
```bash
cd backend
npm install
npm run dev
```
后端服务将在 `http://localhost:3001` 启动

#### 3. 启动前端服务
```bash
cd frontend
npm install
npm run dev
```
前端服务将在 `http://localhost:3000` 启动

### 使用说明

1. **创建会议室**
   - 输入昵称和会议名称
   - 点击"创建并加入会议"
   - 系统自动生成会议 ID

2. **加入会议室**
   - 输入昵称和会议 ID
   - 点击"加入会议"

3. **音频校准**
   - 进入会议室后自动开始校准
   - 校准过程包括三个阶段：正弦波、粉红噪声、语音测试
   - 校准完成后可在右侧面板查看详细参数
   - 可通过开关对比校准前后的音频效果

4. **会议控制**
   - 麦克风开关
   - 摄像头开关
   - 音频校准面板开关
   - 离开会议

## 核心模块说明

### 音频校准服务 (audioCalibration.ts)

```typescript
class AudioCalibrationService {
  // 生成 1kHz 正弦波测试音
  generateSineWave(frequency: number, duration: number): Promise<void>
  
  // 生成粉红噪声测试房间声学
  generatePinkNoise(duration: number): Promise<void>
  
  // 使用 Web Speech API 生成语音测试
  generateSpeechLikeSound(duration: number): Promise<void>
  
  // 计算本底噪声水平
  calculateNoiseFloor(data: number[]): number
  
  // 计算回声延迟和衰减
  calculateEchoMetrics(original: number[], recorded: number[]): EchoMetrics
  
  // 执行完整校准流程
  calibrate(onProgress: (step: string, progress: number) => void): Promise<CalibrationParams>
}
```

### WebRTC 服务 (webrtc.ts)

```typescript
class WebRTCService {
  // 连接信令服务器
  connect(serverUrl: string): Promise<void>
  
  // 加入会议室
  joinRoom(roomId: string, userId: string, userName: string): void
  
  // 创建 PeerConnection
  createPeerConnection(targetId: string): Promise<RTCPeerConnection>
  
  // 发送 Offer SDP
  createOffer(targetId: string): Promise<void>
  
  // 处理信令消息
  handleSignal(message: SignalMessage): void
}
```

### IndexedDB 存储 (idb.ts)

```typescript
class IndexedDBService {
  // 保存校准参数
  saveParams(params: CalibrationParams): Promise<number>
  
  // 获取最新校准参数
  getLatestParams(roomId: string, userId: string): Promise<CalibrationParams | null>
  
  // 获取所有历史参数
  getAllParams(): Promise<CalibrationParams[]>
}
```

## 数据模型

### CalibrationParams (校准参数)
```typescript
interface CalibrationParams {
  id?: number
  roomId: string
  userId: string
  timestamp: number
  aecLevel: number        // 回声消除强度 (0-100%)
  aecDelay: number        // 回声延迟 (ms)
  ansLevel: number        // 噪声抑制强度 (0-100%)
  noiseFloor: number      // 本底噪声水平 (dB)
  echoReturnLoss: number  // 回声返回损耗 (dB)
  roomImpulseResponse: number[]  // 房间脉冲响应
}
```

### Participant (参与者)
```typescript
interface Participant {
  id: string
  name: string
  isAudioEnabled: boolean
  isVideoEnabled: boolean
  stream?: MediaStream
}
```

## 部署说明

### 生产环境部署

1. **前端构建**
```bash
cd frontend
npm run build
```

2. **后端部署**
```bash
cd backend
npm start
```

3. **环境变量**
```bash
# Redis 连接
REDIS_URL=redis://localhost:6379

# 服务器端口
PORT=3001
```

### HTTPS 配置
WebRTC 需要 HTTPS 环境才能正常工作（localhost 除外），生产环境请配置 SSL 证书。

## 浏览器兼容性

- ✅ Chrome >= 90
- ✅ Firefox >= 88
- ✅ Edge >= 90
- ✅ Safari >= 14.1

注意：需要用户授权摄像头和麦克风权限。

## 开发计划

- [ ] 屏幕共享功能
- [ ] 聊天消息功能
- [ ] 文件传输
- [ ] 会议录制
- [ ] 虚拟背景
- [ ] 美颜滤镜
- [ ] 多人网格布局优化
- [ ] 音质增强算法 (AI-based)

## 许可证

MIT License
