const { FaultRecord, SensorData, PredictionConfig, Op } = require('../models');
const weatherService = require('./weatherService');

class BayesianPredictor {
  constructor() {
    this.config = null;
  }

  async loadConfig() {
    if (!this.config) {
      this.config = await PredictionConfig.findOne({
        where: { isActive: true },
        order: [['createdAt', 'DESC']]
      });

      if (!this.config) {
        this.config = {
          weatherImpactWeight: 0.3,
          historicalImpactWeight: 0.4,
          sensorImpactWeight: 0.3,
          highConfidenceThreshold: 0.75,
          mediumConfidenceThreshold: 0.4
        };
      }
    }
    return this.config;
  }

  async calculatePredictionConfidence(device, alertType, sensorWindow, predictedValue) {
    await this.loadConfig();

    const sensorProb = this.calculateSensorProbability(sensorWindow, alertType, predictedValue);

    const weatherData = await weatherService.getWeatherByDevice(device);
    const weatherImpact = weatherService.calculateWeatherImpact(weatherData, alertType);
    const weatherProb = this.calculateWeatherProbability(weatherImpact);

    const historicalProb = await this.calculateHistoricalProbability(device.id, alertType);

    const { posteriorProb, contributions } = this.naiveBayesFusion(
      sensorProb,
      weatherProb,
      historicalProb
    );

    const severity = this.determineSeverity(posteriorProb);

    return {
      confidence: posteriorProb,
      severity,
      contributions,
      weatherImpact,
      weatherData: weatherData || null
    };
  }

  calculateSensorProbability(sensorWindow, alertType, predictedValue) {
    if (!sensorWindow || sensorWindow.length < 5) {
      return 0.5;
    }

    const values = sensorWindow.map(d => {
      switch (alertType) {
        case 'temperature': return d.temperature;
        case 'vibration': return d.vibration;
        default: return d.current;
      }
    });

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    const recentTrend = this.calculateTrend(values);

    let prob = 0.5;

    if (alertType === 'temperature') {
      const threshold = 85;
      const anomalyScore = Math.abs(predictedValue - threshold) / (threshold * 0.3);
      prob = Math.min(0.95, 0.3 + anomalyScore * 0.5);
    } else if (alertType === 'vibration') {
      const cv = stdDev / (mean + 0.001);
      prob = Math.min(0.95, 0.3 + cv * 0.8);
    }

    if (Math.abs(recentTrend) > 0.1) {
      prob += Math.min(0.2, Math.abs(recentTrend) * 0.5);
    }

    return Math.min(0.95, Math.max(0.05, prob));
  }

  calculateTrend(values) {
    if (values.length < 2) return 0;

    const n = values.length;
    const indices = Array.from({ length: n }, (_, i) => i);

    const meanX = (n - 1) / 2;
    const meanY = values.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (indices[i] - meanX) * (values[i] - meanY);
      denominator += Math.pow(indices[i] - meanX, 2);
    }

    return denominator === 0 ? 0 : numerator / denominator;
  }

  calculateWeatherProbability(weatherImpact) {
    const factor = weatherImpact.factor || 0;
    return 0.3 + factor * 0.6;
  }

  async calculateHistoricalProbability(deviceId, alertType) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const faultMapping = {
      'temperature': 'overheat',
      'vibration': 'vibration',
      'connection': 'connection'
    };

    const faultType = faultMapping[alertType] || 'other';

    try {
      const recentFaults = await FaultRecord.count({
        where: {
          deviceId,
          faultType,
          occurredAt: {
            [Op.gte]: thirtyDaysAgo
          }
        }
      });

      const totalFaults = await FaultRecord.count({
        where: {
          deviceId,
          occurredAt: {
            [Op.gte]: thirtyDaysAgo
          }
        }
      });

      if (totalFaults === 0) {
        return 0.1;
      }

      const recencyBoost = await this.calculateRecencyBoost(deviceId, faultType);

      let prob = (recentFaults / totalFaults) * 0.7 + 0.1;
      prob += recencyBoost;

      return Math.min(0.95, Math.max(0.05, prob));
    } catch (error) {
      console.error('计算历史概率失败:', error.message);
      return 0.3;
    }
  }

  async calculateRecencyBoost(deviceId, faultType) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentFault = await FaultRecord.findOne({
      where: {
        deviceId,
        faultType,
        occurredAt: {
          [Op.gte]: sevenDaysAgo
        }
      },
      order: [['occurredAt', 'DESC']]
    });

    if (recentFault) {
      const daysSince = (Date.now() - recentFault.occurredAt.getTime()) / (24 * 60 * 60 * 1000);
      return Math.max(0, 0.3 - daysSince * 0.04);
    }

    return 0;
  }

  async naiveBayesFusion(sensorProb, weatherProb, historicalProb) {
    await this.loadConfig();

    const weights = {
      sensor: this.config.sensorImpactWeight || 0.3,
      weather: this.config.weatherImpactWeight || 0.3,
      historical: this.config.historicalImpactWeight || 0.4
    };

    const priorProb = 0.3;

    const likelihood = Math.pow(sensorProb, weights.sensor) *
      Math.pow(weatherProb, weights.weather) *
      Math.pow(historicalProb, weights.historical);

    const notSensorProb = 1 - sensorProb;
    const notWeatherProb = 1 - weatherProb;
    const notHistoricalProb = 1 - historicalProb;

    const likelihoodNot = Math.pow(notSensorProb, weights.sensor) *
      Math.pow(notWeatherProb, weights.weather) *
      Math.pow(notHistoricalProb, weights.historical);

    const numerator = likelihood * priorProb;
    const denominator = numerator + likelihoodNot * (1 - priorProb);

    const posteriorProb = denominator === 0 ? priorProb : numerator / denominator;

    const contributions = {
      sensor: {
        probability: sensorProb,
        weight: weights.sensor
      },
      weather: {
        probability: weatherProb,
        weight: weights.weather
      },
      historical: {
        probability: historicalProb,
        weight: weights.historical
      }
    };

    return { posteriorProb, contributions };
  }

  determineSeverity(confidence) {
    if (confidence >= this.config.highConfidenceThreshold) {
      return 'high';
    } else if (confidence >= this.config.mediumConfidenceThreshold) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  async getHistoricalFaultStats(deviceId) {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const faults = await FaultRecord.findAll({
      where: {
        deviceId,
        occurredAt: {
          [Op.gte]: ninetyDaysAgo
        }
      },
      order: [['occurredAt', 'DESC']]
    });

    const stats = {
      totalCount: faults.length,
      byType: {},
      bySeverity: {},
      recentFaults: faults.slice(0, 5),
      avgFaultInterval: null
    };

    for (const fault of faults) {
      stats.byType[fault.faultType] = (stats.byType[fault.faultType] || 0) + 1;
      stats.bySeverity[fault.severity] = (stats.bySeverity[fault.severity] || 0) + 1;
    }

    if (faults.length >= 2) {
      const intervals = [];
      for (let i = 0; i < faults.length - 1; i++) {
        const interval = Math.abs(faults[i].occurredAt - faults[i + 1].occurredAt) / (24 * 60 * 60 * 1000);
        intervals.push(interval);
      }
      stats.avgFaultInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    }

    return stats;
  }
}

module.exports = new BayesianPredictor();
