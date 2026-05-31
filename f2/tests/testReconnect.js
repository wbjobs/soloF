const { Device, sequelize } = require('../src/models');
const connectionPool = require('../src/services/modbusConnectionPool');
const dataCollector = require('../src/services/dataCollector');
const MockPlcServer = require('./mockModbusServer');

async function testReconnect() {
  console.log('🧪 开始测试重连机制...\n');

  try {
    await sequelize.authenticate();
    console.log('✅ 数据库连接成功\n');

    const mockServer = new MockPlcServer(502, 1);
    await mockServer.start();
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const [device] = await Device.findOrCreate({
      where: { ip: '127.0.0.1', port: 502 },
      defaults: {
        name: '测试设备',
        ip: '127.0.0.1',
        port: 502,
        slaveId: 1,
        temperatureAddr: 0,
        vibrationAddr: 1,
        currentAddr: 2,
        pollInterval: 2000,
        scaleFactor: 0.1,
        status: 'active'
      }
    });

    await dataCollector.startPolling(device);
    
    console.log('\n⏱️  等待 5 秒，然后模拟 PLC 断开连接...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('🔌 模拟 PLC 主动断开连接...\n');
    mockServer.simulateDisconnect();
    
    console.log('\n⏱️  等待 10 秒，观察自动重连...\n');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log('\n✅ 测试完成！');
    console.log('📊 检查上面的日志，确认：');
    console.log('   1. 检测到连接断开');
    console.log('   2. 自动触发重连');
    console.log('   3. 重连成功后恢复数据采集');
    
    await dataCollector.stopPolling(device.id);
    mockServer.stop();
    await sequelize.close();
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  testReconnect();
}

module.exports = { testReconnect };