import { PeerConnection } from './peer.js';

export class MeshNetwork {
  constructor(discovery, crdt) {
    this.discovery = discovery;
    this.crdt = crdt;
    this.peers = new Map();
    this.relayMode = false;
    this._onPeerData = this._onPeerData.bind(this);
    this._onPeerOpen = this._onPeerOpen.bind(this);
    this._onPeerIceFailed = this._onPeerIceFailed.bind(this);
    this._onPeerState = this._onPeerState.bind(this);

    this.onPeerStateChange = null;
    this.onRelayModeChange = null;
  }

  hasAnyP2P() {
    for (const p of this.peers.values()) {
      if (p.reliable && p.reliable.readyState === 'open') return true;
    }
    return false;
  }

  addPeer(remotePeerId, { polite, initiator } = {}) {
    if (this.peers.has(remotePeerId)) return this.peers.get(remotePeerId);
    const peer = new PeerConnection(this.discovery.peerId, remotePeerId, this.discovery, { polite });
    if (initiator) peer.createChannels();
    peer.onData = (label, data) => this._onPeerData(remotePeerId, label, data);
    peer.onOpen = () => this._onPeerOpen(remotePeerId);
    peer.onIceFailed = () => this._onPeerIceFailed(remotePeerId);
    peer.onStateChange = (s) => this._onPeerState(remotePeerId, s);
    peer.startIceTimer();
    this.peers.set(remotePeerId, peer);
    this._notifyPeerState();
    return peer;
  }

  removePeer(remotePeerId) {
    const peer = this.peers.get(remotePeerId);
    if (!peer) return;
    peer.close();
    this.peers.delete(remotePeerId);
    this._notifyPeerState();
    this._maybeExitRelayMode();
  }

  handleSignal(from, data) {
    let peer = this.peers.get(from);
    if (!peer) {
      peer = this.addPeer(from, { polite: true, initiator: false });
    }
    peer.handleRemoteSignal(data);
  }

  _onPeerData(remotePeerId, label, data) {
    let bytes;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (data instanceof Uint8Array) bytes = data;
    else if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        if (msg && msg.t === 'awareness') {
          this.crdt.awareness.applyIncomingUpdate(msg.u);
          return;
        }
      } catch {}
      return;
    } else return;
    this.crdt.applyRemoteUpdate(bytes);
  }

  _onPeerOpen(remotePeerId) {
    this._notifyPeerState();
    this._maybeExitRelayMode();
    const peer = this.peers.get(remotePeerId);
    if (peer) {
      const sv = this.crdt.encodeStateVector();
      peer.send(sv.buffer.slice(sv.byteOffset, sv.byteOffset + sv.byteLength));
    }
  }

  _onPeerState(remotePeerId, state) {
    this._notifyPeerState();
    if (state === 'disconnected' || state === 'failed') {
      this._checkNeedRelay();
    }
  }

  _checkNeedRelay() {
    if (this.relayMode) return;
    const allDegraded = Array.from(this.peers.values()).every((p) => {
      const hasWorkingChannel = p.reliable && p.reliable.readyState === 'open';
      return p.iceFailed || !hasWorkingChannel;
    });
    if (allDegraded && this.peers.size > 0) {
      this._enterRelayMode();
    }
  }

  _onPeerIceFailed(remotePeerId) {
    this._notifyPeerState();
    this._checkNeedRelay();
  }

  _enterRelayMode() {
    this.relayMode = true;
    this.discovery.requestRelay();
    if (this.onRelayModeChange) this.onRelayModeChange(true);
  }

  _maybeExitRelayMode() {
    if (!this.relayMode) return;
    if (this.hasAnyP2P()) {
      this.relayMode = false;
      if (this.onRelayModeChange) this.onRelayModeChange(false);
    }
  }

  _notifyPeerState() {
    if (this.onPeerStateChange) {
      const info = {};
      for (const [id, p] of this.peers.entries()) {
        info[id] = {
          state: p.state,
          iceFailed: p.iceFailed,
          open: !!(p.reliable && p.reliable.readyState === 'open'),
        };
      }
      this.onPeerStateChange(info);
    }
  }

  broadcast(update, { reliable = true } = {}) {
    let buffer;
    if (typeof update === 'string') {
      buffer = update;
    } else if (update instanceof Uint8Array) {
      buffer = update.buffer.slice(update.byteOffset, update.byteOffset + update.byteLength);
    } else {
      buffer = update;
    }

    let sentP2P = 0;
    for (const peer of this.peers.values()) {
      if (peer.reliable && peer.reliable.readyState === 'open') {
        peer.send(buffer, { unreliable: !reliable });
        sentP2P += 1;
      }
    }
    if (sentP2P === 0 && this.relayMode) {
      if (typeof buffer === 'string') {
        this.discovery.sendRelay({ kind: 'awareness', raw: buffer });
      } else if (buffer instanceof ArrayBuffer) {
        const b64 = arrayBufferToBase64(buffer);
        this.discovery.sendRelay({ kind: 'update', b64 });
      }
    }
  }

  handleRelay(from, payload) {
    if (payload.kind === 'update' && typeof payload.b64 === 'string') {
      const bytes = base64ToUint8(payload.b64);
      this.crdt.applyRemoteUpdate(bytes);
    } else if (payload.kind === 'awareness' && typeof payload.raw === 'string') {
      try {
        const msg = JSON.parse(payload.raw);
        if (msg && msg.t === 'awareness') {
          this.crdt.awareness.applyIncomingUpdate(msg.u);
        }
      } catch {}
    }
  }

  kickPeer(targetPeerId) {
    this.discovery.kickPeer(targetPeerId);
  }

  destroy() {
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUint8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
