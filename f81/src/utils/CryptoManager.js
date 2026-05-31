const ALGORITHM = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256'
};

const SYMMETRIC_ALGORITHM = {
  name: 'AES-GCM',
  length: 256
};

const KEY_WRAP_ALGORITHM = {
  name: 'AES-KW',
  length: 256
};

class CryptoManager {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.keyPair = null;
    this.publicKeyJwk = null;
    this.peerPublicKeys = new Map();
    this.symmetricKeys = new Map();
    this.isInitialized = false;
  }

  async init() {
    try {
      this.keyPair = await crypto.subtle.generateKey(
        ALGORITHM,
        true,
        ['encrypt', 'decrypt']
      );

      this.publicKeyJwk = await crypto.subtle.exportKey(
        'jwk',
        this.keyPair.publicKey
      );

      this.isInitialized = true;
      console.log(`加密模块初始化完成: ${this.nodeId.substring(0, 8)}`);
      return true;
    } catch (error) {
      console.error('加密模块初始化失败:', error);
      return false;
    }
  }

  getPublicKey() {
    if (!this.isInitialized) {
      throw new Error('加密模块未初始化');
    }
    return this.publicKeyJwk;
  }

  async setPeerPublicKey(peerId, publicKeyJwk) {
    try {
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        publicKeyJwk,
        ALGORITHM,
        true,
        ['encrypt']
      );
      
      this.peerPublicKeys.set(peerId, {
        jwk: publicKeyJwk,
        key: publicKey
      });
      
      return true;
    } catch (error) {
      console.error(`导入节点 ${peerId.substring(0, 8)} 公钥失败:`, error);
      return false;
    }
  }

  hasPeerPublicKey(peerId) {
    return this.peerPublicKeys.has(peerId);
  }

  removePeerPublicKey(peerId) {
    this.peerPublicKeys.delete(peerId);
    this.symmetricKeys.delete(peerId);
  }

  async encryptForPeer(peerId, data) {
    if (!this.peerPublicKeys.has(peerId)) {
      throw new Error(`未知节点公钥: ${peerId.substring(0, 8)}`);
    }

    const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(plaintext);

    const symmetricKey = await crypto.subtle.generateKey(
      SYMMETRIC_ALGORITHM,
      true,
      ['encrypt', 'decrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encryptedData = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      symmetricKey,
      dataBuffer
    );

    const peerPublicKey = this.peerPublicKeys.get(peerId).key;
    
    const exportedSymmetricKey = await crypto.subtle.exportKey('raw', symmetricKey);
    
    const encryptedKey = await crypto.subtle.encrypt(
      ALGORITHM,
      peerPublicKey,
      exportedSymmetricKey
    );

    return {
      encryptedKey: this._arrayBufferToBase64(encryptedKey),
      iv: this._arrayBufferToBase64(iv),
      encryptedData: this._arrayBufferToBase64(encryptedData)
    };
  }

  async decryptFromPeer(peerId, encryptedPayload) {
    if (!this.keyPair) {
      throw new Error('私钥不可用');
    }

    try {
      const encryptedKey = this._base64ToArrayBuffer(encryptedPayload.encryptedKey);
      const iv = this._base64ToArrayBuffer(encryptedPayload.iv);
      const encryptedData = this._base64ToArrayBuffer(encryptedPayload.encryptedData);

      const decryptedKeyBuffer = await crypto.subtle.decrypt(
        ALGORITHM,
        this.keyPair.privateKey,
        encryptedKey
      );

      const symmetricKey = await crypto.subtle.importKey(
        'raw',
        decryptedKeyBuffer,
        SYMMETRIC_ALGORITHM,
        true,
        ['decrypt']
      );

      const decryptedData = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        symmetricKey,
        encryptedData
      );

      const decoder = new TextDecoder();
      const plaintext = decoder.decode(decryptedData);

      try {
        return JSON.parse(plaintext);
      } catch {
        return plaintext;
      }
    } catch (error) {
      console.error(`解密来自 ${peerId.substring(0, 8)} 的消息失败:`, error);
      throw error;
    }
  }

  async encryptWithPublicKey(publicKeyJwk, data) {
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      ALGORITHM,
      true,
      ['encrypt']
    );

    const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(plaintext);

    const encrypted = await crypto.subtle.encrypt(
      ALGORITHM,
      publicKey,
      dataBuffer
    );

    return this._arrayBufferToBase64(encrypted);
  }

  async decryptWithPrivateKey(encryptedData) {
    if (!this.keyPair) {
      throw new Error('私钥不可用');
    }

    const dataBuffer = this._base64ToArrayBuffer(encryptedData);
    
    const decrypted = await crypto.subtle.decrypt(
      ALGORITHM,
      this.keyPair.privateKey,
      dataBuffer
    );

    const decoder = new TextDecoder();
    const plaintext = decoder.decode(decrypted);

    try {
      return JSON.parse(plaintext);
    } catch {
      return plaintext;
    }
  }

  async encryptConfig(config, peerIds) {
    const result = {};
    const configJson = JSON.stringify(config);
    
    for (const peerId of peerIds) {
      if (this.hasPeerPublicKey(peerId)) {
        result[peerId] = await this.encryptForPeer(peerId, configJson);
      }
    }
    
    return result;
  }

  async decryptConfig(encryptedConfig, fromPeerId) {
    const payload = encryptedConfig[fromPeerId];
    if (!payload) {
      throw new Error(`没有找到来自 ${fromPeerId.substring(0, 8)} 的加密配置`);
    }
    return this.decryptFromPeer(fromPeerId, payload);
  }

  sign(data) {
    const timestamp = Date.now();
    const nonce = crypto.randomUUID();
    const signature = this._generateSignature(data, timestamp, nonce);
    
    return {
      ...data,
      signature,
      timestamp,
      nonce
    };
  }

  verify(signedData, peerId) {
    const { signature, timestamp, nonce, ...data } = signedData;
    const expectedSignature = this._generateSignature(data, timestamp, nonce);
    
    if (signature !== expectedSignature) {
      return false;
    }
    
    const now = Date.now();
    if (now - timestamp > 300000) {
      console.warn(`消息已过期: ${peerId.substring(0, 8)}`);
      return false;
    }
    
    return true;
  }

  _generateSignature(data, timestamp, nonce) {
    const dataStr = JSON.stringify(data) + timestamp + nonce;
    let hash = 0;
    for (let i = 0; i < dataStr.length; i++) {
      const char = dataStr.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return btoa(String(hash) + this.nodeId);
  }

  async generateKeyFingerprint(publicKeyJwk = this.publicKeyJwk) {
    if (!publicKeyJwk) return null;
    
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(publicKeyJwk));
    const hash = await crypto.subtle.digest('SHA-256', data);
    
    return this._arrayBufferToBase64(hash);
  }

  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  _base64ToArrayBuffer(base64) {
    const binary_string = atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  }

  destroy() {
    this.keyPair = null;
    this.publicKeyJwk = null;
    this.peerPublicKeys.clear();
    this.symmetricKeys.clear();
    this.isInitialized = false;
  }

  static async generateKeyPair() {
    return crypto.subtle.generateKey(
      ALGORITHM,
      true,
      ['encrypt', 'decrypt']
    );
  }
}

export default CryptoManager;
