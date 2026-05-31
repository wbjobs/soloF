const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../../alert-rules.json');

const defaultRules = {
  conductivity: {
    enabled: true,
    min: 500,
    max: 2000
  },
  humidity: {
    enabled: true,
    min: 20,
    max: 80
  },
  temperature: {
    enabled: true,
    min: -10,
    max: 50
  }
};

function loadRules() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[WARN] Failed to load alert rules, using defaults:', error.message);
  }
  return { ...defaultRules };
}

function saveRules(rules) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(rules, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('[ERROR] Failed to save alert rules:', error.message);
    return false;
  }
}

function checkAlerts(data) {
  const rules = loadRules();
  const alerts = [];

  if (rules.conductivity?.enabled) {
    if (data.conductivity < rules.conductivity.min) {
      alerts.push({
        type: 'conductivity',
        level: 'warning',
        message: `电导率过低: ${data.conductivity} μS/cm (阈值: ${rules.conductivity.min}~${rules.conductivity.max})`,
        value: data.conductivity,
        threshold: { min: rules.conductivity.min, max: rules.conductivity.max }
      });
    } else if (data.conductivity > rules.conductivity.max) {
      alerts.push({
        type: 'conductivity',
        level: 'warning',
        message: `电导率过高: ${data.conductivity} μS/cm (阈值: ${rules.conductivity.min}~${rules.conductivity.max})`,
        value: data.conductivity,
        threshold: { min: rules.conductivity.min, max: rules.conductivity.max }
      });
    }
  }

  if (data.conductivity < 0) {
    alerts.push({
      type: 'conductivity',
      level: 'error',
      message: `传感器故障: 电导率 = ${data.conductivity} (负值表示传感器异常)`,
      value: data.conductivity,
      threshold: { min: 0, max: null }
    });
  }

  if (rules.humidity?.enabled) {
    if (data.humidity < rules.humidity.min) {
      alerts.push({
        type: 'humidity',
        level: 'warning',
        message: `湿度过低: ${data.humidity}% (阈值: ${rules.humidity.min}~${rules.humidity.max}%)`,
        value: data.humidity,
        threshold: { min: rules.humidity.min, max: rules.humidity.max }
      });
    } else if (data.humidity > rules.humidity.max) {
      alerts.push({
        type: 'humidity',
        level: 'warning',
        message: `湿度过高: ${data.humidity}% (阈值: ${rules.humidity.min}~${rules.humidity.max}%)`,
        value: data.humidity,
        threshold: { min: rules.humidity.min, max: rules.humidity.max }
      });
    }
  }

  if (rules.temperature?.enabled) {
    if (data.temperature < rules.temperature.min) {
      alerts.push({
        type: 'temperature',
        level: 'warning',
        message: `温度过低: ${data.temperature}°C (阈值: ${rules.temperature.min}~${rules.temperature.max}°C)`,
        value: data.temperature,
        threshold: { min: rules.temperature.min, max: rules.temperature.max }
      });
    } else if (data.temperature > rules.temperature.max) {
      alerts.push({
        type: 'temperature',
        level: 'warning',
        message: `温度过高: ${data.temperature}°C (阈值: ${rules.temperature.min}~${rules.temperature.max}°C)`,
        value: data.temperature,
        threshold: { min: rules.temperature.min, max: rules.temperature.max }
      });
    }
  }

  return alerts;
}

module.exports = {
  loadRules,
  saveRules,
  checkAlerts,
  defaultRules
};
