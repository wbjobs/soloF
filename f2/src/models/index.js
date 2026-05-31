const { Sequelize, DataTypes, Op } = require('sequelize');
const config = require('../config');

const sequelize = new Sequelize(
  config.database.name,
  config.database.user,
  config.database.password,
  {
    host: config.database.host,
    port: config.database.port,
    dialect: 'postgres',
    logging: config.nodeEnv === 'development' ? console.log : false,
    timezone: '+08:00'
  }
);

const Device = sequelize.define('Device', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  ip: {
    type: DataTypes.STRING,
    allowNull: false
  },
  port: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 502
  },
  slaveId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  temperatureAddr: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '温度寄存器地址'
  },
  vibrationAddr: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '振动寄存器地址'
  },
  currentAddr: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '电流寄存器地址'
  },
  pollInterval: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 2000,
    comment: '轮询间隔(毫秒), 1000-10000'
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'error'),
    defaultValue: 'inactive'
  },
  scaleFactor: {
    type: DataTypes.FLOAT,
    defaultValue: 0.1,
    comment: '寄存器值缩放因子'
  },
  location: {
    type: DataTypes.STRING,
    comment: '设备位置，用于天气API查询'
  },
  latitude: {
    type: DataTypes.FLOAT,
    comment: '纬度'
  },
  longitude: {
    type: DataTypes.FLOAT,
    comment: '经度'
  }
}, {
  timestamps: true,
  indexes: [
    { fields: ['ip', 'port'], unique: true }
  ]
});

const SensorData = sequelize.define('SensorData', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  deviceId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: Device,
      key: 'id'
    }
  },
  temperature: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  vibration: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  current: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  timestamps: false,
  indexes: [
    { fields: ['deviceId', 'timestamp'] },
    { fields: ['timestamp'] }
  ]
});

const Alert = sequelize.define('Alert', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  deviceId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: Device,
      key: 'id'
    }
  },
  type: {
    type: DataTypes.ENUM('temperature', 'vibration', 'connection'),
    allowNull: false
  },
  severity: {
    type: DataTypes.ENUM('low', 'medium', 'high'),
    defaultValue: 'medium',
    comment: '三级预警等级：低、中、高'
  },
  confidence: {
    type: DataTypes.FLOAT,
    defaultValue: 0.5,
    comment: '预测置信度 0-1'
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  predictedValue: {
    type: DataTypes.FLOAT
  },
  predictedTime: {
    type: DataTypes.DATE
  },
  weatherFactor: {
    type: DataTypes.JSON,
    comment: '天气影响因素数据'
  },
  historicalFactor: {
    type: DataTypes.FLOAT,
    comment: '历史故障影响因子'
  },
  acknowledged: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  timestamps: false,
  indexes: [
    { fields: ['deviceId', 'timestamp'] },
    { fields: ['acknowledged'] },
    { fields: ['severity'] }
  ]
});

const FaultRecord = sequelize.define('FaultRecord', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  deviceId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: Device,
      key: 'id'
    }
  },
  faultType: {
    type: DataTypes.ENUM('overheat', 'vibration', 'overcurrent', 'connection', 'other'),
    allowNull: false,
    comment: '故障类型'
  },
  severity: {
    type: DataTypes.ENUM('minor', 'major', 'critical'),
    defaultValue: 'minor'
  },
  description: {
    type: DataTypes.TEXT
  },
  occurredAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  resolvedAt: {
    type: DataTypes.DATE
  },
  rootCause: {
    type: DataTypes.TEXT,
    comment: '根本原因分析'
  },
  weatherConditions: {
    type: DataTypes.JSON,
    comment: '故障发生时的天气状况'
  },
  sensorDataSnapshot: {
    type: DataTypes.JSON,
    comment: '故障发生时的传感器数据快照'
  }
}, {
  timestamps: true,
  indexes: [
    { fields: ['deviceId', 'occurredAt'] },
    { fields: ['faultType'] }
  ]
});

const WeatherData = sequelize.define('WeatherData', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  location: {
    type: DataTypes.STRING,
    allowNull: false
  },
  latitude: {
    type: DataTypes.FLOAT
  },
  longitude: {
    type: DataTypes.FLOAT
  },
  temperature: {
    type: DataTypes.FLOAT,
    comment: '环境温度(°C)'
  },
  humidity: {
    type: DataTypes.FLOAT,
    comment: '相对湿度(%)'
  },
  pressure: {
    type: DataTypes.FLOAT,
    comment: '气压(hPa)'
  },
  weatherDescription: {
    type: DataTypes.STRING,
    comment: '天气描述'
  },
  windSpeed: {
    type: DataTypes.FLOAT,
    comment: '风速(m/s)'
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  timestamps: false,
  indexes: [
    { fields: ['location', 'timestamp'] },
    { fields: ['timestamp'] }
  ]
});

const PredictionConfig = sequelize.define('PredictionConfig', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  slidingWindowSize: {
    type: DataTypes.INTEGER,
    defaultValue: 20
  },
  temperatureThreshold: {
    type: DataTypes.FLOAT,
    defaultValue: 85
  },
  vibrationChangeThreshold: {
    type: DataTypes.FLOAT,
    defaultValue: 30
  },
  predictionMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 5
  },
  weatherImpactWeight: {
    type: DataTypes.FLOAT,
    defaultValue: 0.3,
    comment: '天气因素权重 0-1'
  },
  historicalImpactWeight: {
    type: DataTypes.FLOAT,
    defaultValue: 0.4,
    comment: '历史故障因素权重 0-1'
  },
  sensorImpactWeight: {
    type: DataTypes.FLOAT,
    defaultValue: 0.3,
    comment: '传感器数据因素权重 0-1'
  },
  highConfidenceThreshold: {
    type: DataTypes.FLOAT,
    defaultValue: 0.75,
    comment: '高置信度阈值'
  },
  mediumConfidenceThreshold: {
    type: DataTypes.FLOAT,
    defaultValue: 0.4,
    comment: '中置信度阈值'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  timestamps: true
});

Device.hasMany(SensorData, { foreignKey: 'deviceId' });
SensorData.belongsTo(Device, { foreignKey: 'deviceId' });

Device.hasMany(Alert, { foreignKey: 'deviceId' });
Alert.belongsTo(Device, { foreignKey: 'deviceId' });

Device.hasMany(FaultRecord, { foreignKey: 'deviceId' });
FaultRecord.belongsTo(Device, { foreignKey: 'deviceId' });

module.exports = {
  sequelize,
  Sequelize,
  Op,
  Device,
  SensorData,
  Alert,
  PredictionConfig,
  FaultRecord,
  WeatherData
};
