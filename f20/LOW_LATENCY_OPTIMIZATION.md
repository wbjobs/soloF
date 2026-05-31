# FFmpeg 低延迟优化说明

## 优化前后对比

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 端到端延迟 | ~8秒 | ~1.5-2秒 |
| GOP大小 | 2秒 (60帧@30fps) | 1秒 (30帧@30fps) |
| HLS切片时长 | 4秒 | 1秒 |
| HLS列表大小 | 5个切片 | 3个切片 |
| B帧 | 开启 | 完全关闭 |

## 详细优化参数

### 1. 输入缓冲优化 (addRtpInput)

```bash
# 禁用输入缓冲
-fflags +nobuffer+genpts+discardcorrupt
-avioflags direct
-flags low_delay

# 减少分析时长 (500ms → 加速启动)
-analyzeduration 500000
-probesize 500000
```

### 2. 视频编码优化 (x264)

```bash
# 超低延迟编码预设
-preset ultrafast          # 最快编码速度
-tune zerolatency          # 零延迟优化
-bf 0                      # 完全关闭B帧
-refs 1                    # 仅1个参考帧
-rc-lookahead 0            # 禁用码率预读

# x264 专用低延迟参数
-x264opts no-mbtree:sync-lookahead=0:rc-lookahead=0

# GOP优化 (1秒关键帧间隔)
-g 30                      # 30fps → 1秒GOP
-keyint_min 30             # 最小GOP
-sc_threshold 0            # 禁用场景切换检测
-flags +cgop               # 紧凑GOP
```

### 3. 复用器延迟优化

```bash
-max_delay 0
-muxdelay 0
-muxpreload 0
-flush_packets 1           # 立即写入输出
```

### 4. HLS低延迟模式

```bash
-f hls
-hls_time 1                # 1秒切片 (原4秒)
-hls_list_size 3           # 仅保留3个切片 (原5个)
-hls_flags low_latency+delete_segments+append_list+independent_segments
-hls_playlist_type event   # 事件模式
-hls_delete_threshold 1    # 立即删除旧切片
```

## 优化原理

### 为什么关闭B帧能降低延迟？
B帧 (双向预测帧) 需要参考前后的帧，会增加编码/解码缓冲。关闭B帧使用仅I帧和P帧，消除了双向预测带来的延迟。

### 为什么GOP=1秒？
- 播放器需要收到完整的GOP才能开始解码
- 更小的GOP = 更快的首帧显示
- 代价: 轻微降低编码效率 (~5-10%码率增加)

### HLS低延迟模式
- `low_latency`: 启用HLS低延迟模式 (LL-HLS)
- `independent_segments`: 每个切片可独立解码
- 1秒切片: 播放器只需等待1秒即可开始播放

## 预期延迟分解

| 阶段 | 延迟 |
|------|------|
| WebRTC采集 + 传输 | ~200ms |
| mediasoup 处理 | ~50ms |
| FFmpeg 编码缓冲 | ~500ms |
| HLS切片生成 | ~1000ms |
| 播放器缓冲 | ~200ms |
| **总计** | **~1.95秒** |

## 播放器端优化建议

为了达到最佳效果，播放器也需要配置低延迟模式：

```javascript
// hls.js 配置
const hls = new Hls({
  enableWorker: true,
  lowLatencyMode: true,
  liveSyncDurationCount: 1,  // 仅缓冲1个切片
  liveMaxLatencyDurationCount: 2,
  liveDurationInfinity: true
});

// video.js 配置
videojs.options.html5.vhs.enableLowLatency = true;
videojs.options.html5.vhs.liveSyncDuration = 1;
```

## 权衡考虑

| 优化 | 延迟降低 | 质量/效率影响 |
|------|----------|---------------|
| ultrafast preset | ✅✅✅ | 编码效率降低20% |
| 关闭B帧 | ✅✅ | 压缩效率降低10% |
| GOP=1秒 | ✅✅ | 关键帧增加 → 码率+5% |
| 1秒切片 | ✅✅✅ | 文件IO增加 |

## 测试方法

```bash
# 使用 ffprobe 检查编码参数
ffprobe -v quiet -select_streams v:0 -show_entries stream=codec_name,has_b_frames,gop_size,avg_frame_rate output.m3u8

# 查看B帧是否关闭 (has_b_frames 应该为 0)
# 查看GOP大小 (gop_size 应该等于 fps)
```

## 故障排除

### 如果延迟仍然很高
1. 检查网络延迟: `ping <server-ip>`
2. 检查CPU使用率: `top` (编码瓶颈)
3. 验证FFmpeg参数是否正确应用
4. 检查播放器缓冲配置

### 如果视频质量下降
1. 可适当提高码率 (+10-20%)
2. 将 preset 改为 `superfast` (平衡速度与质量)
3. 保持 GOP=1秒，不要增加
