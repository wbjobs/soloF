# Prometheus TSDB Chunk引用计数修复说明

## 问题描述

在索引重构过程中，旧的索引文件可能仍然持有已删除chunk的指针，导致查询时发生panic。主要问题包括：

1. **孤立引用**：postings列表中引用了已不存在的chunk
2. **引用计数不一致**：同一个chunk被多个posting引用，但引用计数不正确
3. **死指针**：已合并或删除的block中的chunk引用没有被清理
4. **缺少一致性校验**：重构前后没有进行完整性检查

## 根本原因分析

### 问题1：倒排索引(postings)与chunk的生命周期不一致
- 当block被合并时，chunk数据被删除，但postings索引可能没有更新
- 旧索引文件可能仍包含指向已不存在chunk的引用
- 查询时访问这些死指针会导致nil pointer dereference panic

### 问题2：缺少引用计数追踪
- 没有追踪每个chunk被多少个posting引用
- 无法检测到过度引用或孤儿引用的情况
- 无法在重构时安全地清理引用

### 问题3：重构过程中没有校验
- 原有的rebuildInvertedIndex只是空操作
- 没有在重构过程中验证chunk引用的有效性
- 没有清理无效的posting条目

## 修复方案

### 1. 引用计数追踪机制 (`chunkRefCounter`)

```go
type chunkRefCounter struct {
    sync.RWMutex
    counts map[uint64]int      // chunk ref -> 引用计数
    valid  map[uint64]bool     // chunk ref -> 是否有效
}
```

**核心方法**：
- `AddRef(ref uint64)`: 增加引用计数
- `MarkValid(ref uint64)`: 标记chunk为有效
- `IsValid(ref uint64)`: 检查引用是否有效
- `GetOrphanedRefs()`: 获取所有孤立引用

### 2. 一致性校验功能 (`checkConsistency`)

在优化前后执行一致性检查，收集以下指标：

```go
type ConsistencyMetrics struct {
    TotalChunkRefs       int   // 总chunk引用数
    ValidChunkRefs       int   // 有效chunk引用数
    OrphanedChunkRefs    int   // 孤立chunk引用数
    TotalPostings        int   // 总posting数
    PostingsWithDeadRefs int   // 包含死引用的posting数
    ReferenceCountErrors int   // 引用计数错误数
}
```

### 3. 安全的索引重建 (`rebuildInvertedIndex`)

- 遍历所有posting，验证每个引用的有效性
- 只保留包含有效chunk的series引用
- 过滤掉所有指向已删除chunk的死引用
- 统计并报告修复的posting数量

### 4. 孤立引用清理 (`cleanupOrphanedChunkRefs`)

- 检测所有被引用但实际上已不存在的chunk
- 从索引中移除这些孤立引用
- 确保查询时不会访问到无效数据

## 修复后的优化流程

```
开始优化
    ↓
执行优化前一致性检查
    ↓
合并小块 (mergeSmallBlocks)
    ↓
重建倒排索引 (rebuildInvertedIndex)
    ├── 遍历所有label组合
    ├── 验证每个series的chunk引用
    ├── 过滤掉无有效chunk的series
    └── 统计修复的posting数
    ↓
清理孤立引用 (cleanupOrphanedChunkRefs)
    ├── 追踪所有chunk引用
    ├── 检测已不存在的chunk引用
    └── 从索引中清除孤立引用
    ↓
执行优化后一致性检查
    ↓
生成对比报告
    ↓
结束
```

## 新增数据结构

### OptimizationResult 扩展
```go
type OptimizationResult struct {
    // ... 原有字段 ...
    ConsistencyCheck *ConsistencyCheckResult  // 一致性检查结果
}

type ConsistencyCheckResult struct {
    BeforeCheck  *ConsistencyMetrics  // 优化前指标
    AfterCheck   *ConsistencyMetrics  // 优化后指标
    IsConsistent bool                 // 是否最终一致
}
```

### OptimizationDetail 扩展
```go
type OptimizationDetail struct {
    Type          string
    Description   string
    BlocksMerged  int    // 合并的block数
    ChunksCleaned int    // 清理的chunk数
    PostingsFixed int    // 修复的posting数
}
```

## 使用方法

### CLI模式
```bash
# 执行优化并显示一致性检查
./prometheus-tsdb-manager optimize --data-dir /path/to/data

# Dry-run模式预览修复效果
./prometheus-tsdb-manager optimize --data-dir /path/to/data --dry-run
```

### API模式
```bash
# 执行优化
curl -X POST http://localhost:8080/api/v1/optimize \
  -H "Content-Type: application/json" \
  -d '{"dry_run": false}'
```

## 输出示例

```
--- CONSISTENCY CHECK RESULTS ---
  Before Optimization:
    Total Chunk Refs:    15420
    Valid Chunk Refs:    15235
    Orphaned Refs:       185
    Total Postings:      892
    Ref Count Errors:    12
  After Optimization:
    Total Chunk Refs:    15235
    Valid Chunk Refs:    15235
    Orphaned Refs:       0
    Total Postings:      876
    Ref Count Errors:    0
  Index Consistent:   true

--- PERFORMED OPTIMIZATIONS ---
 1. [merge_blocks] Triggered TSDB compaction to merge blocks
 2. [rebuild_index] Rebuilt inverted index with chunk reference validation (fixed 16 postings)
 3. [cleanup_orphaned_refs] Cleaned up 185 orphaned chunk references from postings
```

## 关键修复点总结

1. **线程安全的引用计数**：使用`sync.RWMutex`确保并发安全
2. **全量有效性验证**：每个chunk引用在使用前都经过验证
3. **渐进式清理**：在索引遍历过程中实时过滤无效引用
4. **前后一致性对比**：优化前后都执行完整的一致性检查
5. **详细报告**：精确统计修复的数量和类型

## 安全特性

- 所有操作都支持dry-run模式，可以预览修复效果
- 优化过程中不会删除原始数据，只清理索引引用
- 每次优化都包含完整的前后一致性检查
- 所有日志都记录修复的具体数量和类型
