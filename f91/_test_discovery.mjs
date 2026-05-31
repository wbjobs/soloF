const WS_RECONNECT_BASE = 800;
const WS_RECONNECT_MAX = 8000;

export class DiscoveryClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.peerId = null;
    this.roomId = null;
    this.name = null;
    this.relayOn = false;
    this._reconnectTimer = null;
    this._attempts = 0;
    this._pending = [];
    this._manualClose = false;

    this.onOpen = null;
    this.onClose = null;
    this.onError = null;
    this.onRoomCreated = null;
    this.onRoomJoined = null;
    this.onPeerJoined = null;
    this.onPeerLeft = null;
    this.onSignal = null;
    this.onRelay = null;
    this.onRelayEnabled = null;
  }

  connect() {
    this._manualClose = false;
    this._connect();
  }

  _connect() {
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.connected = true;
      this._attempts = 0;
      while (this._pending.length) {
        const m = this._pending.shift();
        try { this.ws.send(JSON.stringify(m)); } catch {}
      }
      if (this.onOpen) this.onOpen();
    };

    this.ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      this._handle(msg);
    };

    this.ws.onerror = () => {
      if (this.onError) this.onError();
    };

    this.ws.onclose = () => {
      this.connected = false;
      if (this.onClose) this.onClose();
      if (!this._manualClose) this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    if (this._manualClose) return;
    this._attempts += 1;
    const delay = Math.min(WS_RECONNECT_MAX, WS_RECONNECT_BASE * Math.pow(2, this._attempts - 1));
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  _send(msg) {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(data);
    } else {
      this._pending.push(msg);
    }
  }

  _handle(msg) {
    switch (msg.type) {
      case 'room-created':
        this.roomId = msg.roomId;
        this.peerId = msg.peerId;
        this.name = msg.name;
        if (this.onRoomCreated) this.onRoomCreated(msg);
        break;
      case 'room-joined':
        this.roomId = msg.roomId;
        this.peerId = msg.peerId;
        this.name = msg.name;
        this.relayOn = !!msg.relayOn;
        if (this.onRoomJoined) this.onRoomJoined(msg);
        break;
      case 'peer-joined':
        if (this.onPeerJoined) this.onPeerJoined(msg);
        break;
      case 'peer-left':
        if (this.onPeerLeft) this.onPeerLeft(msg);
        break;
      case 'signal':
        if (this.onSignal) this.onSignal(msg);
        break;
      case 'relay':
        if (this.onRelay) this.onRelay(msg);
        break;
      case 'relay-enabled':
        this.relayOn = true;
        if (this.onRelayEnabled) this.onRelayEnabled(msg);
        break;
      case 'error':
        if (this.onError) this.onError(msg.error);
        break;
    }
  }

  createRoom(name) {
    this._send({ type: 'create-room', name });
  }

  joinRoom(roomId, name) {
    this._send({ type: 'join-room', roomId, name });
  }

  sendSignal(to, data) {
    this._send({ type: 'signal', to, data });
  }

  requestRelay() {
    this._send({ type: 'request-relay' });
  }

  sendRelay(payload) {
    this._send({ type: 'relay', payload });
  }

  close() {
    this._manualClose = true;
    clearTimeout(this._reconnectTimer);
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }
}
