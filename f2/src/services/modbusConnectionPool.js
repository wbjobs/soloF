const Modbus = require('jsmodbus');
const net = require('net');
const EventEmitter = require('events');
const config = require('../config');

class ModbusConnectionPool extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map();
    this.maxConnections = config.maxDevices;
    this.reconnectAttempts = new Map();
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
  }

  async connect(device) {
    const connectionKey = device.id;
    const existingConnection = this.connections.get(connectionKey);
    
    if (existingConnection) {
      if (existingConnection.connected) {
        return existingConnection;
      } else {
        this._cleanupConnection(connectionKey);
      }
    }

    if (this.connections.size >= this.maxConnections) {
      throw new Error(`已达到最大连接数限制 (${this.maxConnections})`);
    }

    return this._createConnection(device);
  }

  async _createConnection(device) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const client = new Modbus.client.TCP(socket, device.slaveId);
      const connectionKey = device.id;

      const connection = {
        device,
        socket,
        client,
        connected: false,
        lastActivity: null
      };

      let isResolved = false;

      socket.on('connect', () => {
        console.log(`✅ 设备 ${device.name} (${device.ip}:${device.port}) 连接成功`);
        connection.connected = true;
        connection.lastActivity = Date.now();
        this.reconnectAttempts.delete(connectionKey);
        this.connections.set(connectionKey, connection);
        this.emit('connected', device);
        
        if (!isResolved) {
          isResolved = true;
          resolve(connection);
        }
      });

      socket.on('error', (error) => {
        console.error(`❌ 设备 ${device.name} 连接错误:`, error.message);
        this.emit('connectionError', device, error);
        
        connection.connected = false;
        
        if (!isResolved) {
          isResolved = true;
          reject(error);
        }
      });

      socket.on('close', (hadError) => {
        console.log(`🔌 设备 ${device.name} 连接关闭${hadError ? ' (有错误)' : ''}`);
        connection.connected = false;
        this.emit('disconnected', device);
        
        if (!isResolved) {
          isResolved = true;
          reject(new Error('Connection closed'));
        }
        
        this._scheduleReconnect(device);
      });

      socket.setTimeout(10000, () => {
        console.warn(`⏱️  设备 ${device.name} 连接超时`);
        socket.destroy();
      });

      const options = {
        host: device.ip,
        port: device.port,
        timeout: 5000
      };

      socket.connect(options);
    });
  }

  _scheduleReconnect(device) {
    const connectionKey = device.id;
    const attempts = this.reconnectAttempts.get(connectionKey) || 0;

    if (attempts >= this.maxReconnectAttempts) {
      console.error(`⛔ 设备 ${device.name} 达到最大重连次数 (${this.maxReconnectAttempts})，停止重连`);
      this.reconnectAttempts.delete(connectionKey);
      this._cleanupConnection(connectionKey);
      return;
    }

    this.reconnectAttempts.set(connectionKey, attempts + 1);
    
    this._cleanupConnection(connectionKey);
    
    setTimeout(async () => {
      console.log(`🔄 正在重连设备 ${device.name} (尝试 ${attempts + 1}/${this.maxReconnectAttempts})`);
      try {
        await this._createConnection(device);
        console.log(`✅ 设备 ${device.name} 重连成功`);
      } catch (error) {
        console.error(`❌ 设备 ${device.name} 重连失败:`, error.message);
      }
    }, this.reconnectDelay);
  }

  _cleanupConnection(connectionKey) {
    const connection = this.connections.get(connectionKey);
    if (connection) {
      try {
        connection.socket.removeAllListeners();
        connection.socket.destroy();
      } catch (e) {
      }
      this.connections.delete(connectionKey);
    }
  }

  async disconnect(deviceId) {
    const connection = this.connections.get(deviceId);
    
    if (connection) {
      this.reconnectAttempts.delete(deviceId);
      this._cleanupConnection(deviceId);
      console.log(`🔌 设备 ${connection.device.name} 已断开连接`);
    }
  }

  getConnection(deviceId) {
    return this.connections.get(deviceId);
  }

  isConnected(deviceId) {
    const connection = this.connections.get(deviceId);
    return connection && connection.connected;
  }

  async readHoldingRegisters(deviceId, address, quantity = 1) {
    const connection = this.getConnection(deviceId);
    
    if (!connection || !connection.connected) {
      const error = new Error('设备未连接');
      error.name = 'NotConnectedError';
      throw error;
    }

    try {
      const response = await connection.client.readHoldingRegisters(address, quantity);
      connection.lastActivity = Date.now();
      return response.response.body.values;
    } catch (error) {
      connection.lastActivity = Date.now();
      
      if (error.message && (error.message.includes('ECONNRESET') || 
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('Connection'))) {
        connection.connected = false;
      }
      
      throw error;
    }
  }

  getConnectionCount() {
    return this.connections.size;
  }

  getAllConnections() {
    return Array.from(this.connections.values());
  }

  async disconnectAll() {
    const disconnectPromises = [];
    
    for (const deviceId of this.connections.keys()) {
      disconnectPromises.push(this.disconnect(deviceId));
    }
    
    await Promise.all(disconnectPromises);
    console.log('所有连接已断开');
  }
}

module.exports = new ModbusConnectionPool();
