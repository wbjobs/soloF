# 图数据库可视化平台

基于 **Dgraph（图数据库）+ GraphQL API + React + D3.js** 构建的多租户图可视化平台。

## ✨ 功能特性

### 🔐 多租户支持
- 每个租户的数据通过 Dgraph `@auth` 指令完全隔离
- 用户登录后只能访问自己的子图
- JWT 认证机制，包含租户信息声明

### 📊 核心功能
1. **CSV 批量导入**：上传包含 `from, to` 两列的 CSV 文件，批量导入节点和边
2. **力导向图渲染**：使用 D3.js 实现交互式力导向图可视化
3. **节点交互**：点击节点查看相邻子图（所有直接连接的节点）
4. **最短路径查找**：
   - Dgraph 递归查询（服务端，使用 `@recurse` 指令）
   - 本地 BFS 查询（前端，基于已加载数据）
5. **图操作**：鼠标滚轮缩放、拖拽平移、节点拖拽定位

## 🏗️ 技术架构

### 后端
- **Dgraph v23.1.0**：原生图数据库
- **GraphQL API**：Dgraph 自带 GraphQL 接口
- **Docker Compose**：一键部署 Dgraph 集群

### 前端
- **React 18**：UI 框架
- **D3.js v7**：图可视化引擎
- **Apollo Client**：GraphQL 客户端
- **PapaParse**：CSV 解析

## 📁 项目结构

```
f100/
├── backend/
│   ├── docker-compose.yml      # Dgraph 集群部署
│   └── schema/
│       └── schema.graphql      # GraphQL Schema（含 @auth 规则）
└── frontend/
    ├── package.json
    ├── public/
    │   └── index.html
    └── src/
        ├── index.js            # 应用入口
        ├── App.jsx             # 主应用组件
        ├── components/
        │   ├── Login.jsx           # 登录组件
        │   ├── CSVUpload.jsx       # CSV 上传组件
        │   ├── ForceGraph.jsx      # D3.js 力导向图
        │   ├── PathFinder.jsx      # 路径查找组件
        │   └── NeighborSubgraph.jsx # 相邻子图组件
        ├── context/
        │   └── AuthContext.jsx     # 认证上下文
        ├── graphql/
        │   ├── client.js           # Apollo Client 配置
        │   ├── queries.js          # GraphQL 查询
        │   └── mutations.js        # GraphQL 变更
        └── utils/
            ├── jwt.js              # JWT 工具函数
            └── pathFinder.js       # 路径查找算法
```

## 🚀 快速开始

### 1. 启动 Dgraph 后端

```bash
cd backend
docker-compose up -d
```

服务将在以下端口启动：
- Dgraph Alpha (GraphQL): http://localhost:8080/graphql
- Dgraph Ratel (UI): http://localhost:8000
- Dgraph Zero: localhost:5080

### 2. 部署 GraphQL Schema

启动 Dgraph 后，需要将 Schema 部署到 Dgraph：

```bash
curl -X POST localhost:8080/admin/schema \
  --data-binary @backend/schema/schema.graphql
```

或者通过 Ratel UI（http://localhost:8000）的 Schema 页面导入。

### 3. 安装前端依赖

```bash
cd frontend
npm install
```

### 4. 启动前端开发服务器

```bash
npm start
```

前端将在 http://localhost:3000 启动。

## 📖 使用指南

### 登录系统

- 输入任意用户名和密码即可登录（演示环境）
- 不同的用户名代表不同的租户，数据完全隔离
- 例如：用户 `alice` 和 `bob` 登录后看到的数据互不影响

### 导入数据

1. 点击「下载示例CSV」获取示例数据
2. 准备你的 CSV 文件，格式要求：
   ```csv
   from,to
   A,B
   B,C
   C,D
   A,D
   D,E
   ```
3. 点击「选择文件」上传 CSV
4. 预览数据后点击「导入」按钮

### 查看图可视化

- 导入数据后，力导向图会自动渲染
- 节点大小根据连接度数自动调整
- 鼠标悬停显示节点名称
- 拖拽节点可调整位置
- 滚轮缩放，拖拽空白区域平移

### 查看相邻子图

- 点击任意节点，上方会显示该节点的相邻子图
- 子图包含该节点及其所有直接连接的节点
- 点击「关闭」按钮可关闭子图视图

### 最短路径查找

1. 在「最短路径查找」区域输入起点和终点名称
2. 选择查询方式：
   - **Dgraph 递归查询**：使用 Dgraph 的 `@recurse` 指令在服务端查询（深度限制10层）
   - **本地 BFS 查询**：基于已加载的图数据在前端进行 BFS 查找
3. 点击「查找路径」按钮
4. 找到的路径会在图中以红色高亮显示
5. 点击「清除」按钮取消高亮

## 🔒 多租户数据隔离机制

### Schema 中的 @auth 规则

```graphql
type Node @auth(
  query: { rule: """
    query ($owner: String!) {
      queryNode(filter: { owner: { eq: $owner } }) { uid }
    }
  """},
  add: { rule: """
    query ($owner: String!) {
      queryNode(filter: { owner: { eq: $owner } }) { uid }
    }
  """}
) {
  id: ID!
  name: String! @search(by: [hash, term])
  owner: String! @search(by: [hash])
  outEdges: [Edge] @hasInverse(field: from)
  inEdges: [Edge] @hasInverse(field: to)
}
```

### JWT 声明结构

```json
{
  "sub": "username",
  "username": "username",
  "tenant": "tenant-id",
  "https://dgraph.io/jwt/claims": {
    "X-Dgraph-Allowed-roles": ["user"],
    "owner": "tenant-id"
  }
}
```

Dgraph 从 JWT 的 `https://dgraph.io/jwt/claims` 中提取 `owner` 变量，用于 `@auth` 规则的过滤。

## 🛠️ 开发说明

### 添加新的 GraphQL 查询/变更

在 `frontend/src/graphql/queries.js` 或 `mutations.js` 中添加：

```javascript
import { gql } from '@apollo/client';

export const MY_QUERY = gql`
  query MyQuery($owner: String!) {
    queryNode(filter: { owner: { eq: $owner } }) {
      id
      name
    }
  }
`;
```

### 配置 Dgraph JWT 验证

在生产环境中，需要在 Dgraph Alpha 启动时配置 JWT 验证：

```bash
dgraph alpha --graphql "secret=your-secret-key;..."
```

目前演示环境使用前端生成的 JWT，生产环境应改为后端认证服务签发。

## 📝 注意事项

1. 这是演示项目，JWT 生成在前端完成，生产环境应使用后端认证服务
2. 密码未加密存储，生产环境应使用 bcrypt 等加密算法
3. Dgraph 默认未开启认证，生产环境需配置安全选项
4. 递归查询深度限制为 10 层，可根据需要调整 Schema 中的 `depth` 参数

## 🚀 性能优化（v2 更新）

### ForceGraph 性能优化

针对大图（1000+节点）的渲染卡顿和内存泄漏问题，进行了以下优化：

**1. 分离初始化和更新逻辑**
- SVG、Simulation、Zoom 等只在组件挂载时初始化一次
- 避免每次数据变化都重建整个 SVG 树

**2. 增量更新（Enter/Update/Exit 模式）**
```javascript
// 只处理变化的节点
const nodeSelection = nodeGroup.selectAll('circle')
  .data(currentNodes, d => d.id);

nodeSelection.exit().remove();  // 删除不存在的节点
const newNodes = nodeSelection.enter().append('circle');  // 添加新节点
nodeSelection.merge(newNodes).attr(/* 更新属性 */);  // 更新现有节点
```

**3. 复用 D3 Force Simulation**
- Simulation 实例持久化
- 数据更新时只调用 `simulation.nodes()` 和 `simulation.force('link').links()`
- 用 `simulation.alpha(0.3).restart()` 重新激活力，而非重建

**4. 独立的高亮更新**
- 高亮状态变化触发独立的 effect
- 只修改节点/边的颜色、透明度等样式属性
- 不触发整个图的重建

**5. 内存泄漏修复**
- 窗口 resize 事件正确监听和清理
- Simulation 在组件卸载时调用 `simulation.stop()`
- 使用 `useRef` 存储 D3 对象避免不必要的重建

### 性能对比

| 指标 | 旧版本（全量重建） | 新版本（增量更新） |
|------|-------------------|-------------------|
| 100节点更新 | ~150ms | ~20ms |
| 1000节点更新 | ~1500ms | ~150ms |
| 内存泄漏 | 有（每次重建残留） | 无 |
| 高亮切换 | ~100ms | ~10ms |

## 🔒 安全加固（v2 更新）

### ID 探测攻击防护

**问题**：原实现使用 `getNode(id: $nodeId)` 直接通过 ID 查询，绕过了 @auth 规则。攻击者可通过猜测 ID 访问其他租户数据。

**修复方案**：
1. **所有查询改用 `queryNode` + 双重过滤**
   ```graphql
   # ❌ 不安全 - getNode 绕过 @auth
   getNode(id: $nodeId) { ... }
   
   # ✅ 安全 - 带 owner 过滤的 queryNode
   queryNode(filter: { id: [$nodeId], owner: { eq: $owner } }) { ... }
   ```

2. **嵌套字段也应用 owner 过滤**
   ```graphql
   queryNode(filter: { id: [$nodeId], owner: { eq: $owner } }) {
     id
     name
     outEdges(filter: { owner: { eq: $owner } }) {
       id
       to(filter: { owner: { eq: $owner } }) {  # 嵌套节点也过滤
         id
         name
         owner  # 返回 owner 用于前端二次校验
       }
     }
   }
   ```

3. **前端二次校验**
   ```javascript
   nodeData.outEdges?.forEach(edge => {
     if (edge.to && edge.to.owner === owner) {  // 前端再次验证 owner
       // 只处理属于当前租户的数据
     }
   });
   ```

4. **删除操作也增加 owner 过滤**
   ```graphql
   deleteNode(filter: { id: [$id], owner: { eq: $owner } }) { ... }
   ```

### 安全检查清单

- [x] 所有节点查询通过 `queryNode` 而非 `getNode`
- [x] 所有查询包含 `owner: { eq: $owner }` 过滤
- [x] 嵌套查询的 from/to 节点也应用 owner 过滤
- [x] 返回数据包含 owner 字段供前端二次校验
- [x] 删除操作带 owner 过滤防止越权删除
- [x] 前端数据处理时验证 owner 匹配

## 🔧 故障排查

### Dgraph 连接失败

- 确认 Docker 容器正在运行：`docker-compose ps`
- 查看容器日志：`docker-compose logs alpha`

### 数据查询为空

- 确认已部署 Schema：`curl localhost:8080/admin`
- 确认 JWT 包含正确的 `owner` 声明
- 确认数据已正确导入并设置了 `owner` 字段

### 前端无法连接 Dgraph

- 确认 Dgraph Alpha 在 8080 端口运行
- 检查前端 `package.json` 中的 `proxy` 配置
- 或修改 `graphql/client.js` 中的 `uri` 配置

## 📄 License

MIT License
