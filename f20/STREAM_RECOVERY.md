# 自动断流检测与恢复功能

## 概述

该功能实现了实时流媒体服务的自动断流检测、事件通知和快速重连恢复。当推流端网络中断或异常断开时，系统能够：
- 自动检测断流事件（10秒超时）
- 通过HTTP回调通知业务系统
- 保持FFmpeg转码进程不重启
- 支持推流端快速重连恢复

## 核心功能

### 1. 断流检测机制

检测触发条件（满足任一即可）：
- **RTP包超时**: 10秒内未收到任何音频/视频RTP包
- **质量分数为0**: 音视频score均为0且持续5秒以上
- **Producer关闭**: mediasoup producer触发close事件

### 2. 恢复机制

- **恢复窗口**: 断流后60秒内可重连恢复
- **无缝切换**: 重连时仅更新RTP消费者，FFmpeg进程不重启
- **自动清理**: 超过恢复窗口未重连则自动清理资源

### 3. 事件通知

支持配置HTTP回调地址，系统会在以下事件发生时发送通知：

| 事件类型 | 触发时机 | 数据内容 |
|---------|---------|---------|
| `create` | 流创建成功 | streamId, timestamp |
| `disconnect` | 检测到断流 | streamId, timestamp, uptime |
| `reconnect` | 流重连恢复 | streamId, timestamp, disconnectDuration, reconnectAttempt |
| `destroy` | 流被销毁清理 | streamId, timestamp |

## 配置说明

编辑 `config/default.json`:

```json
{
  "streamRecovery": {
    "enabled": true,
    "disconnectTimeout": 10,
    "recoveryWindow": 60,
    "maxReconnectAttempts": 5,
    "eventCallbacks": [
      "https://your-server.com/api/stream-events"
    ]
  }
}
```

### 配置参数详解

| 参数 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `enabled` | boolean | `true` | 是否启用断流恢复功能 |
| `disconnectTimeout` | number | `10` | 断流检测超时（秒） |
| `recoveryWindow` | number | `60` | 恢复窗口时长（秒） |
| `maxReconnectAttempts` | number | `5` | 最大重连次数（预留） |
| `eventCallbacks` | array | `[]` | 事件回调URL列表 |

## API接口

### 1. 动态添加回调地址

```http
POST /api/callbacks
Content-Type: application/json

{
  "url": "https://your-server.com/api/stream-events"
}
```

响应:
```json
{
  "success": true,
  "message": "Callback URL added"
}
```

### 2. 移除回调地址

```http
DELETE /api/callbacks
Content-Type: application/json

{
  "url": "https://your-server.com/api/stream-events"
}
```

响应:
```json
{
  "success": true,
  "message": "Callback URL removed"
}
```

### 3. 流状态查询

查看所有流状态（包含断流信息）:
```http
GET /api/streams
```

响应示例:
```json
{
  "success": true,
  "data": [
    {
      "id": "client-id-123",
      "uptime": 3600,
      "isDisconnected": false,
      "reconnectAttempts": 1,
      "timeSinceLastPacket": 500,
      "disconnectDuration": 0,
      "bitrates": {
        "1080p": 4500,
        "720p": 2500,
        "480p": 1000
      },
      ...
    }
  ]
}
```

## 回调通知格式

### 请求示例

```http
POST https://your-server.com/api/stream-events
Content-Type: application/json

{
  "event": "disconnect",
  "data": {
    "streamId": "client-123",
    "timestamp": 1715678901234,
    "uptime": 3600
  },
  "timestamp": 1715678901234
}
```

### 事件类型详解

#### disconnect (断流)
```json
{
  "event": "disconnect",
  "data": {
    "streamId": "client-123",
    "timestamp": 1715678901234,
    "uptime": 3600
  }
}
```

#### reconnect (重连恢复)
```json
{
  "event": "reconnect",
  "data": {
    "streamId": "client-123",
    "timestamp": 1715678911234,
    "disconnectDuration": 10000,
    "reconnectAttempt": 1
  }
}
```

## 推流端重连流程

### 正常推流流程
```
1. 客户端WebSocket连接
2. 创建WebRTC transport
3. 产生audio/video producer
4. 服务端创建转码会话
5. FFmpeg开始转码输出HLS
```

### 断流重连流程
```
1. 网络中断 → WebRTC连接断开
2. 服务端10秒无包 → 触发disconnect事件
3. 服务端通知回调 → 标记isDisconnected=true
4. 客户端网络恢复 → 重新WebSocket连接
5. 客户端重新produce音视频
6. 服务端检测到流已存在 → 调用updateProducers()
7. 更新RTP消费者 → FFmpeg继续接收数据
8. 触发reconnect事件通知
```

### 关键优化点

**不重启FFmpeg的原因**:
- 避免转码初始化延迟（~2-3秒）
- 保持HLS切片序号连续不重置
- 播放器无需重新加载源
- 节省CPU资源消耗

## CLI工具使用

### 查看所有流（含断流状态）
```bash
npm run cli list
```

输出示例:
```
┌──────────────────┬──────────┬──────────────┬──────────────┬──────────────┬─────────┬──────────┬──────────┐
│ ID               │ Uptime   │ 1080p Bitrate│ 720p Bitrate │ 480p Bitrate │ Dropped │ Watermark│ PiP      │
├──────────────────┼──────────┼──────────────┼──────────────┼──────────────┼─────────┼──────────┼──────────┤
│ client-123       │ 1h 0m 5s │ 4500 kb/s    │ 2500 kb/s    │ 1000 kb/s    │ 0       │ No       │ 1 inputs │
│ disconnected-456 │ 0h 2m 10s│ N/A          │ N/A          │ N/A          │ 0       │ Yes      │ ⚠ DISCON │
└──────────────────┴──────────┴──────────────┴──────────────┴──────────────┴─────────┴──────────┴──────────┘
```

### 查看流详细统计
```bash
npm run cli stats client-123
```

输出包含断流相关字段:
- `isDisconnected`: 是否处于断流状态
- `reconnectAttempts`: 重连次数
- `timeSinceLastPacket`: 距最后一个包的时间（ms）
- `disconnectDuration`: 断流持续时长（ms）

## 监控告警建议

### 1. 断流频率监控
```
告警条件: 5分钟内断流次数 > 3
建议动作: 检查推流端网络稳定性
```

### 2. 恢复成功率监控
```
告警条件: 恢复成功率 < 80%
建议动作: 检查服务端网络和资源占用
```

### 3. 重连时长监控
```
告警条件: 平均断流持续时间 > 30秒
建议动作: 优化推流端重连逻辑
```

## 故障排查

### 问题1: 断流检测不触发

**可能原因**:
- disconnectTimeout配置过大
- FFmpeg仍在接收数据但播放器卡顿

**排查命令**:
```bash
# 查看实时日志
tail -f logs/app.log | grep "disconnected\|lastPacket"

# 检查RTP端口收包情况
tcpdump -i lo udp portrange 40000-41000
```

### 问题2: 重连后FFmpeg无输出

**可能原因**:
- FFmpeg输入缓冲阻塞
- SDP协商参数不匹配

**解决方案**:
- 检查StreamSession.updateProducers()日志
- 验证transport.tuple.localPort是否正确
- 必要时可强制重启FFmpeg

### 问题3: 回调通知失败

**排查步骤**:
1. 检查回调URL是否可访问
2. 查看服务端日志中回调错误信息
3. 验证回调服务5秒内可响应
4. 检查网络防火墙设置

## 性能影响

### 资源开销

| 组件 | CPU占用 | 内存占用 |
|-----|--------|---------|
| 断流检测定时器 | < 0.1% | < 1MB |
| 回调HTTP请求 | < 0.5% | < 2MB |
| 恢复时重新协商 | ~1-2% | 可忽略 |

### 对现有流的影响

- 断流检测: 完全不影响正常推流
- 重连恢复: 短暂（<100ms）视频帧丢失
- FFmpeg进程: 保持运行，无中断

## 设计决策记录

### 为什么选择10秒超时？

- 平衡检测灵敏度与误报率
- WebRTC自带重连缓冲约5-8秒
- 给网络临时波动留有余地

### 为什么不重启FFmpeg？

- 重启FFmpeg需要重新初始化编码器（~2秒）
- HLS切片序号重置会导致播放器重新加载
- 长时间运行的FFmpeg稳定性良好
- 仅更新RTP源端口即可恢复数据流

### 为什么使用HTTP回调而非WebSocket？

- 业务系统集成更简单
- 支持重试机制（预留）
- 无状态，扩展性更好
