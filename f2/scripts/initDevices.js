require('dotenv').config();
const { sequelize, Device } = require('../src/models');

async function initDevices() {
  try {
    await sequelize.authenticate();
    console.log('数据库连接成功');

    const sampleDevices = [
      {
        name: '风机 #1',
        ip: '127.0.0.1',
        port: 502,
        slaveId: 1,
        temperatureAddr: 0,
        vibrationAddr: 1,
        currentAddr: 2,
        pollInterval: 2000,
        scaleFactor: 0.1,
        status: 'inactive'
      },
      {
        name: '泵 #2',
        ip: '127.0.0.1',
        port: 503,
        slaveId: 1,
        temperatureAddr: 0,
        vibrationAddr: 1,
        currentAddr: 2,
        pollInterval: 3000,
        scaleFactor: 0.1,
        status: 'inactive'
      },
      {
        name: '压缩机 #3',
        ip: '127.0.0.1',
        port: 504,
        slaveId: 1,
        temperatureAddr: 0,
        vibrationAddr: 1,
        currentAddr: 2,
        pollInterval: 2500,
        scaleFactor: 0.1,
        status: 'inactive'
      }
    ];

    for (const device of sampleDevices) {
      const [record, created] = await Device.findOrCreate({
        where: { ip: device.ip, port: device.port },
        defaults: device
      });

      if (created) {
        console.log(`✅ 创建设备: ${device.name}`);
      } else {
        console.log(`⏭️  设备已存在: ${device.name}`);
      }
    }

    console.log('\n初始化完成!');
    
    await sequelize.close();
    process.exit(0);

  } catch (error) {
    console.error('初始化失败:', error.message);
    process.exit(1);
  }
}

initDevices();
