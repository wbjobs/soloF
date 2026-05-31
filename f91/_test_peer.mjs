const RELIABLE_LABEL = 'crdt-reliable';
const UNRELIABLE_LABEL = 'crdt-unreliable';
const ICE_TIMEOUT_MS = 12000;
const DISCONNECTED_GRACE_MS = 5000;

export class PeerConnection {
  constructor(localPeerId, remotePeerId, discovery, opts = {}) {
    this.localPeerId = localPeerId;
    this.remotePeerId = remotePeerId;
    this.discovery = discovery;
    this.polite = opts.polite || false;
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
    });
    this.reliable = null;
    this.unreliable = null;
    this.state = 'new';
    this.iceFailed = false;
    this._makingOffer = false;
    this._ignoreOffer = false;
    this._iceTimer = null;
    this._disconnectTimer = null;
    this._gatheringDone = false;
    this._everConnected = false;

    this.onStateChange = null;
    this.onData = null;
    this.onOpen = null;
    this.onIceFailed = null;
    this.onClose = null;

    this._setup();
  }

  _setup() {
    this.pc.ondatachannel = (evt) => {
      const ch = evt.channel;
      if (ch.label === RELIABLE_LABEL) this.reliable = ch;
      if (ch.label === UNRELIABLE_LABEL) this.unreliable = ch;
      this._attachChannel(ch);
    };

    this.pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        this.discovery.sendSignal(this.remotePeerId, {
          type: 'ice',
          candidate: evt.candidate.toJSON(),
        });
      } else {
        this._gatheringDone = true;
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const s = this.pc.iceConnectionState;
      this.state = s;
      if (this.onStateChange) this.onStateChange(s);

      if (s === 'connected' || s === 'completed') {
        this._everConnected = true;
        clearTimeout(this._iceTimer);
        clearTimeout(this._disconnectTimer);
      } else if (s === 'disconnected') {
        if (this._everConnected) {
          clearTimeout(this._disconnectTimer);
          this._disconnectTimer = setTimeout(() => {
            this._maybeTriggerIceFailure();
          }, DISCONNECTED_GRACE_MS);
        }
      } else if (s === 'failed') {
        this._maybeTriggerIceFailure();
      }
      if (s === 'closed' && this.onClose) this.onClose();
    };

    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'connected') {
        this._everConnected = true;
        clearTimeout(this._iceTimer);
        clearTimeout(this._disconnectTimer);
        if (this.onOpen) this.onOpen();
      } else if (s === 'failed') {
        this._maybeTriggerIceFailure();
      }
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        this._makingOffer = true;
        const offer = await this.pc.createOffer();
        if (this.pc.signalingState !== 'stable') return;
        await this.pc.setLocalDescription(offer);
        this.discovery.sendSignal(this.remotePeerId, {
          type: 'sdp',
          desc: { type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp },
        });
      } catch (e) {
        if (this.onIceFailed) this.onIceFailed(e);
      } finally {
        this._makingOffer = false;
      }
    };
  }

  createChannels() {
    this.reliable = this.pc.createDataChannel(RELIABLE_LABEL, { ordered: true });
    this.unreliable = this.pc.createDataChannel(UNRELIABLE_LABEL, { ordered: false, maxRetransmits: 0 });
    this._attachChannel(this.reliable);
    this._attachChannel(this.unreliable);
  }

  _attachChannel(ch) {
    ch.onopen = () => {
      if (ch.label === RELIABLE_LABEL && this.onOpen) this.onOpen();
    };
    ch.onmessage = (evt) => {
      if (this.onData) this.onData(ch.label, evt.data);
    };
    ch.onerror = () => {};
    ch.onclose = () => {};
  }

  startIceTimer() {
    clearTimeout(this._iceTimer);
    this._iceTimer = setTimeout(() => {
      const connState = this.pc.connectionState;
      const iceState = this.pc.iceConnectionState;
      const hasOpenChannel = this.reliable && this.reliable.readyState === 'open';
      if (!hasOpenChannel && connState !== 'connected' && iceState !== 'connected' && iceState !== 'completed') {
        this._maybeTriggerIceFailure();
      }
    }, ICE_TIMEOUT_MS);
  }

  _maybeTriggerIceFailure() {
    if (this.iceFailed) return;
    clearTimeout(this._disconnectTimer);
    this.iceFailed = true;
    if (this.onIceFailed) this.onIceFailed();
  }

  async handleRemoteSignal(data) {
    try {
      if (data.type === 'sdp') {
        const desc = data.desc;
        const offerCollision = desc.type === 'offer' &&
          (this._makingOffer || this.pc.signalingState !== 'stable');
        this._ignoreOffer = !this.polite && offerCollision;
        if (this._ignoreOffer) return;
        await this.pc.setRemoteDescription(new RTCSessionDescription(desc));
        if (desc.type === 'offer') {
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.discovery.sendSignal(this.remotePeerId, {
            type: 'sdp',
            desc: { type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp },
          });
        }
      } else if (data.type === 'ice') {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          if (!this._ignoreOffer) throw e;
        }
      }
    } catch (e) {
      if (this.onIceFailed) this.onIceFailed(e);
    }
  }

  send(data, opts = {}) {
    const ch = opts.unreliable && this.unreliable && this.unreliable.readyState === 'open'
      ? this.unreliable
      : this.reliable;
    if (!ch || ch.readyState !== 'open') return false;
    try {
      ch.send(data);
      return true;
    } catch (e) {
      return false;
    }
  }

  close() {
    clearTimeout(this._iceTimer);
    clearTimeout(this._disconnectTimer);
    try { this.pc.close(); } catch {}
    if (this.onClose) this.onClose();
  }
}
