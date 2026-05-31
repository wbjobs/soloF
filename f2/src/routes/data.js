const express = require('express');
const { Parser } = require('json2csv');
const { SensorData, Alert, Device, Op } = require('../models');

const router = express.Router();

router.get('/export/csv', async (req, res) => {
  try {
    const { deviceId, startTime, endTime } = req.query;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: 'deviceId 参数是必需的'
      });
    }

    const device = await Device.findByPk(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        message: '设备不存在'
      });
    }

    const where = { deviceId };
    
    if (startTime) {
      where.timestamp = { ...where.timestamp, [Op.gte]: new Date(startTime) };
    }
    if (endTime) {
      where.timestamp = { ...where.timestamp, [Op.lte]: new Date(endTime) };
    }

    const data = await SensorData.findAll({
      where,
      order: [['timestamp', 'ASC']],
      limit: 10000
    });

    const fields = [
      { label: '时间', value: 'timestamp' },
      { label: '温度(°C)', value: 'temperature' },
      { label: '振动', value: 'vibration' },
      { label: '电流(A)', value: 'current' }
    ];

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(data);

    const filename = `device_${deviceId}_data_${Date.now()}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (error) {
    console.error('导出CSV失败:', error);
    res.status(500).json({
      success: false,
      message: '导出CSV失败',
      error: error.message
    });
  }
});

router.get('/alerts/export/csv', async (req, res) => {
  try {
    const { deviceId, startTime, endTime, type } = req.query;

    const where = {};
    
    if (deviceId) {
      where.deviceId = deviceId;
    }
    if (type) {
      where.type = type;
    }
    if (startTime) {
      where.timestamp = { ...where.timestamp, [Op.gte]: new Date(startTime) };
    }
    if (endTime) {
      where.timestamp = { ...where.timestamp, [Op.lte]: new Date(endTime) };
    }

    const alerts = await Alert.findAll({
      where,
      include: [{
        model: Device,
        attributes: ['name', 'ip']
      }],
      order: [['timestamp', 'DESC']],
      limit: 5000
    });

    const fields = [
      { label: '时间', value: 'timestamp' },
      { label: '设备名称', value: 'Device.name' },
      { label: '设备IP', value: 'Device.ip' },
      { label: '告警类型', value: 'type' },
      { label: '严重程度', value: 'severity' },
      { label: '消息', value: 'message' },
      { label: '预测值', value: 'predictedValue' },
      { label: '是否确认', value: row => row.acknowledged ? '是' : '否' }
    ];

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(alerts);

    const filename = `alerts_export_${Date.now()}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (error) {
    console.error('导出告警CSV失败:', error);
    res.status(500).json({
      success: false,
      message: '导出告警CSV失败',
      error: error.message
    });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const { deviceId, hours = 24 } = req.query;

    const where = {};
    if (deviceId) {
      where.deviceId = deviceId;
    }

    const startTime = new Date();
    startTime.setHours(startTime.getHours() - parseInt(hours));
    where.timestamp = { [Op.gte]: startTime };

    const data = await SensorData.findAll({
      where,
      order: [['timestamp', 'ASC']]
    });

    if (data.length === 0) {
      return res.json({
        success: true,
        data: {
          count: 0,
          temperature: { min: null, max: null, avg: null },
          vibration: { min: null, max: null, avg: null },
          current: { min: null, max: null, avg: null }
        }
      });
    }

    const temperatures = data.map(d => d.temperature);
    const vibrations = data.map(d => d.vibration);
    const currents = data.map(d => d.current);

    const summary = {
      count: data.length,
      timeRange: {
        start: startTime,
        end: new Date()
      },
      temperature: {
        min: Math.min(...temperatures),
        max: Math.max(...temperatures),
        avg: temperatures.reduce((a, b) => a + b, 0) / temperatures.length
      },
      vibration: {
        min: Math.min(...vibrations),
        max: Math.max(...vibrations),
        avg: vibrations.reduce((a, b) => a + b, 0) / vibrations.length
      },
      current: {
        min: Math.min(...currents),
        max: Math.max(...currents),
        avg: currents.reduce((a, b) => a + b, 0) / currents.length
      }
    };

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('获取数据汇总失败:', error);
    res.status(500).json({
      success: false,
      message: '获取数据汇总失败',
      error: error.message
    });
  }
});

module.exports = router;
