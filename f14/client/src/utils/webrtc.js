class WebRTCManager {
  constructor(signalingWs, userId, roomId) {
    this.signalingWs = signalingWs;
    this.userId = userId;
    this.roomId = roomId;
    this.connections = new Map();
    this.dataChannels = new Map();
    this.onMessage = null;
    this.onPeerConnected = null;
    this.onPeerDisconnected = null;
    
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
  }

  async createPeerConnection(peerId, isInitiator) {
    const config = { iceServers: this.iceServers };
    const pc = new RTCPeerConnection(config);
    
    const dataChannel = pc.createDataChannel('whiteboard-data');
    this.setupDataChannel(dataChannel, peerId);
    
    pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel, peerId);
    };
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(peerId, {
          type: 'ice-candidate',
          candidate: event.candidate
        });
      }
    };
    
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        console.log(`Connected to peer ${peerId}`);
        if (this.onPeerConnected) {
          this.onPeerConnected(peerId);
        }
      } else if (pc.connectionState === 'disconnected' || 
                 pc.connectionState === 'failed') {
        console.log(`Disconnected from peer ${peerId}`);
        this.connections.delete(peerId);
        this.dataChannels.delete(peerId);
        if (this.onPeerDisconnected) {
          this.onPeerDisconnected(peerId);
        }
      }
    };
    
    this.connections.set(peerId, pc);
    
    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal(peerId, {
        type: 'offer',
        sdp: offer
      });
    }
    
    return pc;
  }

  setupDataChannel(dataChannel, peerId) {
    dataChannel.onopen = () => {
      console.log(`Data channel opened with ${peerId}`);
      this.dataChannels.set(peerId, dataChannel);
    };
    
    dataChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (this.onMessage) {
          this.onMessage(message, peerId);
        }
      } catch (error) {
        console.error('Error parsing WebRTC message:', error);
      }
    };
    
    dataChannel.onclose = () => {
      console.log(`Data channel closed with ${peerId}`);
      this.dataChannels.delete(peerId);
    };
  }

  async handleSignal(fromPeerId, signal) {
    let pc = this.connections.get(fromPeerId);
    
    if (!pc) {
      pc = await this.createPeerConnection(fromPeerId, false);
    }
    
    switch (signal.type) {
      case 'offer':
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendSignal(fromPeerId, {
          type: 'answer',
          sdp: answer
        });
        break;
        
      case 'answer':
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        break;
        
      case 'ice-candidate':
        if (signal.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
        break;
    }
  }

  sendSignal(toPeerId, signal) {
    this.signalingWs.send(JSON.stringify({
      type: 'webrtc-signal',
      to: toPeerId,
      from: this.userId,
      signal
    }));
  }

  broadcast(message) {
    const messageStr = JSON.stringify(message);
    this.dataChannels.forEach((channel, peerId) => {
      if (channel.readyState === 'open') {
        try {
          channel.send(messageStr);
        } catch (error) {
          console.error(`Error sending to ${peerId}:`, error);
        }
      }
    });
  }

  async connectToPeers(peerIds) {
    for (const peerId of peerIds) {
      if (!this.connections.has(peerId)) {
        await this.createPeerConnection(peerId, true);
      }
    }
  }

  getConnectedPeers() {
    return Array.from(this.dataChannels.keys());
  }

  disconnect() {
    this.dataChannels.forEach(channel => channel.close());
    this.connections.forEach(pc => pc.close());
    this.dataChannels.clear();
    this.connections.clear();
  }
}

export { WebRTCManager };
