# 书籍转化率实时监控系统

基于Apache Flink + Spring Boot + React的实时数据分析系统

## 系统架构

```
Kafka (book_behavior主题)
    ↓
Flink实时计算
    ↓
Redis (存储计算结果)
    ↓
Spring Boot API服务
    ↓
React前端 (ECharts可视化)
```

## 环境要求

- JDK 11+
- Maven 3.6+
- Node.js 16+
- Apache Kafka 2.8+
- Redis 5.0+
- Apache Flink 1.17+

## 快速开始

### 1. 启动基础服务

确保Kafka和Redis已启动：

```bash
# 启动Zookeeper
bin/zookeeper-server-start.sh config/zookeeper.properties

# 启动Kafka
bin/kafka-server-start.sh config/server.properties

# 创建Kafka主题
bin/kafka-topics.sh --create --topic book_behavior --bootstrap-server localhost:9092 --partitions 1 --replication-factor 1

# 启动Redis
redis-server
```

### 2. 构建并启动Flink作业

```bash
cd flink-module
mvn clean package

# 提交到Flink集群 或 本地运行
java -cp target/flink-module-1.0.0.jar com.bookanalytics.flink.BookConversionJob
```

### 3. 启动Spring Boot API服务

```bash
cd spring-boot-api
mvn spring-boot:run
```

API服务将在 http://localhost:8080 启动

### 4. 启动React前端

```bash
cd react-frontend
npm install
npm start
```

前端将在 http://localhost:3000 启动

## API接口说明

### 1. 获取单本书转化率

```
GET /api/book/{isbn}/conversion

响应示例:
{
  "isbn": "978-7-111-54493-7",
  "viewCount": 100,
  "buyCount": 15,
  "conversionRate": 0.15,
  "lastUpdate": 1699999999999
}
```

### 2. 获取转化率Top10书籍

```
GET /api/book/top10

响应示例:
[
  {
    "isbn": "978-7-111-54493-7",
    "viewCount": 100,
    "buyCount": 25,
    "conversionRate": 0.25,
    "lastUpdate": 1699999999999
  }
]
```

### 3. 获取所有书籍转化率

```
GET /api/book/all
```

## 测试数据生成

向Kafka的`book_behavior`主题发送数据：

格式（CSV）:
```
用户ID,书籍ISBN,行为类型(view/buy),时间戳
```

示例:
```
user001,978-7-111-54493-7,view,1699999999000
user002,978-7-111-54493-7,buy,1699999999001
user003,978-7-111-54494-4,view,1699999999002
```

使用Kafka控制台生产者发送测试数据：
```bash
bin/kafka-console-producer.sh --topic book_behavior --bootstrap-server localhost:9092
```

## 项目结构

```
book-conversion-analytics/
├── flink-module/                 # Flink实时计算模块
│   ├── src/main/java/com/bookanalytics/flink/
│   │   ├── BookConversionJob.java    # Flink主作业
│   │   ├── model/                     # 数据模型
│   │   └── ...
│   └── pom.xml
├── spring-boot-api/              # Spring Boot API服务
│   ├── src/main/java/com/bookanalytics/api/
│   │   ├── controller/               # 控制器
│   │   ├── service/                  # 服务层
│   │   ├── model/                    # 数据模型
│   │   ├── config/                   # 配置
│   │   └── ApiApplication.java
│   └── pom.xml
├── react-frontend/               # React前端
│   ├── src/
│   │   ├── components/               # 图表组件
│   │   │   ├── Top10BarChart.js      # Top10柱状图
│   │   │   └── RealTimeLineChart.js  # 实时折线图
│   │   ├── App.js
│   │   └── index.js
│   └── package.json
└── pom.xml                       # 父项目POM
```

## 功能特性

- ✅ 实时消费Kafka中的用户行为数据
- ✅ 实时计算每本书的浏览-购买转化率
- ✅ 计算结果存储到Redis
- ✅ RESTful API接口提供数据查询
- ✅ Top10转化率书籍柱状图展示
- ✅ 实时转化率变化趋势折线图
- ✅ 前端每5秒自动刷新数据

## 注意事项

1. 确保Kafka和Redis服务正常运行
2. Flink作业需要足够的资源
3. 生产环境中建议使用Flink集群部署
4. 前端开发模式下会自动代理API请求到8080端口
