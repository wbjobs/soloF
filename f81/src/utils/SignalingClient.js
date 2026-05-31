class SignalingClient {
  constructor(serverUrl, nodeId) {
    this.serverUrl = serverUrl;
    this.nodeId = nodeId;
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    
    this.eventHandlers = new Map();
    this.messageQueue = [];
    
    this._handleOpen = this._handleOpen.bind(this);
    this._handleMessage = this._handleMessage.bind(this);
    this._handleClose = this._handleClose.bind(this);
    this._handleError = this._handleError.bind(this);
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);
        
        this.ws.addEventListener('open', this._handleOpen);
        this.ws.addEventListener('message', this._handleMessage);
        this.ws.addEventListener('close', this._handleClose);
        this.ws.addEventListener('error', this._handleError);

        this.ws.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          console.log('信令服务器连接成功');
          this._emit('connected');
          this._flushMessageQueue();
          resolve();
        };

        this.ws.onerror = (error) => {
          console.error('信令服务器连接失败:', error);
          this._emit('error', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  _handleOpen() {
    this.connected = true;
  }

  _handleMessage(event) {
    try {
      const data = JSON.parse(event.data);
      this._emit(data.type, data);
    } catch (error) {
      console.error('信令消息解析失败:', error);
    }
  }

  _handleClose() {
    this.connected = false;
    console.log('信令服务器连接断开');
    this._emit('disconnected');
    this._attemptReconnect();
  }

  _handleError(error) {
    console.error('信令服务器错误:', error);
    this._emit('error', error);
  }

  _attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('达到最大重连次数');
      return;
    }

    this.reconnectAttempts++;
    console.log(`尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(() => {});
    }, 2000 * this.reconnectAttempts);
  }

  send(data) {
    const message = JSON.stringify(data);
    
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(message);
      return true;
    } else {
      this.messageQueue.push(data);
      return false;
    }
  }

  _flushMessageQueue() {
    while (this.messageQueue.length > 0 && this.connected) {
      const data = this.messageQueue.shift();
      this.send(data);
    }
  }

  on(eventType, handler) {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType).add(handler);
    
    return () => {
      this.eventHandlers.get(eventType)?.delete(handler);
    };
  }

  off(eventType, handler) {
    this.eventHandlers.get(eventType)?.delete(handler);
  }

  _emit(eventType, data) {
    this.eventHandlers.get(eventType)?.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`事件处理错误 [${eventType}]:`, error);
      }
    });
  }

  disconnect() {
    this._cleanup();
    this.eventHandlers.clear();
  }

  _cleanup() {
    if (this.ws) {
      this.ws.removeEventListener('open', this._handleOpen);
      this.ws.removeEventListener('message', this._handleMessage);
      this.ws.removeEventListener('close', this._handleClose);
      this.ws.removeEventListener('error', this._handleError);
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  get isConnected() {
    return this.connected;
  }
}

export default SignalingClient;
