const Modbus = require('jsmodbus');
const net = require('net');

class MockPlcServer {
  constructor(port = 502, unitId = 1) {
    this.port = port;
    this.unitId = unitId;
    this.holdingRegisters = new Array(100).fill(0);
    this.server = null;
    this.updateInterval = null;
    this.clients = [];
    this.disconnectInterval = null;
  }

  start() {
    this.server = new net.Server();
    
    const modbusServer = new Modbus.server.TCP(this.server, {
      holdingRegisters: this.holdingRegisters
    });

    this.server.on('connection', (socket) => {
      console.log(`✅ 客户端已连接: ${socket.remoteAddress}:${socket.remotePort} (端口 ${this.port})`);
      this.clients.push(socket);
      
      socket.on('close', () => {
        console.log(`❌ 客户端已断开连接 (端口 ${this.port})`);
        this.clients = this.clients.filter(c => c !== socket);
      });

      socket.on('error', (error) => {
        console.error(`⚠️  客户端错误 (端口 ${this.port}):`, error.message);
      });
    });

    this.updateInterval = setInterval(() => {
      this.simulateData();
    }, 1000);

    this.disconnectInterval = setInterval(() => {
      if (Math.random() > 0.7 && this.clients.length > 0) {
        this.simulateDisconnect();
      }
    }, 30000);

    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        console.log(`
=============================================
🎮 模拟 Modbus TCP PLC 服务器已启动
📍 监听端口: ${this.port}
🔢 从站 ID: ${this.unitId}
📊 模拟数据每 1 秒更新一次
🔄 随机每 30 秒有 30% 概率断开连接
=============================================
        `);
        resolve();
      });

      this.server.on('error', (error) => {
        console.error('服务器错误:', error.message);
        reject(error);
      });
    });
  }

  simulateDisconnect() {
    if (this.clients.length > 0) {
      const socket = this.clients[0];
      console.log(`⚠️  模拟 PLC 主动断开连接 (端口 ${this.port})`);
      socket.destroy();
    }
  }

  simulateData() {
    const baseTemp = 25;
    const tempFluctuation = Math.random() * 10;
    const tempTrend = (Date.now() % 300000) / 300000 * 60;
    
    this.holdingRegisters[0] = Math.floor((baseTemp + tempFluctuation + tempTrend) * 10);
    
    const baseVibration = 5;
    const vibrationSpike = Math.random() > 0.95 ? 20 : 0;
    this.holdingRegisters[1] = Math.floor((baseVibration + Math.random() * 3 + vibrationSpike) * 10);
    
    const baseCurrent = 10;
    this.holdingRegisters[2] = Math.floor((baseCurrent + Math.random() * 5) * 10);
  }

  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    if (this.disconnectInterval) {
      clearInterval(this.disconnectInterval);
    }
    this.clients.forEach(socket => {
      try {
        socket.destroy();
      } catch (e) {}
    });
    this.clients = [];
    if (this.server) {
      this.server.close();
      console.log('模拟 PLC 服务器已停止');
    }
  }
}

if (require.main === module) {
  const server1 = new MockPlcServer(502, 1);
  const server2 = new MockPlcServer(503, 1);
  
  Promise.all([server1.start(), server2.start()]).catch(console.error);

  process.on('SIGINT', () => {
    console.log('\n正在关闭模拟服务器...');
    server1.stop();
    server2.stop();
    process.exit(0);
  });
}

module.exports = MockPlcServer;
