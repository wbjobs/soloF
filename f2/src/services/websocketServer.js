const WebSocket = require('ws');
const config = require('../config');
const dataCollector = require('./dataCollector');

class WebSocketServer {
  constructor() {
    this.wss = null;
    this.clients = new Set();
  }

  start(server) {
    this.wss = new WebSocket.Server({ server });

    this.wss.on('connection', (ws) => {
      console.log('WebSocket 客户端已连接');
      this.clients.add(ws);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleClientMessage(ws, data);
        } catch (error) {
          console.error('解析客户端消息失败:', error.message);
        }
      });

      ws.on('close', () => {
        console.log('WebSocket 客户端已断开');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket 错误:', error.message);
      });
    });

    dataCollector.on('dataCollected', (data) => {
      this.broadcast({
        type: 'sensorData',
        data: data
      });
    });

    dataCollector.on('alert', (data) => {
      this.broadcast({
        type: 'alert',
        data: data
      });
    });

    console.log(`WebSocket 服务已启动，端口: ${config.port}`);
  }

  handleClientMessage(ws, message) {
    switch (message.action) {
      case 'subscribe':
        console.log('客户端订阅:', message.topics);
        break;
      case 'unsubscribe':
        console.log('客户端取消订阅:', message.topics);
        break;
      default:
        console.log('未知操作:', message.action);
    }
  }

  broadcast(message) {
    const messageStr = JSON.stringify(message);
    
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageStr);
        } catch (error) {
          console.error('发送消息失败:', error.message);
        }
      }
    }
  }

  sendToClient(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  getClientCount() {
    return this.clients.size;
  }

  stop() {
    if (this.wss) {
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();
      this.wss.close();
      console.log('WebSocket 服务已停止');
    }
  }
}

module.exports = new WebSocketServer();
