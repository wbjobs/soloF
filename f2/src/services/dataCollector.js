const EventEmitter = require('events');
const connectionPool = require('./modbusConnectionPool');
const { SensorData, Device, Alert, FaultRecord, sequelize, Op } = require('../models');
const config = require('../config');
const weatherService = require('./weatherService');
const bayesianPredictor = require('./bayesianPredictor');

class DataCollector extends EventEmitter {
  constructor() {
    super();
    this.pollingTimers = new Map();
    this.dataWindows = new Map();
    this.cleanupInterval = null;
  }

  async start() {
    console.log('启动数据采集服务...');
    
    const activeDevices = await Device.findAll({
      where: { status: 'active' }
    });

    for (const device of activeDevices) {
      await this.startPolling(device);
    }

    this._startDataCleanup();
    
    console.log(`数据采集服务已启动，当前监控 ${activeDevices.length} 个设备`);
  }

  async startPolling(device) {
    if (this.pollingTimers.has(device.id)) {
      console.log(`设备 ${device.name} 已在轮询中`);
      return;
    }

    try {
      await connectionPool.connect(device);
      this._initDataWindow(device.id);
      this._schedulePolling(device);
      
      await device.update({ status: 'active' });
      
      console.log(`开始轮询设备 ${device.name}，间隔 ${device.pollInterval}ms`);
    } catch (error) {
      console.error(`启动设备 ${device.name} 轮询失败:`, error.message);
      await device.update({ status: 'error' });
      throw error;
    }
  }

  _schedulePolling(device) {
    const poll = async () => {
      try {
        await this._collectData(device);
      } catch (error) {
        console.error(`采集设备 ${device.name} 数据失败:`, error.message);
      }
    };

    poll();
    
    const timer = setInterval(poll, device.pollInterval);
    this.pollingTimers.set(device.id, timer);
  }

  async stopPolling(deviceId) {
    const timer = this.pollingTimers.get(deviceId);
    
    if (timer) {
      clearInterval(timer);
      this.pollingTimers.delete(deviceId);
      this.dataWindows.delete(deviceId);
    }

    await connectionPool.disconnect(deviceId);
    
    const device = await Device.findByPk(deviceId);
    if (device) {
      await device.update({ status: 'inactive' });
    }

    console.log(`停止轮询设备 ${deviceId}`);
  }

  async _collectData(device) {
    try {
      if (!connectionPool.isConnected(device.id)) {
        console.log(`🔄 设备 ${device.name} 连接已断开，尝试重新连接...`);
        try {
          await connectionPool.connect(device);
          console.log(`✅ 设备 ${device.name} 重新连接成功`);
        } catch (connectError) {
          console.warn(`⚠️  设备 ${device.name} 重连失败，等待下次轮询:`, connectError.message);
          return;
        }
      }

      const addresses = [
        device.temperatureAddr,
        device.vibrationAddr,
        device.currentAddr
      ];
      
      const minAddr = Math.min(...addresses);
      const maxAddr = Math.max(...addresses);
      const quantity = maxAddr - minAddr + 1;

      const values = await connectionPool.readHoldingRegisters(
        device.id, 
        minAddr, 
        quantity
      );

      const temperature = values[device.temperatureAddr - minAddr] * device.scaleFactor;
      const vibration = values[device.vibrationAddr - minAddr] * device.scaleFactor;
      const current = values[device.currentAddr - minAddr] * device.scaleFactor;

      const sensorData = await SensorData.create({
        deviceId: device.id,
        temperature,
        vibration,
        current,
        timestamp: new Date()
      });

      this._addToDataWindow(device.id, sensorData);
      this.emit('dataCollected', { device: device.toJSON(), data: sensorData.toJSON() });

      await this._runPrediction(device);

    } catch (error) {
      console.error(`❌ 采集设备 ${device.name} 数据时出错:`, error.message);
      
      if (error.name === 'NotConnectedError' || 
          error.message?.includes('ECONNRESET') ||
          error.message?.includes('ETIMEDOUT') ||
          error.message?.includes('Connection')) {
        console.log(`🔌 设备 ${device.name} 连接异常，连接池将自动重连`);
      }
      
      throw error;
    }
  }

  _initDataWindow(deviceId) {
    this.dataWindows.set(deviceId, []);
  }

  _addToDataWindow(deviceId, data) {
    const window = this.dataWindows.get(deviceId) || [];
    
    window.push({
      temperature: data.temperature,
      vibration: data.vibration,
      current: data.current,
      timestamp: data.timestamp
    });

    if (window.length > config.slidingWindowSize) {
      window.shift();
    }

    this.dataWindows.set(deviceId, window);
  }

  async _runPrediction(device) {
    const window = this.dataWindows.get(device.id);
    
    if (!window || window.length < 5) {
      return;
    }

    const predictionConfig = {
      temperatureThreshold: config.temperatureThreshold,
      vibrationChangeThreshold: config.vibrationChangeThreshold,
      predictionMinutes: config.predictionMinutes
    };

    const alerts = [];

    const temperaturePrediction = this._predictTemperature(device, window, predictionConfig);
    if (temperaturePrediction) {
      const bayesianResult = await bayesianPredictor.calculatePredictionConfidence(
        device,
        'temperature',
        window,
        temperaturePrediction.predictedValue
      );

      const severityText = {
        'low': '低',
        'medium': '中',
        'high': '高'
      }[bayesianResult.severity];

      alerts.push({
        deviceId: device.id,
        type: 'temperature',
        severity: bayesianResult.severity,
        confidence: bayesianResult.confidence,
        message: `【${severityText}置信度】预测 ${predictionConfig.predictionMinutes} 分钟后温度将达到 ${temperaturePrediction.predictedValue.toFixed(2)}°C，超过阈值 ${predictionConfig.temperatureThreshold}°C`,
        predictedValue: temperaturePrediction.predictedValue,
        predictedTime: temperaturePrediction.predictedTime,
        weatherFactor: bayesianResult.weatherImpact,
        historicalFactor: bayesianResult.contributions.historical.probability,
        timestamp: new Date()
      });
    }

    const vibrationPrediction = this._predictVibration(device, window, predictionConfig);
    if (vibrationPrediction) {
      const bayesianResult = await bayesianPredictor.calculatePredictionConfidence(
        device,
        'vibration',
        window,
        vibrationPrediction.changeRate
      );

      const severityText = {
        'low': '低',
        'medium': '中',
        'high': '高'
      }[bayesianResult.severity];

      alerts.push({
        deviceId: device.id,
        type: 'vibration',
        severity: bayesianResult.severity,
        confidence: bayesianResult.confidence,
        message: `【${severityText}置信度】振动幅值变化率达到 ${vibrationPrediction.changeRate.toFixed(2)}%，超过阈值 ${predictionConfig.vibrationChangeThreshold}%`,
        predictedValue: vibrationPrediction.changeRate,
        predictedTime: new Date(),
        weatherFactor: bayesianResult.weatherImpact,
        historicalFactor: bayesianResult.contributions.historical.probability,
        timestamp: new Date()
      });
    }

    if (alerts.length > 0) {
      const savedAlerts = await Alert.bulkCreate(alerts);
      
      for (const alert of savedAlerts) {
        this.emit('alert', {
          device: device.toJSON(),
          alert: alert.toJSON()
        });
      }
    }
  }

  _predictTemperature(device, window, config) {
    const temperatures = window.map(d => d.temperature);
    const timestamps = window.map(d => d.timestamp.getTime());

    const n = temperatures.length;
    const sumX = timestamps.reduce((a, b) => a + b, 0);
    const sumY = temperatures.reduce((a, b) => a + b, 0);
    const sumXY = timestamps.reduce((sum, x, i) => sum + x * temperatures[i], 0);
    const sumX2 = timestamps.reduce((sum, x) => sum + x * x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const predictionTime = Date.now() + config.predictionMinutes * 60 * 1000;
    const predictedTemperature = slope * predictionTime + intercept;

    if (predictedTemperature >= config.temperatureThreshold) {
      return {
        predictedValue: predictedTemperature,
        predictedTime: new Date(predictionTime)
      };
    }

    return null;
  }

  _predictVibration(device, window, config) {
    const vibrations = window.map(d => d.vibration);
    
    const recentAvg = vibrations.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const earlierAvg = vibrations.slice(0, 5).reduce((a, b) => a + b, 0) / 5;

    if (earlierAvg === 0) return null;

    const changeRate = Math.abs((recentAvg - earlierAvg) / earlierAvg) * 100;

    if (changeRate > config.vibrationChangeThreshold) {
      return {
        changeRate
      };
    }

    return null;
  }

  _startDataCleanup() {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(async () => {
      try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - config.dataRetentionDays);

        const deletedCount = await SensorData.destroy({
          where: {
            timestamp: {
              [Op.lt]: cutoffDate
            }
          }
        });

        if (deletedCount > 0) {
          console.log(`清理了 ${deletedCount} 条过期数据（保留最近 ${config.dataRetentionDays} 天）`);
        }
      } catch (error) {
        console.error('数据清理失败:', error.message);
      }
    }, 24 * 60 * 60 * 1000);
  }

  async stop() {
    console.log('停止数据采集服务...');

    for (const deviceId of this.pollingTimers.keys()) {
      await this.stopPolling(deviceId);
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    await connectionPool.disconnectAll();
    
    console.log('数据采集服务已停止');
  }

  updatePollingInterval(deviceId, newInterval) {
    const timer = this.pollingTimers.get(deviceId);
    
    if (timer) {
      clearInterval(timer);
      this.pollingTimers.delete(deviceId);
    }
  }

  getDataWindow(deviceId) {
    return this.dataWindows.get(deviceId) || [];
  }
}

module.exports = new DataCollector();
