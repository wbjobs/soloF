const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const devices = [
  { devEui: '0000000000000001', baseHumidity: 45, baseTemp: 22, baseCond: 1200 },
  { devEui: '0000000000000002', baseHumidity: 52, baseTemp: 24, baseCond: 1500 },
  { devEui: '0000000000000003', baseHumidity: 38, baseTemp: 20, baseCond: 900 }
];

function generateDataPoint(device, timestamp) {
  const hourOfDay = timestamp.getHours();
  const tempVariation = Math.sin((hourOfDay - 6) * Math.PI / 12) * 3;
  const humidityVariation = -Math.sin((hourOfDay - 12) * Math.PI / 12) * 5;

  return {
    devEui: device.devEui,
    humidity: device.baseHumidity + humidityVariation + (Math.random() - 0.5) * 4,
    temperature: device.baseTemp + tempVariation + (Math.random() - 0.5) * 2,
    conductivity: device.baseCond + (Math.random() - 0.5) * 100,
    timestamp: timestamp
  };
}

async function generateHistoryData(hours = 24, interval = 15) {
  console.log(`开始生成过去 ${hours} 小时的历史数据...`);
  
  const now = new Date();
  const dataPoints = [];
  
  for (let h = hours; h >= 0; h--) {
    for (let m = 0; m < 60; m += interval) {
      const timestamp = new Date(now.getTime() - h * 3600000 - m * 60000);
      
      devices.forEach(device => {
        const data = generateDataPoint(device, timestamp);
        dataPoints.push(data);
      });
    }
  }

  try {
    for (const point of dataPoints) {
      await pool.query(
        'INSERT INTO sensor_data (dev_eui, humidity, temperature, conductivity, timestamp) VALUES ($1, $2, $3, $4, $5)',
        [point.devEui, point.humidity.toFixed(2), point.temperature.toFixed(2), Math.round(point.conductivity), point.timestamp]
      );
    }
    
    console.log(`成功生成 ${dataPoints.length} 条历史数据记录`);
  } catch (error) {
    console.error('生成历史数据时出错:', error);
  } finally {
    await pool.end();
  }
}

generateHistoryData(24, 15);
