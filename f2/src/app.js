require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');

const config = require('./config');
const { sequelize } = require('./models');
const dataCollector = require('./services/dataCollector');
const websocketServer = require('./services/websocketServer');

const devicesRouter = require('./routes/devices');
const dataRouter = require('./routes/data');
const predictionRouter = require('./routes/prediction');
const faultsRouter = require('./routes/faults');

const app = express();
const server = http.createServer(app);

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined')));

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: '服务运行正常',
    timestamp: new Date(),
    version: '1.0.0'
  });
});

app.use('/api/devices', devicesRouter);
app.use('/api/data', dataRouter);
app.use('/api/prediction', predictionRouter);
app.use('/api/faults', faultsRouter);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: '接口不存在'
  });
});

app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    success: false,
    message: '服务器内部错误',
    error: config.nodeEnv === 'development' ? err.message : undefined
  });
});

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('数据库连接成功');

    await sequelize.sync({ alter: config.nodeEnv === 'development' });
    console.log('数据库模型同步完成');

    websocketServer.start(server);

    await dataCollector.start();

    server.listen(config.port, () => {
      console.log(`
=============================================
🚀 Modbus PLC 监控服务已启动
📡 HTTP 服务端口: ${config.port}
🔧 WebSocket 服务已启用
⚙️  环境: ${config.nodeEnv}
📅 数据保留天数: ${config.dataRetentionDays}天
🎯 最大设备连接数: ${config.maxDevices}
⏱️  默认轮询间隔: 2000ms
=============================================
      `);
    });

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    console.error('启动服务器失败:', error);
    process.exit(1);
  }
}

async function gracefulShutdown() {
  console.log('\n正在关闭服务器...');

  try {
    await dataCollector.stop();
    websocketServer.stop();
    
    await sequelize.close();
    console.log('数据库连接已关闭');

    server.close(() => {
      console.log('HTTP 服务器已关闭');
      console.log('服务器已安全关闭');
      process.exit(0);
    });
  } catch (error) {
    console.error('关闭服务器时出错:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
