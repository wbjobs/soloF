# WebRTC 实时流媒体转码服务

基于 Node.js + FFmpeg + mediasoup 的实时 WebRTC 转码服务，支持多清晰度输出、动态水印和画中画功能。

## 功能特性

- ✅ **WebRTC 接收**: 使用 mediasoup 接收 WebRTC 推流（支持 H.264/AAC）
- ✅ **实时转码**: FFmpeg 实时转码为三种清晰度（1080p/720p/480p）
- ✅ **HLS 输出**: 自动生成 HLS 播放列表和切片文件
- ✅ **动态水印**: 支持文字和图片水印，可实时调整位置和样式
- ✅ **画中画合成**: 最多支持 4 路输入合成一路输出，多种布局模式
- ✅ **CLI 工具**: 命令行工具管理推流会话
- ✅ **REST API**: 查询实时码率、丢帧率等统计信息
- ✅ **Docker 支持**: 一键部署，开箱即用

## 系统要求

- Node.js 20+
- FFmpeg 4.4+
- 支持 AVX2 的 CPU（推荐多核）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

```bash
npm start
```

服务将启动：
- WebSocket 服务: http://localhost:3000
- API 服务: http://localhost:3001
- HLS 静态文件: http://localhost:3000/hls

### 使用 Docker

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

## CLI 工具使用

```bash
# 查看所有流
npm run cli list

# 查看流详细统计
npm run cli stats <stream-id>

# 停止流
npm run cli stop <stream-id>

# 启用文字水印
npm run cli watermark <stream-id> --enable --text "Live Stream" --position bottom-right

# 启用图片水印
npm run cli watermark <stream-id> --enable --image /path/to/logo.png

# 禁用水印
npm run cli watermark <stream-id> --disable

# 启用画中画
npm run cli pip <stream-id> --enable --layout grid
```

## API 接口

### 获取所有流
```
GET /api/streams
```

### 获取单流详细统计
```
GET /api/streams/:id
```

### 停止流
```
DELETE /api/streams/:id
```

### 更新水印配置
```
POST /api/streams/:id/watermark
Content-Type: application/json

{
  "enabled": true,
  "type": "text",
  "text": "Live Stream",
  "fontSize": 24,
  "fontColor": "white",
  "position": "bottom-right"
}
```

### 更新画中画配置
```
POST /api/streams/:id/pip
Content-Type: application/json

{
  "enabled": true,
  "layout": "grid"
}
```

### 健康检查
```
GET /api/health
```

## 配置说明

编辑 `config/default.json` 自定义配置：

```json
{
  "server": {
    "port": 3000,
    "apiPort": 3001
  },
  "mediasoup": {
    "rtcMinPort": 40000,
    "rtcMaxPort": 49999
  },
  "transcoding": {
    "profiles": [
      {
        "name": "1080p",
        "width": 1920,
        "height": 1080,
        "videoBitrate": "5000k",
        "audioBitrate": "192k",
        "fps": 30
      }
    ],
    "hls": {
      "segmentDuration": 4,
      "listSize": 5,
      "outputDir": "./hls_output"
    }
  }
}
```

## HLS 播放地址

转码后的 HLS 流地址：
```
http://localhost:3000/hls/<stream-id>/1080p.m3u8
http://localhost:3000/hls/<stream-id>/720p.m3u8
http://localhost:3000/hls/<stream-id>/480p.m3u8
```

## 项目结构

```
.
├── src/
│   ├── index.js              # 主入口文件
│   ├── mediasoup/
│   │   └── MediasoupServer.js # mediasoup 服务
│   ├── transcoder/
│   │   ├── StreamManager.js  # 流管理器
│   │   ├── StreamSession.js  # 单流会话
│   │   └── FFmpegBuilder.js  # FFmpeg 命令构建器
│   ├── api/
│   │   └── server.js         # REST API 服务器
│   └── cli/
│       └── index.js          # CLI 工具
├── config/
│   └── default.json          # 默认配置
├── hls_output/               # HLS 输出目录
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 支持的水印位置

- top-left
- top-center
- top-right
- center-left
- center
- center-right
- bottom-left
- bottom-center
- bottom-right

## 画中画布局

- **grid**: 网格布局（支持 1-4 个输入）
- **side-by-side**: 左右并排布局

## 性能建议

1. **CPU 核心**: 每路转码约需要 1-2 个 CPU 核心
2. **内存**: 建议 4GB 以上内存
3. **网络**: 上行带宽根据码率总和计算
4. **存储**: 使用 SSD 存储 HLS 切片文件

## 许可证

MIT
