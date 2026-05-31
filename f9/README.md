# Level-2 行情回放与策略回测平台

## 项目简介

这是一个专业的 Level-2 行情数据回放和算法交易策略回测平台，使用 React + ECharts 构建前端可视化界面，后端采用 FastAPI + Redis 架构。

## 功能特性

### 行情回放
- ✅ 实时 Tick 数据回放
- ✅ 可变速度播放 (1x - 100x)
- ✅ 十档买卖盘口实时更新
- ✅ 逐笔成交列表
- ✅ 分时走势图与成交量图
- ✅ 盘口深度图可视化

### 策略回测
- ✅ VWAP 算法交易策略
- ✅ 可配置参数（参与率、订单量范围等）
- ✅ 回测任务管理
- ✅ 盈亏曲线分析
- ✅ 滑点分析
- ✅ 绩效指标（胜率、夏普比率、最大回撤）

## 技术架构

### 前端
- **框架**: React 18 + TypeScript
- **构建工具**: Vite
- **UI组件**: Ant Design 5
- **图表库**: ECharts
- **状态管理**: Zustand

### 后端
- **Web框架**: FastAPI
- **数据处理**: Pandas + NumPy
- **WebSocket**: 实时行情推送
- **异步任务**: 内置 asyncio

## 快速开始

### 环境要求
- Node.js 18+
- Python 3.10+

### 启动后端
```bash
# Windows
start_backend.bat

# 或手动启动
cd backend
pip install -r requirements.txt
cd app
python main.py
```

后端服务将在 http://localhost:8000 启动

### 启动前端
```bash
# Windows
start_frontend.bat

# 或手动启动
cd frontend
npm install
npm run dev
```

前端服务将在 http://localhost:3000 启动

## 使用说明

### 行情回放
1. 打开 http://localhost:3000
2. 从股票选择器中选择一只股票（默认可选：600519.SH, 000001.SZ, 300750.SZ, 601318.SH, 000858.SZ）
3. 点击播放按钮开始回放
4. 拖动速度滑块调整播放速度 (1x - 100x)
5. 拖动时间轴跳转到指定时刻
6. 观察左侧盘口变化、中间价格走势和右侧成交明细

### 策略回测
1. 点击顶部导航栏的 "策略回测"
2. 在左侧配置 VWAP 参数：
   - 选择股票
   - 设置目标成交量（手）
   - 调整参与率（建议 0.05 - 0.2）
   - 设置最小/最大订单量
3. 点击 "提交回测任务"
4. 在任务列表中观察进度
5. 任务完成后点击 "查看结果" 查看详细分析

## API 接口

### 行情相关
- `GET /api/replay/symbols` - 获取可用股票列表
- `POST /api/replay/upload` - 上传 CSV 数据文件
- `WebSocket /api/replay/ws` - 实时行情推送

### 回测相关
- `POST /api/strategy/vwap` - 提交 VWAP 回测任务
- `GET /api/backtest/list` - 获取回测任务列表
- `GET /api/backtest/{task_id}` - 获取回测结果
- `GET /api/backtest/{task_id}/status` - 获取任务状态

## 数据格式

### CSV 数据格式
系统支持导入 CSV 格式的 Level-2 数据，需包含以下列：

| 字段 | 类型 | 说明 |
|------|------|------|
| timestamp | datetime | 时间戳 |
| symbol | string | 股票代码 |
| price | float | 成交价格 |
| volume | int | 成交量（手） |
| amount | float | 成交金额 |
| bs_flag | string | 买卖方向 ('B'=买, 'S'=卖) |

## 项目结构

```
project-root/
├── frontend/                 # React 前端
│   ├── src/
│   │   ├── components/      # 组件 (OrderBook, TickChart, 等)
│   │   ├── pages/           # 页面 (Replay, Backtest, Result)
│   │   ├── store/           # Zustand 状态管理
│   │   ├── services/        # API 服务
│   │   └── types/           # TypeScript 类型定义
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                  # FastAPI 后端
│   ├── app/
│   │   ├── engines/         # 核心引擎
│   │   │   ├── replay.py    # 行情回放引擎
│   │   │   └── vwap.py      # VWAP 策略引擎
│   │   └── main.py          # API 主入口
│   └── requirements.txt
│
└── data/                     # 数据目录
```

## 性能优化

- 内置采样数据生成，包含 5 只股票，每只 5-10 万条 Tick
- WebSocket 实时推送，支持高频率数据更新
- 前端虚拟滚动优化，处理大量成交数据
- ECharts 增量渲染，平滑动画

## 未来规划

- [ ] 更多策略类型（TWAP, POV, Sniper 等）
- [ ] Redis Streams 消息队列集成
- [ ] Celery 分布式任务
- [ ] TimescaleDB 时序数据存储
- [ ] 多周期 K 线图
- [ ] 策略参数优化
- [ ] 实盘对接接口
