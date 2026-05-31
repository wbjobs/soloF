const express = require('express');
const Joi = require('joi');
const { FaultRecord, Device, WeatherData, Op } = require('../models');
const weatherService = require('../services/weatherService');
const bayesianPredictor = require('../services/bayesianPredictor');

const router = express.Router();

const faultSchema = Joi.object({
  deviceId: Joi.string().uuid().required(),
  faultType: Joi.string().valid('overheat', 'vibration', 'overcurrent', 'connection', 'other').required(),
  severity: Joi.string().valid('minor', 'major', 'critical').default('minor'),
  description: Joi.string().optional(),
  occurredAt: Joi.date().default(() => new Date()),
  resolvedAt: Joi.date().optional(),
  rootCause: Joi.string().optional(),
  sensorDataSnapshot: Joi.object().optional()
});

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, deviceId, faultType, startDate, endDate } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (deviceId) {
      where.deviceId = deviceId;
    }
    if (faultType) {
      where.faultType = faultType;
    }
    if (startDate || endDate) {
      where.occurredAt = {};
      if (startDate) {
        where.occurredAt[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        where.occurredAt[Op.lte] = new Date(endDate);
      }
    }

    const { count, rows } = await FaultRecord.findAndCountAll({
      where,
      include: [{
        model: Device,
        attributes: ['name', 'ip', 'port']
      }],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['occurredAt', 'DESC']]
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('获取故障记录失败:', error);
    res.status(500).json({
      success: false,
      message: '获取故障记录失败',
      error: error.message
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const fault = await FaultRecord.findByPk(req.params.id, {
      include: [{
        model: Device,
        attributes: ['name', 'ip', 'port']
      }]
    });

    if (!fault) {
      return res.status(404).json({
        success: false,
        message: '故障记录不存在'
      });
    }

    res.json({
      success: true,
      data: fault
    });
  } catch (error) {
    console.error('获取故障记录详情失败:', error);
    res.status(500).json({
      success: false,
      message: '获取故障记录详情失败',
      error: error.message
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const { error, value } = faultSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        error: error.details[0].message
      });
    }

    const device = await Device.findByPk(value.deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        message: '设备不存在'
      });
    }

    const weatherData = await weatherService.getWeatherByDevice(device);
    value.weatherConditions = weatherData;

    const fault = await FaultRecord.create(value);

    res.status(201).json({
      success: true,
      message: '故障记录创建成功',
      data: fault
    });
  } catch (error) {
    console.error('创建故障记录失败:', error);
    res.status(500).json({
      success: false,
      message: '创建故障记录失败',
      error: error.message
    });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const fault = await FaultRecord.findByPk(req.params.id);

    if (!fault) {
      return res.status(404).json({
        success: false,
        message: '故障记录不存在'
      });
    }

    const { error, value } = faultSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        error: error.details[0].message
      });
    }

    await fault.update(value);

    res.json({
      success: true,
      message: '故障记录更新成功',
      data: fault
    });
  } catch (error) {
    console.error('更新故障记录失败:', error);
    res.status(500).json({
      success: false,
      message: '更新故障记录失败',
      error: error.message
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const fault = await FaultRecord.findByPk(req.params.id);

    if (!fault) {
      return res.status(404).json({
        success: false,
        message: '故障记录不存在'
      });
    }

    await fault.destroy();

    res.json({
      success: true,
      message: '故障记录删除成功'
    });
  } catch (error) {
    console.error('删除故障记录失败:', error);
    res.status(500).json({
      success: false,
      message: '删除故障记录失败',
      error: error.message
    });
  }
});

router.get('/stats/:deviceId', async (req, res) => {
  try {
    const stats = await bayesianPredictor.getHistoricalFaultStats(req.params.deviceId);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('获取故障统计失败:', error);
    res.status(500).json({
      success: false,
      message: '获取故障统计失败',
      error: error.message
    });
  }
});

router.get('/weather/:location', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    const location = req.params.location;

    const weatherData = await weatherService.getWeatherByLocation(
      location,
      lat ? parseFloat(lat) : undefined,
      lon ? parseFloat(lon) : undefined
    );

    res.json({
      success: true,
      data: weatherData
    });
  } catch (error) {
    console.error('获取天气数据失败:', error);
    res.status(500).json({
      success: false,
      message: '获取天气数据失败',
      error: error.message
    });
  }
});

router.get('/weather/history/:location', async (req, res) => {
  try {
    const { limit = 50, startDate, endDate } = req.query;
    const location = req.params.location;

    const where = { location };
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) {
        where.timestamp[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        where.timestamp[Op.lte] = new Date(endDate);
      }
    }

    const weatherRecords = await WeatherData.findAll({
      where,
      limit: parseInt(limit),
      order: [['timestamp', 'DESC']]
    });

    res.json({
      success: true,
      data: weatherRecords
    });
  } catch (error) {
    console.error('获取天气历史数据失败:', error);
    res.status(500).json({
      success: false,
      message: '获取天气历史数据失败',
      error: error.message
    });
  }
});

module.exports = router;
