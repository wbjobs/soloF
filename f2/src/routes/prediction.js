const express = require('express');
const Joi = require('joi');
const { PredictionConfig } = require('../models');
const dataCollector = require('../services/dataCollector');
const config = require('../config');

const router = express.Router();

const configSchema = Joi.object({
  slidingWindowSize: Joi.number().integer().min(5).max(100).default(20),
  temperatureThreshold: Joi.number().positive().default(85),
  vibrationChangeThreshold: Joi.number().positive().default(30),
  predictionMinutes: Joi.number().integer().min(1).max(60).default(5)
});

router.get('/config', async (req, res) => {
  try {
    const configs = await PredictionConfig.findAll({
      where: { isActive: true },
      order: [['createdAt', 'DESC']],
      limit: 1
    });

    if (configs.length === 0) {
      return res.json({
        success: true,
        data: {
          slidingWindowSize: config.slidingWindowSize,
          temperatureThreshold: config.temperatureThreshold,
          vibrationChangeThreshold: config.vibrationChangeThreshold,
          predictionMinutes: config.predictionMinutes
        }
      });
    }

    res.json({
      success: true,
      data: configs[0]
    });
  } catch (error) {
    console.error('获取预测配置失败:', error);
    res.status(500).json({
      success: false,
      message: '获取预测配置失败',
      error: error.message
    });
  }
});

router.put('/config', async (req, res) => {
  try {
    const { error, value } = configSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: '参数验证失败',
        error: error.details[0].message
      });
    }

    await PredictionConfig.update(
      { isActive: false },
      { where: { isActive: true } }
    );

    const newConfig = await PredictionConfig.create({
      ...value,
      isActive: true
    });

    res.json({
      success: true,
      message: '预测配置已更新',
      data: newConfig
    });
  } catch (error) {
    console.error('更新预测配置失败:', error);
    res.status(500).json({
      success: false,
      message: '更新预测配置失败',
      error: error.message
    });
  }
});

router.get('/config/history', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    const configs = await PredictionConfig.findAll({
      limit: parseInt(limit),
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: configs
    });
  } catch (error) {
    console.error('获取配置历史失败:', error);
    res.status(500).json({
      success: false,
      message: '获取配置历史失败',
      error: error.message
    });
  }
});

router.get('/window/:deviceId', async (req, res) => {
  try {
    const windowData = dataCollector.getDataWindow(req.params.deviceId);
    
    res.json({
      success: true,
      data: {
        size: windowData.length,
        data: windowData
      }
    });
  } catch (error) {
    console.error('获取数据窗口失败:', error);
    res.status(500).json({
      success: false,
      message: '获取数据窗口失败',
      error: error.message
    });
  }
});

module.exports = router;
