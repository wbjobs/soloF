const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' }
];

const PUBLIC_TURN_SERVERS = [
  {
    urls: ['turn:turn.bistri.com:80', 'turn:turn.bistri.com:3478'],
    username: 'homeo',
    credential: 'homeo'
  },
  {
    urls: 'turn:turn.anyfirewall.com:443?transport=tcp',
    username: 'webrtc',
    credential: 'webrtc'
  },
  {
    urls: 'turn:numb.viagenie.ca',
    username: 'webrtc@live.com',
    credential: 'muazkh'
  },
  {
    urls: 'turn:192.158.29.39:3478?transport=udp',
    username: '28224511:1379330808',
    credential: 'JZEOEt2V3Qb0y27GRntt2u2PAYA='
  }
];

const DATA_CHANNEL_LABEL = 'config-sync';
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000;
const ICE_CONNECTION_TIMEOUT = 15000;
const ICE_GATHERING_TIMEOUT = 10000;
const CONNECTION_CHECK_INTERVAL = 2000;
const MAX_CONNECTION_CHECKS = 10;

class PeerConnection {
  constructor(nodeId, peerId, signaling, options = {}) {
    this.nodeId = nodeId;
    this.peerId = peerId;
    this.signaling = signaling;
    this.options = options;
    
    this.rtcPeerConnection = null;
    this.dataChannel = null;
    this.isInitiator = options.isInitiator || false;
    this.turnServers = options.turnServers || PUBLIC_TURN_SERVERS;
    this.currentTurnIndex = 0;
    
    this.connected = false;
    this.reconnectAttempts = 0;
    this.iceGatheringComplete = false;
    this.iceConnectionFailed = false;
    
    this.messageQueue = [];
    this.messageHandlers = new Set();
    this.stateHandlers = new Set();
    
    this.iceCandidates = [];
    this.remoteCandidates = [];
    this.remoteDescriptionSet = false;
    
    this.connectionCheckTimer = null;
    this.connectionCheckCount = 0;
    this.iceGatheringTimer = null;
    this.iceConnectionTimer = null;
    
    this._setupEventListeners();
  }

  _setupEventListeners() {
    this.signaling.on('offer', (data) => {
      if (data.fromId === this.peerId && !this.isInitiator) {
        this._handleOffer(data.offer, data.fromId);
      }
    });

    this.signaling.on('answer', (data) => {
      if (data.fromId === this.peerId) {
        this._handleAnswer(data.answer);
      }
    });

    this.signaling.on('ice-candidate', (data) => {
      if (data.fromId === this.peerId) {
        this._handleIceCandidate(data.candidate);
      }
    });

    this.signaling.on('ice-candidates-batch', (data) => {
      if (data.fromId === this.peerId && data.candidates) {
        data.candidates.forEach(candidate => {
          this._handleIceCandidate(candidate);
        });
      }
    });
  }

  _getIceServers(useTurn = false) {
    const servers = [...DEFAULT_ICE_SERVERS];
    
    if (useTurn && this.turnServers.length > 0) {
      const turnServer = this.turnServers[this.currentTurnIndex % this.turnServers.length];
      servers.push(turnServer);
      console.log(`使用 TURN 服务器: ${turnServer.urls}`);
    }
    
    return servers;
  }

  async connect() {
    try {
      this._clearConnectionTimers();
      this.iceConnectionFailed = false;
      this.iceGatheringComplete = false;
      
      const useTurn = this.reconnectAttempts > 1;
      if (useTurn) {
        this.currentTurnIndex = Math.floor((this.reconnectAttempts - 2) / 2) % this.turnServers.length;
      }
      
      const iceServers = this._getIceServers(useTurn);
      
      this.rtcPeerConnection = new RTCPeerConnection({
        iceServers: iceServers,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      });

      this.rtcPeerConnection.onicecandidate = (event) => {
        this._handleLocalIceCandidate(event);
      };

      this.rtcPeerConnection.onicecandidateerror = (event) => {
        console.warn(`ICE 候选错误 ${this.peerId.substring(0, 8)}:`, event.errorCode, event.errorText);
      };

      this.rtcPeerConnection.onicegatheringstatechange = () => {
        this._handleIceGatheringStateChange();
      };

      this.rtcPeerConnection.oniceconnectionstatechange = () => {
        this._handleIceConnectionStateChange();
      };

      this.rtcPeerConnection.onconnectionstatechange = () => {
        this._handleConnectionStateChange();
      };

      this.rtcPeerConnection.onsignalingstatechange = () => {
        this._handleSignalingStateChange();
      };

      this.rtcPeerConnection.ondatachannel = (event) => {
        this._setupDataChannel(event.channel);
      };

      if (this.isInitiator) {
        this.dataChannel = this.rtcPeerConnection.createDataChannel(DATA_CHANNEL_LABEL, {
          ordered: true,
          reliable: true,
          negotiated: false
        });
        this._setupDataChannel(this.dataChannel);
        
        this._startIceGatheringTimer();
        
        const offer = await this.rtcPeerConnection.createOffer({
          offerToReceiveAudio: false,
          offerToReceiveVideo: false,
          iceRestart: this.reconnectAttempts > 0
        });
        await this.rtcPeerConnection.setLocalDescription(offer);
        
        this._waitForIceGatheringComplete().then(() => {
          this.signaling.send({
            type: 'offer',
            targetId: this.peerId,
            offer: this.rtcPeerConnection.localDescription.toJSON(),
            iceCandidates: this.iceCandidates,
            turnSupported: true
          });
        });

        this._startIceConnectionTimer();
      }
    } catch (error) {
      console.error(`连接 ${this.peerId.substring(0, 8)} 失败:`, error);
      this._attemptReconnect();
    }
  }

  _handleLocalIceCandidate(event) {
    if (event.candidate) {
      const candidate = event.candidate.toJSON();
      this.iceCandidates.push(candidate);
      
      if (this.remoteDescriptionSet) {
        this.signaling.send({
          type: 'ice-candidate',
          targetId: this.peerId,
          candidate: candidate
        });
      }
    }
  }

  _waitForIceGatheringComplete() {
    return new Promise((resolve) => {
      if (this.iceGatheringComplete || this.rtcPeerConnection.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const checkState = () => {
        if (this.iceGatheringComplete || !this.rtcPeerConnection || 
            this.rtcPeerConnection.iceGatheringState === 'complete') {
          resolve();
        } else {
          setTimeout(checkState, 100);
        }
      };
      
      setTimeout(checkState, 100);
      
      setTimeout(() => {
        this.iceGatheringComplete = true;
        resolve();
      }, ICE_GATHERING_TIMEOUT);
    });
  }

  _startIceGatheringTimer() {
    this.iceGatheringTimer = setTimeout(() => {
      if (!this.iceGatheringComplete) {
        console.log(`ICE 收集超时 ${this.peerId.substring(0, 8)}，使用当前候选`);
        this.iceGatheringComplete = true;
      }
    }, ICE_GATHERING_TIMEOUT);
  }

  _startIceConnectionTimer() {
    this._clearIceConnectionTimer();
    
    this.iceConnectionTimer = setTimeout(() => {
      if (!this.connected && !this.iceConnectionFailed) {
        console.log(`ICE 连接超时 ${this.peerId.substring(0, 8)}，尝试回退`);
        this.iceConnectionFailed = true;
        this._attemptReconnect();
      }
    }, ICE_CONNECTION_TIMEOUT);
  }

  _clearIceConnectionTimer() {
    if (this.iceConnectionTimer) {
      clearTimeout(this.iceConnectionTimer);
      this.iceConnectionTimer = null;
    }
  }

  _clearConnectionTimers() {
    if (this.iceGatheringTimer) {
      clearTimeout(this.iceGatheringTimer);
      this.iceGatheringTimer = null;
    }
    
    this._clearIceConnectionTimer();
    
    if (this.connectionCheckTimer) {
      clearInterval(this.connectionCheckTimer);
      this.connectionCheckTimer = null;
    }
    
    this.connectionCheckCount = 0;
  }

  _handleIceGatheringStateChange() {
    const state = this.rtcPeerConnection?.iceGatheringState;
    console.log(`ICE 收集状态 ${this.peerId.substring(0, 8)}: ${state}`);
    
    if (state === 'complete') {
      this.iceGatheringComplete = true;
      
      if (this.isInitiator && this.iceCandidates.length > 0 && this.remoteDescriptionSet) {
        this.signaling.send({
          type: 'ice-candidates-batch',
          targetId: this.peerId,
          candidates: this.iceCandidates
        });
      }
    }
  }

  async _handleOffer(offer, fromId) {
    try {
      this._clearConnectionTimers();
      this.iceConnectionFailed = false;
      this.iceGatheringComplete = false;
      
      const useTurn = this.reconnectAttempts > 1 || offer.turnSupported;
      if (useTurn) {
        this.currentTurnIndex = Math.floor((this.reconnectAttempts - 2) / 2) % this.turnServers.length;
      }
      
      const iceServers = this._getIceServers(useTurn);
      
      if (!this.rtcPeerConnection) {
        this.rtcPeerConnection = new RTCPeerConnection({
          iceServers: iceServers,
          iceTransportPolicy: 'all',
          bundlePolicy: 'max-bundle',
          rtcpMuxPolicy: 'require'
        });

        this.rtcPeerConnection.onicecandidate = (event) => {
          this._handleLocalIceCandidate(event);
        };

        this.rtcPeerConnection.onicecandidateerror = (event) => {
          console.warn(`ICE 候选错误 ${this.peerId.substring(0, 8)}:`, event.errorCode, event.errorText);
        };

        this.rtcPeerConnection.onicegatheringstatechange = () => {
          this._handleIceGatheringStateChange();
        };

        this.rtcPeerConnection.oniceconnectionstatechange = () => {
          this._handleIceConnectionStateChange();
        };

        this.rtcPeerConnection.onconnectionstatechange = () => {
          this._handleConnectionStateChange();
        };

        this.rtcPeerConnection.onsignalingstatechange = () => {
          this._handleSignalingStateChange();
        };

        this.rtcPeerConnection.ondatachannel = (event) => {
          this._setupDataChannel(event.channel);
        };
      }

      await this.rtcPeerConnection.setRemoteDescription(
        new RTCSessionDescription(offer)
      );
      this.remoteDescriptionSet = true;

      if (offer.iceCandidates) {
        for (const candidate of offer.iceCandidates) {
          try {
            await this.rtcPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (error) {
            console.warn(`添加初始 ICE 候选失败:`, error);
          }
        }
      }

      this._startIceGatheringTimer();
      
      const answer = await this.rtcPeerConnection.createAnswer();
      await this.rtcPeerConnection.setLocalDescription(answer);

      this._waitForIceGatheringComplete().then(() => {
        this.signaling.send({
          type: 'answer',
          targetId: fromId,
          answer: this.rtcPeerConnection.localDescription.toJSON(),
          iceCandidates: this.iceCandidates
        });
      });

      this._startIceConnectionTimer();
      
    } catch (error) {
      console.error(`处理来自 ${fromId.substring(0, 8)} 的 offer 失败:`, error);
    }
  }

  async _handleAnswer(answer) {
    try {
      if (this.rtcPeerConnection && this.rtcPeerConnection.signalingState !== 'stable') {
        await this.rtcPeerConnection.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
        this.remoteDescriptionSet = true;

        if (answer.iceCandidates) {
          for (const candidate of answer.iceCandidates) {
            try {
              await this.rtcPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
              console.warn(`添加应答 ICE 候选失败:`, error);
            }
          }
        }

        for (const candidate of this.remoteCandidates) {
          try {
            await this.rtcPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (error) {
            console.warn(`添加缓冲的 ICE 候选失败:`, error);
          }
        }
        this.remoteCandidates = [];
      }
    } catch (error) {
      console.error(`处理来自 ${this.peerId.substring(0, 8)} 的 answer 失败:`, error);
    }
  }

  async _handleIceCandidate(candidate) {
    try {
      if (this.rtcPeerConnection && this.remoteDescriptionSet) {
        await this.rtcPeerConnection.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } else {
        this.remoteCandidates.push(candidate);
      }
    } catch (error) {
      console.warn(`添加 ICE 候选失败:`, error);
    }
  }

  _setupDataChannel(channel) {
    if (this.dataChannel && this.dataChannel !== channel) {
      this.dataChannel.onopen = null;
      this.dataChannel.onmessage = null;
      this.dataChannel.onclose = null;
      this.dataChannel.onerror = null;
    }

    this.dataChannel = channel;
    
    this.dataChannel.onopen = () => {
      console.log(`数据通道已开启: ${this.peerId.substring(0, 8)}`);
      this.connected = true;
      this.reconnectAttempts = 0;
      this.currentTurnIndex = 0;
      this.iceConnectionFailed = false;
      this._clearConnectionTimers();
      this._notifyStateChange('connected');
      this._flushMessageQueue();
    };

    this.dataChannel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.messageHandlers.forEach(handler => handler(data, this.peerId));
      } catch (error) {
        console.error('消息解析失败:', error);
      }
    };

    this.dataChannel.onclose = () => {
      console.log(`数据通道已关闭: ${this.peerId.substring(0, 8)}`);
      this.connected = false;
      this._notifyStateChange('disconnected');
      this._attemptReconnect();
    };

    this.dataChannel.onerror = (error) => {
      console.error(`数据通道错误 ${this.peerId.substring(0, 8)}:`, error);
    };
  }

  _handleIceConnectionStateChange() {
    const state = this.rtcPeerConnection?.iceConnectionState;
    console.log(`ICE 连接状态 ${this.peerId.substring(0, 8)}: ${state}`);
    
    switch (state) {
      case 'new':
      case 'checking':
        break;
      case 'connected':
      case 'completed':
        this.connected = true;
        this.iceConnectionFailed = false;
        this._clearIceConnectionTimer();
        this._notifyStateChange('connected');
        this._startConnectionCheck();
        break;
      case 'disconnected':
        this.connected = false;
        this._notifyStateChange('disconnected');
        this._attemptReconnect();
        break;
      case 'failed':
        this.connected = false;
        this.iceConnectionFailed = true;
        this._notifyStateChange('disconnected');
        this._attemptReconnect();
        break;
      case 'closed':
        this.connected = false;
        this._notifyStateChange('disconnected');
        break;
    }
  }

  _handleConnectionStateChange() {
    const state = this.rtcPeerConnection?.connectionState;
    console.log(`连接状态 ${this.peerId.substring(0, 8)}: ${state}`);
    
    switch (state) {
      case 'connecting':
        break;
      case 'connected':
        this.connected = true;
        this._notifyStateChange('connected');
        break;
      case 'disconnected':
      case 'failed':
        this.connected = false;
        this._notifyStateChange('disconnected');
        if (state === 'failed') {
          this._attemptReconnect();
        }
        break;
      case 'closed':
        this.connected = false;
        this._notifyStateChange('disconnected');
        break;
    }
  }

  _handleSignalingStateChange() {
    const state = this.rtcPeerConnection?.signalingState;
    console.log(`信令状态 ${this.peerId.substring(0, 8)}: ${state}`);
  }

  _startConnectionCheck() {
    if (this.connectionCheckTimer) {
      clearInterval(this.connectionCheckTimer);
    }
    
    this.connectionCheckCount = 0;
    this.connectionCheckTimer = setInterval(() => {
      this.connectionCheckCount++;
      
      if (this.connectionCheckCount >= MAX_CONNECTION_CHECKS) {
        clearInterval(this.connectionCheckTimer);
        this.connectionCheckTimer = null;
        return;
      }
      
      const stats = this.rtcPeerConnection?.getStats();
      if (stats) {
        stats.then((report) => {
          let hasConnection = false;
          report.forEach((stat) => {
            if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
              hasConnection = true;
            }
          });
          
          if (!hasConnection && this.connected) {
            console.warn(`连接检查失败 ${this.peerId.substring(0, 8)}`);
          }
        }).catch(() => {});
      }
    }, CONNECTION_CHECK_INTERVAL);
  }

  _attemptReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log(`达到最大重连次数: ${this.peerId.substring(0, 8)}`);
      this._notifyStateChange('failed');
      this._clearConnectionTimers();
      return;
    }

    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY * Math.pow(1.5, this.reconnectAttempts - 1);
    
    console.log(`尝试重连 (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}): ${this.peerId.substring(0, 8)}，延迟: ${delay}ms`);
    
    if (this.reconnectAttempts > 1) {
      console.log(`尝试使用 TURN 中继 (服务器: ${this.currentTurnIndex + 1}/${this.turnServers.length})`);
    }
    
    setTimeout(() => {
      this._cleanup();
      this.connect();
    }, delay);
  }

  _cleanup() {
    this._clearConnectionTimers();
    this.remoteCandidates = [];
    this.iceCandidates = [];
    this.remoteDescriptionSet = false;

    if (this.dataChannel) {
      try {
        this.dataChannel.onopen = null;
        this.dataChannel.onmessage = null;
        this.dataChannel.onclose = null;
        this.dataChannel.onerror = null;
        this.dataChannel.close();
      } catch (error) {
        console.warn('关闭数据通道失败:', error);
      }
      this.dataChannel = null;
    }
    
    if (this.rtcPeerConnection) {
      try {
        this.rtcPeerConnection.onicecandidate = null;
        this.rtcPeerConnection.onicecandidateerror = null;
        this.rtcPeerConnection.onicegatheringstatechange = null;
        this.rtcPeerConnection.oniceconnectionstatechange = null;
        this.rtcPeerConnection.onconnectionstatechange = null;
        this.rtcPeerConnection.onsignalingstatechange = null;
        this.rtcPeerConnection.ondatachannel = null;
        this.rtcPeerConnection.close();
      } catch (error) {
        console.warn('关闭 PeerConnection 失败:', error);
      }
      this.rtcPeerConnection = null;
    }
    
    this.connected = false;
  }

  _flushMessageQueue() {
    while (this.messageQueue.length > 0 && this.connected) {
      const message = this.messageQueue.shift();
      this.send(message);
    }
  }

  send(data) {
    if (this.connected && this.dataChannel?.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify(data));
        return true;
      } catch (error) {
        console.error('发送消息失败:', error);
        this.messageQueue.push(data);
        return false;
      }
    } else {
      this.messageQueue.push(data);
      return false;
    }
  }

  onMessage(handler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler) {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  _notifyStateChange(state) {
    this.stateHandlers.forEach(handler => handler(state, this.peerId));
  }

  disconnect() {
    this._cleanup();
    this.messageHandlers.clear();
    this.stateHandlers.clear();
  }

  get isConnected() {
    return this.connected;
  }

  static setTurnServers(servers) {
    if (Array.isArray(servers) && servers.length > 0) {
      PUBLIC_TURN_SERVERS.length = 0;
      PUBLIC_TURN_SERVERS.push(...servers);
    }
  }

  static getDefaultIceServers() {
    return [...DEFAULT_ICE_SERVERS];
  }

  static getTurnServers() {
    return [...PUBLIC_TURN_SERVERS];
  }
}

export default PeerConnection;
