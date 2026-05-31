# 技术知识图谱系统

一个完整的技术知识图谱系统，使用 Go 语言 Colly 框架进行分布式爬虫，Neo4j 图数据库存储，gqlgen 构建 GraphQL API，React + react-force-graph-3d 实现 3D 可视化。

## 系统架构

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Colly 爬虫     │────▶│   Neo4j 数据库   │◀────│  GraphQL API    │
│  (分布式爬取)    │     │  (图存储)        │     │  (gqlgen)       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
                                                  ┌─────────────────┐
                                                  │  React 前端     │
                                                  │  3D 知识图谱    │
                                                  └─────────────────┘
```

## 技术栈

### 后端
- **Go 1.21** - 主编程语言
- **Colly v2** - 分布式爬虫框架
- **Neo4j Go Driver v5** - Neo4j 数据库驱动
- **gqlgen** - GraphQL 代码生成器
- **CORS** - 跨域支持

### 前端
- **React 18** - UI 框架
- **react-force-graph-3d** - 3D 力导向图可视化
- **Three.js** - 3D 渲染引擎
- **Ant Design** - UI 组件库
- **Apollo Client** - GraphQL 客户端

### 数据库
- **Neo4j 5.12** - 图数据库

## 项目结构

```
.
├── crawler/                 # 爬虫模块
│   ├── main.go             # 爬虫入口
│   ├── models.go           # 数据模型
│   ├── neo4j_store.go      # Neo4j 存储
│   ├── extractor.go        # 技术名词提取器
│   ├── Dockerfile          # Docker 配置
│   └── go.mod              # 依赖管理
├── graphql-server/          # GraphQL API 服务
│   ├── server.go           # 服务器入口
│   ├── graph/
│   │   ├── schema.graphqls # GraphQL Schema
│   │   ├── resolver.go     # 解析器
│   │   ├── neo4j_store.go  # 数据访问层
│   │   ├── model/          # 生成的模型
│   │   └── generated/      # 生成的代码
│   ├── gqlgen.yml          # gqlgen 配置
│   ├── Dockerfile          # Docker 配置
│   └── go.mod              # 依赖管理
├── frontend/               # 前端应用
│   ├── src/
│   │   ├── App.js          # 主应用组件
│   │   ├── index.js        # 入口文件
│   │   └── components/
│   │       ├── KnowledgeGraph.js  # 3D 图谱组件
│   │       ├── StatsPanel.js      # 统计面板
│   │       └── SearchPanel.js     # 搜索面板
│   ├── public/             # 静态资源
│   ├── Dockerfile          # Docker 配置
│   └── package.json        # 依赖管理
├── neo4j/                  # Neo4j 数据目录
├── docker-compose.yml      # Docker 编排
└── .env.example            # 环境变量示例
```

## 快速开始

### 方式一：使用 Docker Compose（推荐）

1. 克隆项目并进入目录：
```bash
cd f78
```

2. 复制环境变量文件：
```bash
cp .env.example .env
```

3. 启动所有服务：
```bash
docker-compose up -d
```

4. 查看服务状态：
```bash
docker-compose ps
```

5. 访问应用：
   - 前端: http://localhost:3000
   - GraphQL Playground: http://localhost:8080
   - Neo4j Browser: http://localhost:7474 (用户名: neo4j, 密码: password123)

### 方式二：本地开发

#### 1. 启动 Neo4j
```bash
docker run -d \
  --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password123 \
  neo4j:5.12-community
```

#### 2. 启动 GraphQL 服务
```bash
cd graphql-server
go mod tidy
go run server.go
```

#### 3. 运行爬虫
```bash
cd crawler
go mod tidy
go run .
```

#### 4. 启动前端
```bash
cd frontend
npm install
npm start
```

## 核心功能

### 1. 分布式爬虫 (Colly)
- 异步并发爬取技术文档网站
- 自动提取技术名词和引用关系
- 支持自定义爬取深度和并发数
- 自动去重和错误处理

### 2. 图数据库 (Neo4j)
- 节点类型：`Document`（文档）、`TechTerm`（技术名词）
- 关系类型：`REFERENCES`（文档引用）、`CONTAINS_TERM`（包含技术名词）
- 支持技术名词分类（编程语言、框架、数据库、概念等）

### 3. GraphQL API (gqlgen)
查询接口：
- `documents` - 获取所有文档
- `document(url)` - 获取单个文档详情
- `techTerms` - 获取所有技术名词
- `techTerm(name)` - 获取单个技术名词
- `graphData(limit)` - 获取图谱数据（用于可视化）
- `search(query, limit)` - 搜索文档和名词
- `stats` - 获取统计信息

变更接口：
- `triggerCrawl(url, maxDepth)` - 触发爬虫任务
- `clearDatabase` - 清空数据库

### 4. 3D 知识图谱可视化
- 基于 Three.js 的 3D 力导向图
- 节点按分类着色
- 节点大小反映出现频率
- 支持缩放、旋转、拖拽交互
- 点击节点查看详情

## GraphQL 查询示例

### 获取统计信息
```graphql
query {
  stats {
    documentCount
    techTermCount
    relationshipCount
    topTerms {
      name
      count
      category
    }
  }
}
```

### 获取图谱数据
```graphql
query {
  graphData(limit: 100) {
    nodes {
      id
      name
      category
      val
    }
    links {
      source
      target
      name
    }
  }
}
```

### 搜索
```graphql
query {
  search(query: "Go", limit: 20) {
    id
    name
    type
    category
  }
}
```

## 配置说明

### 爬虫配置
- `CRAWLER_START_URL` - 爬取起始 URL
- `CRAWLER_MAX_DEPTH` - 最大爬取深度
- `CRAWLER_CONCURRENCY` - 并发请求数

### 数据库配置
- `NEO4J_URI` - Neo4j 连接地址
- `NEO4J_USER` - 用户名
- `NEO4J_PASSWORD` - 密码

## 自定义扩展

### 添加新的技术名词分类
修改 `crawler/extractor.go` 中的正则表达式模式。

### 自定义爬取规则
修改 `crawler/main.go` 中的 Colly 回调函数。

### 扩展 GraphQL Schema
编辑 `graphql-server/graph/schema.graphqls`，然后运行：
```bash
cd graphql-server
go run github.com/99designs/gqlgen generate
```

## 性能优化建议

1. **Neo4j 索引**：为常用查询字段创建索引
```cypher
CREATE INDEX FOR (d:Document) ON (d.url)
CREATE INDEX FOR (t:TechTerm) ON (t.name)
```

2. **爬虫限速**：根据目标网站调整并发数和请求间隔
3. **数据分页**：大量数据时使用分页查询
4. **缓存策略**：对热点查询结果进行缓存

## 常见问题

### Q: 爬虫无法访问某些网站？
A: 可能被反爬策略拦截，可以尝试：
- 设置合理的 User-Agent
- 添加请求间隔
- 使用代理 IP 池

### Q: Neo4j 连接失败？
A: 检查：
- Neo4j 服务是否启动
- 连接地址和端口是否正确
- 用户名密码是否匹配

### Q: 前端 3D 图表卡顿？
A: 可以：
- 减少显示的节点数量（调整 limit 参数）
- 禁用节点发光效果
- 使用性能更好的设备

## 许可证

MIT License
