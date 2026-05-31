# 智能预读缓存 (Read-Ahead Cache)

## 功能概述

智能预读缓存是基于Prometheus查询历史模式分析的索引预加载系统，通过预测热点数据块并提前加载到内存，将查询P99延迟降低30%以上。

## 核心特性

### 1. 查询日志解析
- 支持解析Prometheus文本和JSON格式查询日志
- 自动提取标签匹配器、时间范围、查询步长等参数
- 计算每个查询模式的频率和热度

### 2. 智能预测算法
- **时间重叠分析**: 检测查询时间范围与块时间的重叠度
- **热度评分系统**: 综合考虑查询频率、时效性、范围大小
- **热点块预测**: 基于历史模式预测未来热点块
- **自动调优**: 基于命中率动态调整缓存参数

### 3. 内存高效缓存
- LRU (最近最少使用) 淘汰策略
- 内存使用上限控制
- 异步后台预加载
- 索引文件mmap映射

### 4. 完整的监控指标
- 缓存命中率
- P99延迟改善百分比
- 预加载块数
- 内存使用量
- 缓存淘汰次数

## 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                      智能预读缓存系统                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  查询日志解析  │───▶│  模式分析器   │───▶│  热点块预测器    │  │
│  │  Log Parser  │    │  Pattern Anal│    │  Hot Predictor   │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
│                                       │                           │
│                                       ▼                           │
│  ┌──────────────┐    ┌───────────────────────────────────────┐  │
│  │  缓存管理器   │◀── │           LRU Cache Pool              │  │
│  │  Cache Mgr   │    │  (内存映射索引 + 引用计数 + 热度排名)  │  │
│  └──────────────┘    └───────────────────────────────────────┘  │
│          │                                                         │
│          ▼                                                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    REST API + Web UI                        │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 安装与配置

### Go后端集成

```go
import "github.com/prometheus-tsdb-manager/pkg/readahead"

// 创建缓存管理器
config := readahead.DefaultPredictorConfig()
config.MaxMemoryBytes = 512 * 1024 * 1024 // 512MB
config.LRUCapacity = 100

manager := readahead.NewCacheManager("/path/to/tsdb", "/path/to/logs", logger)
manager.Initialize(config)

// 触发预加载
manager.TriggerPreload(queries)

// 获取统计
stats := manager.GetStats()
fmt.Printf("命中率: %.2f%%\n", stats.HitRate * 100)
fmt.Printf("P99改善: %.2f%%\n", manager.GetPredictedLatencyImprovement())
```

### CLI命令

```bash
# 查看缓存统计
./prometheus-tsdb-manager cache stats --data-dir /path/to/data

# 查看热门查询模式
./prometheus-tsdb-manager cache patterns --data-dir /path/to/data

# 启用/禁用缓存
./prometheus-tsdb-manager cache enable
./prometheus-tsdb-manager cache disable

# 清空缓存
./prometheus-tsdb-manager cache flush

# 指定查询日志目录和内存限制
./prometheus-tsdb-manager cache stats --log-dir /var/log/prometheus --max-memory 1024
```

### API端点

```bash
# 获取缓存统计
GET /api/v1/cache/stats
# 响应包含: 命中率、命中数、未命中数、P99改善百分比等

# 启用/禁用缓存
POST /api/v1/cache/enable
POST /api/v1/cache/disable

# 清空缓存
POST /api/v1/cache/flush

# 获取热门查询模式
GET /api/v1/cache/patterns

# 获取已缓存块列表
GET /api/v1/cache/blocks
```

## 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `LookbackWindow` | 7天 | 分析查询历史的时间窗口 |
| `HotThreshold` | 0.3 | 热点块判定阈值 |
| `MinQueryCount` | 5 | 最小查询数阈值 |
| `PreloadAhead` | 2小时 | 提前预加载时间范围 |
| `MaxMemoryBytes` | 512MB | 最大内存使用量 |
| `LRUCapacity` | 50 | LRU缓存容量（块数） |
| `EnablePrediction` | true | 是否启用预测功能 |
| `AutoTune` | true | 是否自动调优参数 |

## 热度评分算法

热度评分综合考虑三个因素：

```
HotScore = 0.5 × 频率因子 + 0.3 × 时效性因子 + 0.2 × 范围因子

其中:
- 频率因子 = min(查询数 / MinQueryCount, 1.0)
- 时效性因子 = exp(-小时数 / 24)  (指数衰减)
- 范围因子 = min(查询范围小时数 / 24, 1.0)
```

## 性能指标与目标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 缓存命中率 | > 70% | 命中缓存的查询比例 |
| P99延迟降低 | > 30% | 相比无缓存的延迟改善 |
| 内存利用率 | 60-80% | 目标内存使用范围 |
| 预加载准确率 | > 60% | 被预加载块实际被访问的比例 |

## 使用场景

### 场景1: 仪表盘查询优化
Grafana仪表盘通常固定查询某些时间范围（如最近24小时），缓存系统可以预加载这些热点块。

### 场景2: 告警规则评估
Prometheus告警规则周期性执行相同查询，缓存可以显著降低评估延迟。

### 场景3: 批量数据分析
大数据团队进行历史数据分析时，系统可以学习查询模式，预加载相关块。

## 与其他优化的协同

智能预读缓存与以下优化功能协同工作：

1. **索引重构**: 优化后的索引文件加载更快，缓存效果更好
2. **块合并**: 大块减少缓存碎片，提高内存利用率
3. **孤立引用清理**: 确保缓存中不包含无效引用，避免查询panic

## 故障排查

### 常见问题

**Q: 缓存命中率很低？**
- 检查是否有足够的查询历史数据
- 调大 `LookbackWindow` 参数
- 增加 `MaxMemoryBytes` 内存限制

**Q: P99延迟改善未达到30%？**
- 确保已开启缓存预热功能
- 检查是否有足够的热门查询模式
- 考虑优化块大小配置

**Q: 内存使用过高？**
- 调小 `MaxMemoryBytes` 参数
- 减少 `LRUCapacity`
- 检查是否有内存泄漏

### 日志调试

```bash
# 启用debug日志
./prometheus-tsdb-manager --verbose --log-level debug
```

## 未来规划

- [ ] 支持基于机器学习的预测模型
- [ ] 跨实例缓存共享
- [ ] 自适应预热策略
- [ ] 缓存持久化支持
- [ ] 更多缓存淘汰策略选项
