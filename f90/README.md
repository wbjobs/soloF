# 实时交易异常检测监控系统

基于Apache Flink的实时交易流处理系统，实现三类异常检测：

1. **高频交易检测** - 1秒内完成超过5笔交易
2. **金额突增检测** - 交易金额超过历史90分位数的3倍
3. **跨地域登录检测** - 5分钟内从两个不同城市登录

## 技术栈

- **流处理**: Apache Flink 1.18
- **消息队列**: Apache Kafka 3.6
- **数据存储**: Redis 7 (滑动窗口统计)
- **后端框架**: Spring Boot 2.7
- **前端展示**: ECharts 5.4
- **实时推送**: WebSocket

## 项目结构

```
fraud-detection/
├── flink-job/              # Flink流处理作业
│   └── src/main/java/com/fraud/
│       ├── FraudDetectionJob.java       # 主作业入口
│       ├── model/                      # 数据模型
│       ├── detector/                   # 异常检测器
│       │   ├── HighFrequencyDetector.java
│       │   ├── SuddenAmountIncreaseDetector.java
│       │   └── CrossRegionLoginDetector.java
│       └── sink/
│           └── RedisAlertSink.java
├── kafka-simulator/       # Kafka交易数据模拟器
├── backend/             # Spring Boot后端服务
│   └── src/main/java/com/backend/
│       ├── config/                    # 配置类
│       ├── controller/              # REST API
│       ├── model/                  # 数据模型
│       ├── service/              # 业务服务
│       └── websocket/                 # WebSocket推送
├── frontend/            # 前端页面 (ECharts)
├── docker-compose.yml    # Docker一键部署
└── nginx.conf       # Nginx配置
```

## 快速开始

### 1. 使用Docker Compose一键部署

```bash
docker-compose up -d
```

访问 `http://localhost` 查看监控面板

### 2. 本地运行

#### 前置条件
- JDK 11+
- Maven 3.6+
- Apache Kafka
- Redis 7+
- Apache Flink 1.18

#### 启动步骤

1. **启动Kafka和Redis

```bash
# 启动Zookeeper和Kafka
# 启动Redis
```

2. **创建Kafka主题

```bash
kafka-topics.sh --create --topic transactions --bootstrap-server localhost:9092
```

3. **编译并运行Flink作业

```bash
cd flink-job
mvn clean package
# 提交到Flink集群
```

4. **启动Kafka数据模拟器

```bash
cd kafka-simulator
mvn clean package
java -jar target/kafka-simulator-1.0.0.jar localhost:9092 transactions 600000 10
```

5. **启动后端服务

```bash
cd backend
mvn spring-boot:run
```

6. **访问前端页面

打开 `frontend/index.html`

## 核心功能说明

### 三类异常检测逻辑

1. **高频交易检测 (HighFrequencyDetector)
- 滑动窗口: 1秒
- 阈值: > 5笔/秒
- 使用Flink状态保存窗口内的交易数量

2. **金额突增检测 (SuddenAmountIncreaseDetector)
- 历史窗口: 最近100笔交易
- 阈值: 当前金额 > 历史90分位数 × 3
- 使用滑动窗口维护用户历录历史交易金额

3. **跨地域登录检测 (CrossRegionLoginDetector)
- 时间窗口: 5分钟
- 检测: 同一用户在不同城市交易
- 逻辑: 5分钟内记录最近的50笔交易

### Redis数据结构

- `alert:{alertId}` - 告警详情
- `user:alerts:{userId}` - 用户告警列表
- `alerts:recent` - 最近告警列表
- `user:alert:count` - 用户告警计数(Sorted Set)
- `alert:rate:{timestamp}` - 每分钟告警数
- `transaction:count:{timestamp}` - 每分钟交易数
- `alert:type:{type}` - 各类型告警计数

### API接口

- `GET /api/statistics` - 获取统计数据
- `GET /api/alerts/recent?count=20` - 获取最近告警
- `GET /api/alerts/top-users?limit=10` - 获取Top 10异常用户
- `GET /api/alerts/rate-history?minutes=30` - 获取异常率历史
- `GET /api/users/{userId}/alerts` - 获取用户告警记录
- `GET /api/health` - 健康检查

### WebSocket

- `ws://localhost:8080/ws/alerts` - 实时数据推送

## 监控面板功能

- **总告警数** - 累计告警总数
- **当前异常率** - 当前分钟异常率
- **活跃用户数** - 有告警的用户数
- **今日告警数/分钟** - 每分钟告警数
- **ML模型版本** - 当前加载的ML模型版本
- **异常率趋势** - 近30分钟异常率曲线
- **Top 10异常用户** - 告警次数最多的用户
- **异常类型分布** - 四类异常占比
- **最近告警** - 实时告警列表

## 机器学习功能详解

### 特征工程 (FeatureExtractor)

从每笔交易中提取28维特征：

1. **金额特征** (4维):
   - 交易金额
   - 对数金额
   - 金额Z-score标准化（相对于历史均值和标准差）
   - 金额倍数（相对于历史均值）

2. **近期对比特征** (2维):
   - 金额/近期均值
   - 金额/近期最大值

3. **时间特征** (8维):
   - 小时、分钟、星期几、几号、月份
   - 是否周末、是否夜间、是否工作时间

4. **类别特征编码** (3维):
   - 城市编码
   - 支付方式编码
   - 商户编码

5. **用户行为特征** (11维):
   - 总交易次数、去过的城市数、使用的商户数
   - 距上次交易时间(秒)
   - 是否同城市、同商户、同支付方式
   - 近1小时交易数、近1天交易数
   - 当前小时速率/平均小时速率
   - 交易频率、金额速率

### 隔离森林算法 (Isolation Forest)

**算法原理**:
- 通过随机选择特征和切分点来"隔离"异常样本
- 异常样本距离根节点更近，路径更短
- 异常评分 = 2^(-平均路径长度/预期路径长度)
- 评分范围 [0, 1]，越接近1表示越异常

**模型参数**:
- 树数量: 100棵
- 采样大小: 256样本/棵树
- 异常阈值: 0.7 (可动态调整)

### 在线增量训练流程

```
人工标注样本 → Redis训练队列 → ModelUpdateService(每10分钟) 
    → 增量训练 → 保存新版本模型 → Redis广播 
    → Flink广播流 → 所有TaskManager更新本地模型
```

**增量训练策略**:
- 每次最多处理1000个新样本
- 替换10%的决策树（引入新样本的多样性）
- 最小样本数要求: 至少10个新样本才触发更新
- 动态阈值调整: 根据最近标注样本的95分位数自动调整

### 人工标注样本API示例

```bash
# 标注一个样本为异常
curl -X POST http://localhost:8080/api/ml/samples/label \
  -H "Content-Type: application/json" \
  -d '{
    "transactionId": "TX-1234567890",
    "userId": "USER-00001",
    "isAnomaly": true,
    "annotator": "admin",
    "notes": "夜间大额异常交易",
    "transactionData": {
      "amount": 50000,
      "city": "北京",
      "timestamp": "2026-05-26T02:30:00",
      "paymentMethod": "信用卡",
      "merchant": "奢侈品店"
    }
  }'

# 触发模型重训练
curl -X POST http://localhost:8080/api/ml/model/retrain

# 获取模型信息
curl http://localhost:8080/api/ml/model/info
```

## 性能优化

### 吞吐量优化（支持10万+ TPS）

1. **状态管理优化**:
   - 高频检测: MapState<秒级时间戳, 计数> 替代ListState<Transaction>
   - 金额检测: 直方图近似分位数算法替代全量排序
   - 跨地域检测: 轻量LocationRecord替代完整Transaction
   - 状态大小减少95%以上

2. **Checkpoint优化**:
   - RocksDB状态后端 + 增量Checkpoint
   - 非对齐Checkpoint (Unaligned Checkpoint)
   - Checkpoint间隔120秒，超时5分钟
   - 容忍3次Checkpoint失败

3. **Sink优化**:
   - Redis Pipeline批量写入
   - 50条或1秒自动刷新
   - 连接池优化

4. **网络优化**:
   - TaskManager网络内存 128MB ~ 1GB
   - 缓冲区超时 100ms

## 许可证

MIT License
