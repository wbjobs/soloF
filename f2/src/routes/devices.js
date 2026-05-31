const express = require('express');
const Joi = require('joi');
const { Device, SensorData, Alert, Op } = require('../models');
const dataCollector = require('../services/dataCollector');
const connectionPool = require('../services/modbusConnectionPool');

const router = express.Router();

const deviceSchema = Joi.object({
  name: Joi.string().required(),
  ip: Joi.string().ip().required(),
  port: Joi.number().integer().min(1).max(65535).default(502),
  slaveId: Joi.number().integer().min(1).max(255).default(1),
  temperatureAddr: Joi.number().integer().min(0).required(),
  vibrationAddr: Joi.number().integer().min(0).required(),
  currentAddr: Joi.number().integer().min(0).required(),
  pollInterval: Joi.number().integer().min(1000).max(10000).default(2000),
  scaleFactor: Joi.number().positive().default(0.1)
});

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;
    
    const where = {};
    if (status) {
      where.status = status;
    }

    const { count, rows } = await Device.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    const devicesWithStatus = rows.map(device => ({
      ...device.toJSON(),
      isConnected: connectionPool.isConnected(device.id)
    }));

    res.json({
      success: true,
      data: devicesWithStatus,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('获取设备列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取设备列表失败',
      error: error.message
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const device = await Device.findByPk(req.params.id);
    
    if (!device) {
      return res.status(404).json({
        success: false,
        message: '设备不存在'
      });
    }

    res.json({
      success: true,
      data: {
        ...device.toJSON(),
        isConnected: connectionPool.isConnected(device.id)
      }
    });
  } catch (error) {
    console.error('获取设备详情失败:', error);
    res.status(500).json({
      success: false,
      message: '获取设备详情失败',
      error: error.message
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const { error, value } = deviceSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        error: error.details[0].message
      });
    }

    const existingDevice = await Device.findOne({
      where: { ip: value.ip, port: value.port }
    });

    if (existingDevice) {
      return res.status(400).json({
        success: false,
        message: '该IP和端口的设备已存在'
      });
    }

    const device = await Device.create(value);

    res.status(201).json({
      success: true,
      message: '设备创建成功',
      data: device
    });
  } catch (error) {
    console.error('创建设备失败:', error);
    res.status(500).json({
      success: false,
      message: '创建设备失败',
      error: error.message
    });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const device = await Device.findByPk(req.params.id);
    
    if (!device) {
      return res.status(404).json({
        success: false,
        message: '设备不存在'
      });
    }

    const { error, value } = deviceSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        error: error.details[0].message
      });
    }

    if (device.status === 'active') {
      await dataCollector.stopPolling(device.id);
    }

    await device.update(value);

    if (device.status === 'active') {
      await dataCollector.startPolling(device);
    }

    res.json({
      success: true,
      message: '设备更新成功',
      data: device
    });
  } catch (error) {
    console.error('更新设备失败:', error);
    res.status(500).json({
      success: false,
      message: '更新设备失败',
      error: error.message
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const device = await Device.findByPk(req.params.id);
    
    if (!device) {
      return res.status(404).json({
        success: false,
        message: '设备不存在'
      });
    }

    if (device.status === 'active') {
      await dataCollector.stopPolling(device.id);
    }

    await device.destroy();

    res.json({
      success: true,
      message: '设备删除成功'
    });
  } catch (error) {
    console.error('删除设备失败:', error);
    res.status(500).json({
      success: false,
      message: '删除设备失败',
      error: error.message
    });
  }
});

router.post('/:id/start', async (req, res) => {
  try {
    const device = await Device.findByPk(req.params.id);
    
    if (!device) {
      return res.status(404).json({
        success: false,
        message: '设备不存在'
      });
    }

    await dataCollector.startPolling(device);

    res.json({
      success: true,
      message: '设备轮询已启动'
    });
  } catch (error) {
    console.error('启动设备轮询失败:', error);
    res.status(500).json({
      success: false,
      message: '启动设备轮询失败',
      error: error.message
    });
  }
});

router.post('/:id/stop', async (req, res) => {
  try {
    const device = await Device.findByPk(req.params.id);
    
    if (!device) {
      return res.status(404).json({
        success: false,
        message: '设备不存在'
      });
    }

    await dataCollector.stopPolling(device.id);

    res.json({
      success: true,
      message: '设备轮询已停止'
    });
  } catch (error) {
    console.error('停止设备轮询失败:', error);
    res.status(500).json({
      success: false,
      message: '停止设备轮询失败',
      error: error.message
    });
  }
});

router.get('/:id/data', async (req, res) => {
  try {
    const { startTime, endTime, limit = 100 } = req.query;
    const deviceId = req.params.id;

    const where = { deviceId };
    
    if (startTime) {
      where.timestamp = { ...where.timestamp, [Op.gte]: new Date(startTime) };
    }
    if (endTime) {
      where.timestamp = { ...where.timestamp, [Op.lte]: new Date(endTime) };
    }

    const data = await SensorData.findAll({
      where,
      limit: parseInt(limit),
      order: [['timestamp', 'DESC']]
    });

    res.json({
      success: true,
      data: data.reverse()
    });
  } catch (error) {
    console.error('获取设备数据失败:', error);
    res.status(500).json({
      success: false,
      message: '获取设备数据失败',
      error: error.message
    });
  }
});

router.get('/:id/alerts', async (req, res) => {
  try {
    const { acknowledged, limit = 50 } = req.query;
    const deviceId = req.params.id;

    const where = { deviceId };
    
    if (acknowledged !== undefined) {
      where.acknowledged = acknowledged === 'true';
    }

    const alerts = await Alert.findAll({
      where,
      limit: parseInt(limit),
      order: [['timestamp', 'DESC']]
    });

    res.json({
      success: true,
      data: alerts
    });
  } catch (error) {
    console.error('获取设备告警失败:', error);
    res.status(500).json({
      success: false,
      message: '获取设备告警失败',
      error: error.message
    });
  }
});

module.exports = router;
