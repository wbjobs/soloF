# GraphQL Federation Gateway with Query Analysis

Apollo Federation 网关服务，集成了实时查询分析、N+1问题检测、慢查询监控和自动索引推荐功能。

## 功能特性

- 🚀 **Apollo Federation v2** - 微服务架构的GraphQL联邦
- 🔍 **实时查询分析** - 自动检测N+1查询问题
- ⚡ **慢查询监控** - 追踪超过500ms的查询
- 📊 **pg_stat_statements集成** - 基于PostgreSQL查询指纹分析
- 💡 **自动索引推荐** - 智能推荐CREATE INDEX语句
- 📈 **ClickHouse分析** - 查询日志存储和趋势分析
- 🔧 **管理API** - 查看慢查询、索引推荐历史、性能评估

## 服务架构

```
┌─────────────────────────────────────────────────────────┐
│                    Apollo Gateway (4000)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │Query Analysis│  │ Index Recomm.│  │ClickHouse Log│  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└──────────────────────────────────────┬──────────────────────┘
                                     │
        ┌─────────────────────┬────────┴────────┐
        ▼                     ▼                  ▼
┌───────────────┐    ┌───────────────┐  ┌───────────────┐
│ Users Service │    │ Orders Service│  │Products Service│
│   (Port 4001)  │    │   (Port 4002)│  │  (Port 4003)  │
└────────┬───────┘    └────────┬───────┘  └────────┬───────┘
         │                        │                   │
         ▼                        ▼                   ▼
  ┌─────────────┐          ┌─────────────┐   ┌─────────────┐
  │ PostgreSQL  │          │ PostgreSQL  │   │ PostgreSQL  │
  │   (Port     │          │   (Port     │   │   (Port     │
  │    5433)    │          │    5434)    │   │    5435)    │
  └─────────────┘          └─────────────┘   └─────────────┘

                    ┌─────────────┐
                    │ ClickHouse  │
                    │ (Port 8123)│
                    └─────────────┘
```

## 快速开始

### 使用Docker Compose启动

```bash
# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止所有服务
docker-compose down
```

### 本地开发

```bash
# 安装依赖
npm install

# 启动各个服务（需要先启动PostgreSQL和ClickHouse）
npm run start:users
npm run start:orders
npm run start:products
npm run start:gateway
```

## 访问地址

- **GraphQL Gateway**: http://localhost:4000/graphql
- **管理API**: http://localhost:4000/api

## 管理API端点

### 健康检查
```
GET /api/health
```

### 慢查询
```
GET /api/slow-queries?limit=50&type=N%2B1
GET /api/slow-queries/:hash
```

### 索引推荐
```
GET /api/index-recommendations?confidence=HIGH
POST /api/index-recommendations/:id/apply
GET /api/index-recommendations/evaluation
```

### PostgreSQL统计
```
GET /api/postgres/stats/users
GET /api/postgres/stats/orders
GET /api/postgres/stats/products
```

### 分析趋势
```
GET /api/analytics/trends?hours=24
```

### 仪表板
```
GET /api/dashboard
```

## 核心功能详解

### 1. N+1问题检测

系统自动分析查询结构和响应数据，检测潜在的N+1查询模式：

- 嵌套列表检测
- 查询结构分析
- 字段模式识别

### 2. 慢查询分析

- 超过500ms的查询自动记录
- 基于查询指纹的模式分析
- 调用频率和性能统计

### 3. 索引推荐引擎

基于pg_stat_statements和启发式分析：

```javascript
// 示例推荐
{
  "id": "idx_rec_123456789",
  "tableName": "users",
  "columns": ["email", "name"],
  "indexType": "COMPOSITE_BTREE",
  "createStatement": "CREATE INDEX CONCURRENTLY idx_users_email_name ON users (email, name)",
  "confidence": "HIGH",
  "expectedImprovement": {
    "percentage": 75,
    "description": "Estimated 75% improvement in query execution time"
  }
}
```

### 4. ClickHouse集成

查询日志存储在ClickHouse中，支持：

- 小时级查询趋势分析
- 热门慢查询排名
- 性能指标时间序列

## 性能评估

索引推荐的评估报告包括：

- 预期性能提升百分比
- 按表分组的推荐统计
- 高影响力推荐列表
- 整体系统优化建议

## 示例GraphQL查询

```graphql
# 查询用户及其订单
query GetUserWithOrders($userId: ID!) {
  user(id: $userId) {
    id
    name
    email
    orders {
      id
      status
      total
      items {
        product {
          name
          price
        }
        quantity
      }
    }
  }
}

# 搜索产品
query SearchProducts($query: String!) {
  searchProducts(query: $query) {
    id
    name
    price
    category
  }
}
```

## 配置说明

### 环境变量

参考 `.env.example` 文件配置环境变量。

### PostgreSQL扩展

系统自动启用以下扩展：
- `pg_stat_statements` - 查询统计

### ClickHouse表结构

自动创建以下表：
- `query_logs` - 查询日志
- `index_recommendations` - 索引推荐历史

## 监控和调试

### 查看慢查询
```bash
curl http://localhost:4000/api/slow-queries
```

### 查看索引推荐
```bash
curl http://localhost:4000/api/index-recommendations
```

### 查看性能评估
```bash
curl http://localhost:4000/api/index-recommendations/evaluation
```

### 监控缓存预热
```bash
# 查看缓存统计和预热状态
curl http://localhost:4000/api/cache/stats

# 手动触发缓存预热
curl -X POST http://localhost:4000/api/cache/warmup \
  -H "Content-Type: application/json" \
  -d '{"topN": 10}'

# 查看预热历史
curl http://localhost:4000/api/cache/warmup-history

# 查看高频查询
curl http://localhost:4000/api/cache/top-queries?limit=10

# 查看数据更新频率
curl http://localhost:4000/api/cache/type-frequency
```

## 缓存预热工作流程

```
1. 查询模式收集
   ↓
2. Top 10高频查询识别（基于7天历史）
   ↓
3. 每日凌晨3:00定时触发预热任务
   ↓
4. 动态TTL计算（根据数据更新频率）
   ↓
5. Redis缓存预热执行
   ↓
6. 预热结果记录和指标统计
```

## 许可证

MIT
