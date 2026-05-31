require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  wsPort: process.env.WS_PORT || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    name: process.env.DB_NAME || 'plc_monitor',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
  },
  
  maxDevices: parseInt(process.env.MAX_DEVICES) || 5,
  dataRetentionDays: parseInt(process.env.DATA_RETENTION_DAYS) || 7,
  slidingWindowSize: parseInt(process.env.SLIDING_WINDOW_SIZE) || 20,
  temperatureThreshold: parseFloat(process.env.TEMPERATURE_THRESHOLD) || 85,
  vibrationChangeThreshold: parseFloat(process.env.VIBRATION_CHANGE_THRESHOLD) || 30,
  predictionMinutes: parseInt(process.env.PREDICTION_MINUTES) || 5
};
