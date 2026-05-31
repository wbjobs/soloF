import VectorClock from './VectorClock';
import { Operation, OperationalTransform } from './OT';
import ConfigStore from './ConfigStore';
import SignalingClient from './SignalingClient';
import PeerConnection from './PeerConnection';
import CryptoManager from './CryptoManager';
import { v4 as uuidv4 } from 'uuid';

const SYNC_INTERVAL = 5000;
const HEARTBEAT_INTERVAL = 10000;
const MAX_PENDING_OPS = 100;
const OFFLINE_THRESHOLD = 30000;
const OFFLINE_CHECK_INTERVAL = 5000;
const ENCRYPTION_ENABLED = true;

class NodeManager {
  constructor(signalingUrl) {
    this.nodeId = uuidv4();
    this.signalingUrl = signalingUrl;
    
    this.config = {};
    this.vectorClock = new VectorClock();
    this.pendingOperations = [];
    
    this.connections = new Map();
    this.peerStates = new Map();
    this.peerPublicKeys = new Map();
    this.lastHeartbeatTimestamps = new Map();
    
    this.signaling = null;
    this.configStore = null;
    this.crypto = null;
    
    this.syncTimer = null;
    this.heartbeatTimer = null;
    this.offlineCheckTimer = null;
    
    this.eventHandlers = new Map();
    
    this.isInitialized = false;
  }

  async init() {
    try {
      this.crypto = new CryptoManager(this.nodeId);
      const cryptoInitSuccess = await this.crypto.init();
      if (!cryptoInitSuccess) {
        console.warn('加密模块初始化失败，将使用未加密模式');
      }

      this.configStore = new ConfigStore(`config-db-${this.nodeId.substring(0, 8)}`);
      await this.configStore.init();

      const { config, vectorClock } = await this.configStore.getLatestConfig();
      this.config = config || {};
      this.vectorClock = vectorClock || new VectorClock();

      this.signaling = new SignalingClient(this.signalingUrl, this.nodeId);
      await this.signaling.connect();

      this._setupSignalingHandlers();
      this._startSyncLoop();
      this._startHeartbeat();
      this._startOfflineCheck();

      this.isInitialized = true;
      console.log(`节点 ${this.nodeId.substring(0, 8)} 初始化完成`);
      this._emit('initialized', { 
        nodeId: this.nodeId, 
        config: this.config,
        encryptionEnabled: cryptoInitSuccess
      });

      return true;
    } catch (error) {
      console.error('节点初始化失败:', error);
      this._emit('error', error);
      return false;
    }
  }

  _setupSignalingHandlers() {
    this.signaling.on('connected', () => {
      this._emit('signaling-connected');
      
      this.signaling.send({
        type: 'broadcast-presence',
        metadata: {
          publicKey: this.crypto?.getPublicKey(),
          publicKeyFingerprint: this.crypto?.generateKeyFingerprint(),
          encryptionEnabled: ENCRYPTION_ENABLED
        }
      });
    });

    this.signaling.on('peer-presence', async (data) => {
      const { nodeId, metadata } = data;
      if (nodeId !== this.nodeId) {
        this._handlePeerPresence(data, nodeId);
        
        if (metadata?.publicKey && this.crypto) {
          const success = await this.crypto.setPeerPublicKey(nodeId, metadata.publicKey);
          if (success) {
            console.log(`已获取节点 ${nodeId.substring(0, 8)} 的公钥`);
            this.peerPublicKeys.set(nodeId, {
              key: metadata.publicKey,
              fingerprint: metadata.publicKeyFingerprint,
              encryptionEnabled: metadata.encryptionEnabled
            });
          }
        }
      }
    });

    this.signaling.on('node-joined', (data) => {
      console.log(`新节点加入: ${data.nodeId.substring(0, 8)}`);
      
      if (this.crypto && this.crypto.isInitialized) {
        this.signaling.send({
          type: 'broadcast-presence',
          metadata: {
            publicKey: this.crypto.getPublicKey(),
            publicKeyFingerprint: this.crypto.generateKeyFingerprint(),
            encryptionEnabled: ENCRYPTION_ENABLED,
            targetId: data.nodeId
          }
        });
      }
      
      this._emit('node-joined', data);
    });

    this.signaling.on('node-left', (data) => {
      console.log(`节点离开: ${data.nodeId.substring(0, 8)}`);
      this._removeConnection(data.nodeId);
      this._emit('node-left', data);
    });

    this.signaling.on('peer-list', (data) => {
      this._connectToPeers(data.peers);
    });

    this.signaling.on('heartbeat', (data) => {
      this._emit('heartbeat', data);
    });

    this.signaling.on('error', (data) => {
      console.error('信令服务器错误:', data.message);
      this._emit('error', data);
    });
  }

  async _connectToPeers(peers) {
    for (const peer of peers) {
      if (!this.connections.has(peer.id) && peer.id !== this.nodeId) {
        await this._createConnection(peer.id, true);
      }
    }
  }

  async _createConnection(peerId, isInitiator) {
    const connection = new PeerConnection(this.nodeId, peerId, this.signaling, {
      isInitiator
    });

    connection.onMessage(async (data, fromId) => {
      await this._handlePeerMessage(data, fromId);
    });

    connection.onStateChange((state, peerId) => {
      this._emit('connection-state', { peerId, state });
      
      if (state === 'connected') {
        this.peerStates.set(peerId, { connected: true, connectedAt: Date.now() });
        this.lastHeartbeatTimestamps.set(peerId, Date.now());
        
        this._exchangePublicKeys(peerId);
        
        setTimeout(() => {
          this._sendStateToPeer(peerId);
        }, 500);
      } else if (state === 'disconnected' || state === 'failed') {
        this.peerStates.set(peerId, { connected: false, disconnectedAt: Date.now() });
      }
    });

    this.connections.set(peerId, connection);
    await connection.connect();

    return connection;
  }

  async _exchangePublicKeys(peerId) {
    if (!this.crypto || !this.crypto.isInitialized) return;
    
    const myPublicKey = this.crypto.getPublicKey();
    
    this._sendMessage(peerId, {
      type: 'public-key-exchange',
      publicKey: myPublicKey,
      publicKeyFingerprint: await this.crypto.generateKeyFingerprint(),
      encryptionEnabled: ENCRYPTION_ENABLED
    });
  }

  async _handlePeerMessage(data, fromId) {
    switch (data.type) {
      case 'public-key-exchange':
        await this._handlePublicKeyExchange(data, fromId);
        break;
      case 'state-sync':
        await this._handleStateSync(data, fromId);
        break;
      case 'operation':
        await this._handleRemoteOperation(data, fromId);
        break;
      case 'encrypted-operation':
        await this._handleEncryptedOperation(data, fromId);
        break;
      case 'config-request':
        this._handleConfigRequest(fromId);
        break;
      case 'config-response':
        await this._handleConfigResponse(data, fromId);
        break;
      case 'encrypted-config-response':
        await this._handleEncryptedConfigResponse(data, fromId);
        break;
      case 'heartbeat':
        this._handlePeerHeartbeat(data, fromId);
        break;
      case 'presence':
        this._handlePeerPresence(data, fromId);
        break;
      default:
        console.log(`未知消息类型: ${data.type}`);
    }
  }

  async _handlePublicKeyExchange(data, fromId) {
    if (!this.crypto || !data.publicKey) return;
    
    const success = await this.crypto.setPeerPublicKey(fromId, data.publicKey);
    if (success) {
      console.log(`已与节点 ${fromId.substring(0, 8)} 完成公钥交换`);
      this.peerPublicKeys.set(fromId, {
        key: data.publicKey,
        fingerprint: data.publicKeyFingerprint,
        encryptionEnabled: data.encryptionEnabled
      });
      this._emit('key-exchange-completed', { peerId: fromId });
    }
  }

  _canEncryptToPeer(peerId) {
    return this.crypto?.isInitialized && this.crypto.hasPeerPublicKey(peerId);
  }

  async setConfig(key, value) {
    if (!this.isInitialized) {
      throw new Error('节点未初始化');
    }

    const oldValue = this.config[key];
    
    this.vectorClock.increment(this.nodeId);
    const operation = Operation.set(key, value, oldValue, this.vectorClock.clone());
    
    this.config = operation.apply(this.config);
    this.pendingOperations.push(operation);

    if (this.pendingOperations.length > MAX_PENDING_OPS) {
      await this._flushPendingOperations();
    }

    await this.configStore.saveConfig(this.config, this.vectorClock, this.nodeId);
    await this.configStore.saveOperation(operation, this.nodeId);

    await this._broadcastOperation(operation);
    this._emit('config-changed', { key, value, oldValue, config: this.config });

    return operation;
  }

  async deleteConfig(key) {
    if (!this.isInitialized) {
      throw new Error('节点未初始化');
    }

    if (!(key in this.config)) {
      return null;
    }

    const oldValue = this.config[key];
    
    this.vectorClock.increment(this.nodeId);
    const operation = Operation.delete(key, oldValue, this.vectorClock.clone());
    
    this.config = operation.apply(this.config);
    this.pendingOperations.push(operation);

    if (this.pendingOperations.length > MAX_PENDING_OPS) {
      await this._flushPendingOperations();
    }

    await this.configStore.saveConfig(this.config, this.vectorClock, this.nodeId);
    await this.configStore.saveOperation(operation, this.nodeId);

    await this._broadcastOperation(operation);
    this._emit('config-changed', { key, value: undefined, oldValue, config: this.config });

    return operation;
  }

  async _broadcastOperation(operation) {
    const baseMessage = {
      operation: operation.toJSON(),
      vectorClock: this.vectorClock.toJSON(),
      timestamp: Date.now()
    };

    this.connections.forEach((connection, peerId) => {
      if (connection.isConnected) {
        if (this._canEncryptToPeer(peerId)) {
          this._sendEncryptedOperation(peerId, baseMessage);
        } else {
          connection.send({
            type: 'operation',
            ...baseMessage
          });
        }
      }
    });
  }

  async _sendEncryptedOperation(peerId, message) {
    try {
      const encryptedPayload = await this.crypto.encryptForPeer(peerId, message);
      
      const connection = this.connections.get(peerId);
      if (connection && connection.isConnected) {
        connection.send({
          type: 'encrypted-operation',
          encryptedPayload,
          fromId: this.nodeId,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error(`加密发送到 ${peerId.substring(0, 8)} 失败，使用明文:`, error);
      
      const connection = this.connections.get(peerId);
      if (connection && connection.isConnected) {
        connection.send({
          type: 'operation',
          ...message
        });
      }
    }
  }

  async _handleEncryptedOperation(data, fromId) {
    if (!this.crypto || !data.encryptedPayload) {
      console.warn(`无法解密来自 ${fromId.substring(0, 8)} 的消息`);
      return;
    }

    try {
      const decryptedMessage = await this.crypto.decryptFromPeer(fromId, data.encryptedPayload);
      
      const operation = Operation.fromJSON(decryptedMessage.operation);
      const remoteClock = VectorClock.fromJSON(decryptedMessage.vectorClock);

      if (this.vectorClock.isConcurrent(remoteClock)) {
        await this._handleConcurrentOperation(operation, remoteClock, fromId);
      } else if (remoteClock.isGreaterThan(this.vectorClock)) {
        await this._applyRemoteOperation(operation, remoteClock);
      }

      this._emit('remote-operation', { operation, fromId, encrypted: true });
    } catch (error) {
      console.error(`解密来自 ${fromId.substring(0, 8)} 的操作失败:`, error);
      this._emit('decryption-failed', { peerId: fromId, error: error.message });
    }
  }

  async _handleRemoteOperation(data, fromId) {
    const operation = Operation.fromJSON(data.operation);
    const remoteClock = VectorClock.fromJSON(data.vectorClock);

    if (this.vectorClock.isConcurrent(remoteClock)) {
      await this._handleConcurrentOperation(operation, remoteClock, fromId);
    } else if (remoteClock.isGreaterThan(this.vectorClock)) {
      await this._applyRemoteOperation(operation, remoteClock);
    }

    this._emit('remote-operation', { operation, fromId, encrypted: false });
  }

  async _handleConcurrentOperation(operation, remoteClock, fromId) {
    const localOps = this.pendingOperations.filter(op => 
      this.vectorClock.isConcurrent(op.version)
    );

    const remoteOps = [operation];

    const conflicts = OperationalTransform.detectConflicts(localOps, remoteOps);
    
    if (conflicts.length > 0) {
      const resolvedOps = conflicts.map(conflict => 
        OperationalTransform.resolveConflict(conflict, 'latest')
      );
      
      for (const resolvedOp of resolvedOps) {
        this.config = resolvedOp.apply(this.config);
      }
      
      this._emit('conflict-resolved', { conflicts, resolvedOps, fromId });
    } else {
      const { config, operations } = OperationalTransform.merge(
        this.config,
        localOps,
        remoteOps,
        this.vectorClock,
        remoteClock
      );
      
      this.config = config;
    }

    this.vectorClock = this.vectorClock.merge(remoteClock);
    
    await this.configStore.saveConfig(this.config, this.vectorClock, this.nodeId);
    await this.configStore.saveOperation(operation, fromId);

    this._emit('config-synced', { config: this.config, fromId });
  }

  async _applyRemoteOperation(operation, remoteClock) {
    this.config = operation.apply(this.config);
    this.vectorClock = this.vectorClock.merge(remoteClock);
    
    await this.configStore.saveConfig(this.config, this.vectorClock, this.nodeId);
    await this.configStore.saveOperation(operation, operation.nodeId || 'remote');
    
    this._emit('config-synced', { config: this.config });
  }

  async _handleStateSync(data, fromId) {
    const remoteClock = VectorClock.fromJSON(data.vectorClock);
    
    if (remoteClock.isGreaterThan(this.vectorClock)) {
      this._sendMessage(fromId, {
        type: 'config-request',
        sinceClock: this.vectorClock.toJSON()
      });
    } else if (this.vectorClock.isGreaterThan(remoteClock)) {
      await this._sendStateToPeer(fromId);
    }
  }

  _handleConfigRequest(fromId) {
    this._sendConfigResponse(fromId);
  }

  async _sendConfigResponse(toPeerId) {
    const configData = {
      config: this.config,
      vectorClock: this.vectorClock.toJSON(),
      timestamp: Date.now()
    };

    if (this._canEncryptToPeer(toPeerId)) {
      try {
        const encryptedPayload = await this.crypto.encryptForPeer(toPeerId, configData);
        
        this._sendMessage(toPeerId, {
          type: 'encrypted-config-response',
          encryptedPayload,
          fromId: this.nodeId
        });
        return;
      } catch (error) {
        console.error(`加密配置响应失败，使用明文:`, error);
      }
    }

    this._sendMessage(toPeerId, {
      type: 'config-response',
      ...configData
    });
  }

  async _handleConfigResponse(data, fromId) {
    const remoteClock = VectorClock.fromJSON(data.vectorClock);
    
    if (remoteClock.isGreaterThan(this.vectorClock)) {
      this.config = { ...data.config };
      this.vectorClock = remoteClock.clone();
      
      await this.configStore.saveConfig(this.config, this.vectorClock, this.nodeId);
      
      this._emit('config-synced', { config: this.config, fromId });
    }
  }

  async _handleEncryptedConfigResponse(data, fromId) {
    if (!this.crypto || !data.encryptedPayload) {
      return;
    }

    try {
      const decryptedData = await this.crypto.decryptFromPeer(fromId, data.encryptedPayload);
      const remoteClock = VectorClock.fromJSON(decryptedData.vectorClock);
      
      if (remoteClock.isGreaterThan(this.vectorClock)) {
        this.config = { ...decryptedData.config };
        this.vectorClock = remoteClock.clone();
        
        await this.configStore.saveConfig(this.config, this.vectorClock, this.nodeId);
        
        this._emit('config-synced', { config: this.config, fromId, encrypted: true });
      }
    } catch (error) {
      console.error(`解密配置响应失败:`, error);
      this._emit('decryption-failed', { peerId: fromId, error: error.message });
    }
  }

  _sendStateToPeer(peerId) {
    this._sendConfigResponse(peerId);
  }

  _handlePeerHeartbeat(data, fromId) {
    const now = Date.now();
    this.lastHeartbeatTimestamps.set(fromId, now);
    
    const state = this.peerStates.get(fromId) || {};
    this.peerStates.set(fromId, {
      ...state,
      connected: true,
      lastSeen: now,
      lastHeartbeat: data.timestamp
    });
  }

  _handlePeerPresence(data, fromId) {
    this._emit('peer-presence', { nodeId: fromId, ...data });
  }

  _sendMessage(peerId, message) {
    const connection = this.connections.get(peerId);
    if (connection && connection.isConnected) {
      connection.send(message);
      return true;
    }
    return false;
  }

  async _flushPendingOperations() {
    if (this.pendingOperations.length === 0) return;

    const snapshot = {
      id: `snapshot_${Date.now()}`,
      config: { ...this.config },
      vectorClock: this.vectorClock.toJSON(),
      operations: this.pendingOperations.map(op => op.toJSON()),
      timestamp: Date.now(),
      nodeId: this.nodeId
    };

    await this.configStore.saveHistory(snapshot);
    this.pendingOperations = [];
  }

  _startSyncLoop() {
    this.syncTimer = setInterval(() => {
      this._syncWithPeers();
    }, SYNC_INTERVAL);
  }

  _syncWithPeers() {
    this.connections.forEach((connection, peerId) => {
      if (connection.isConnected) {
        this._sendStateToPeer(peerId);
      }
    });
  }

  _startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      const heartbeat = {
        type: 'heartbeat',
        timestamp: Date.now(),
        nodeId: this.nodeId,
        vectorClock: this.vectorClock.toJSON(),
        configHash: this._generateConfigHash()
      };

      this.connections.forEach((connection) => {
        if (connection.isConnected) {
          connection.send(heartbeat);
        }
      });

      this._emit('node-heartbeat', {
        nodeId: this.nodeId,
        peerCount: this.getConnectedPeers().length,
        config: this.config
      });
    }, HEARTBEAT_INTERVAL);
  }

  _startOfflineCheck() {
    this.offlineCheckTimer = setInterval(() => {
      this._checkOfflineNodes();
    }, OFFLINE_CHECK_INTERVAL);
  }

  _checkOfflineNodes() {
    const now = Date.now();
    const offlineNodes = [];

    this.lastHeartbeatTimestamps.forEach((lastTime, peerId) => {
      const timeSinceLastHeartbeat = now - lastTime;
      
      if (timeSinceLastHeartbeat > OFFLINE_THRESHOLD) {
        offlineNodes.push({
          peerId,
          offlineDuration: timeSinceLastHeartbeat,
          lastSeen: lastTime
        });
      }
    });

    this.connections.forEach((connection, peerId) => {
      const lastHeartbeat = this.lastHeartbeatTimestamps.get(peerId) || 0;
      const timeSinceLastHeartbeat = now - lastHeartbeat;
      
      if (connection.isConnected && timeSinceLastHeartbeat > OFFLINE_THRESHOLD) {
        console.log(`节点 ${peerId.substring(0, 8)} 心跳超时 (${Math.round(timeSinceLastHeartbeat/1000)}秒)，将被移除`);
        this._emit('node-offline', {
          nodeId: peerId,
          offlineDuration: timeSinceLastHeartbeat
        });
        this._removeConnection(peerId);
      }
    });

    if (offlineNodes.length > 0) {
      this._emit('offline-nodes-detected', { offlineNodes, checkTime: now });
    }
  }

  _generateConfigHash() {
    const configStr = JSON.stringify(this.config);
    let hash = 0;
    for (let i = 0; i < configStr.length; i++) {
      const char = configStr.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  _removeConnection(peerId) {
    const connection = this.connections.get(peerId);
    if (connection) {
      connection.disconnect();
      this.connections.delete(peerId);
    }
    
    this.peerStates.delete(peerId);
    this.peerPublicKeys.delete(peerId);
    this.lastHeartbeatTimestamps.delete(peerId);
    
    if (this.crypto) {
      this.crypto.removePeerPublicKey(peerId);
    }
  }

  getConfig(key) {
    return key ? this.config[key] : { ...this.config };
  }

  getAllConfig() {
    return { ...this.config };
  }

  getVectorClock() {
    return this.vectorClock.clone();
  }

  getConnectedPeers() {
    const peers = [];
    this.connections.forEach((connection, peerId) => {
      if (connection.isConnected) {
        const state = this.peerStates.get(peerId) || {};
        const lastSeen = this.lastHeartbeatTimestamps.get(peerId);
        peers.push({
          id: peerId,
          state,
          lastSeen,
          hasPublicKey: this.crypto?.hasPeerPublicKey(peerId) || false
        });
      }
    });
    return peers;
  }

  getAllPeers() {
    const peers = [];
    this.connections.forEach((connection, peerId) => {
      const state = this.peerStates.get(peerId) || {};
      const lastSeen = this.lastHeartbeatTimestamps.get(peerId);
      peers.push({
        id: peerId,
        connected: connection.isConnected,
        state,
        lastSeen,
        hasPublicKey: this.crypto?.hasPeerPublicKey(peerId) || false
      });
    });
    return peers;
  }

  getOfflineThreshold() {
    return OFFLINE_THRESHOLD;
  }

  isEncryptionEnabled() {
    return this.crypto?.isInitialized || false;
  }

  getPeerPublicKeyInfo(peerId) {
    return this.peerPublicKeys.get(peerId) || null;
  }

  async getHistory(limit = 100) {
    return this.configStore.getHistory(limit);
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

  _emit(eventType, data) {
    this.eventHandlers.get(eventType)?.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`事件处理错误 [${eventType}]:`, error);
      }
    });
  }

  async destroy() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.offlineCheckTimer) {
      clearInterval(this.offlineCheckTimer);
      this.offlineCheckTimer = null;
    }

    this.connections.forEach((connection) => {
      connection.disconnect();
    });
    this.connections.clear();
    this.peerStates.clear();
    this.peerPublicKeys.clear();
    this.lastHeartbeatTimestamps.clear();

    if (this.signaling) {
      this.signaling.disconnect();
      this.signaling = null;
    }

    if (this.configStore) {
      this.configStore.close();
      this.configStore = null;
    }

    if (this.crypto) {
      this.crypto.destroy();
      this.crypto = null;
    }

    this.isInitialized = false;
    this.eventHandlers.clear();

    console.log(`节点 ${this.nodeId.substring(0, 8)} 已销毁`);
  }
}

export default NodeManager;
