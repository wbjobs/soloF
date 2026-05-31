import { io, type Socket } from 'socket.io-client'
import type { Participant } from '@/types'

interface SignalMessage {
  type: 'offer' | 'answer' | 'ice-candidate'
  targetId: string
  senderId: string
  data: any
}

export class WebRTCService {
  private socket: Socket | null = null
  private peerConnections: Map<string, RTCPeerConnection> = new Map()
  private localStream: MediaStream | null = null
  private onParticipantJoin: ((participant: Participant) => void) | null = null
  private onParticipantLeave: ((participantId: string) => void) | null = null
  private onRemoteStream: ((participantId: string, stream: MediaStream) => void) | null = null

  private iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]

  connect(serverUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(serverUrl, { transports: ['websocket'] })

      this.socket.on('connect', () => {
        console.log('Connected to signaling server')
        resolve()
      })

      this.socket.on('connect_error', (error) => {
        reject(error)
      })

      this.socket.on('signal', this.handleSignal.bind(this))
      
      this.socket.on('user-joined', (data: { id: string; name: string }) => {
        if (this.onParticipantJoin) {
          this.onParticipantJoin({
            id: data.id,
            name: data.name,
            isAudioEnabled: true,
            isVideoEnabled: true
          })
        }
      })

      this.socket.on('user-left', (data: { id: string }) => {
        if (this.onParticipantLeave) {
          this.onParticipantLeave(data.id)
        }
        this.closePeerConnection(data.id)
      })
    })
  }

  joinRoom(roomId: string, userId: string, userName: string): void {
    if (this.socket) {
      this.socket.emit('join-room', { roomId, userId, userName })
    }
  }

  leaveRoom(roomId: string, userId: string): void {
    if (this.socket) {
      this.socket.emit('leave-room', { roomId, userId })
    }
    this.peerConnections.forEach((_, id) => this.closePeerConnection(id))
  }

  setLocalStream(stream: MediaStream): void {
    this.localStream = stream
  }

  async createPeerConnection(targetId: string): Promise<RTCPeerConnection> {
    const config: RTCConfiguration = {
      iceServers: this.iceServers
    }

    const pc = new RTCPeerConnection(config)

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        if (this.localStream) {
          pc.addTrack(track, this.localStream)
        }
      })
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && this.socket) {
        this.socket.emit('signal', {
          type: 'ice-candidate',
          targetId,
          data: event.candidate
        })
      }
    }

    pc.ontrack = (event) => {
      const [stream] = event.streams
      if (this.onRemoteStream && stream) {
        this.onRemoteStream(targetId, stream)
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.closePeerConnection(targetId)
      }
    }

    this.peerConnections.set(targetId, pc)
    return pc
  }

  async createOffer(targetId: string): Promise<void> {
    const pc = await this.createPeerConnection(targetId)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    if (this.socket) {
      this.socket.emit('signal', {
        type: 'offer',
        targetId,
        data: offer
      })
    }
  }

  async handleOffer(senderId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    const pc = await this.createPeerConnection(senderId)
    await pc.setRemoteDescription(new RTCSessionDescription(offer))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    if (this.socket) {
      this.socket.emit('signal', {
        type: 'answer',
        targetId: senderId,
        data: answer
      })
    }
  }

  async handleAnswer(senderId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peerConnections.get(senderId)
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer))
    }
  }

  async handleIceCandidate(senderId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peerConnections.get(senderId)
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    }
  }

  handleSignal(message: SignalMessage): void {
    switch (message.type) {
      case 'offer':
        this.handleOffer(message.senderId, message.data)
        break
      case 'answer':
        this.handleAnswer(message.senderId, message.data)
        break
      case 'ice-candidate':
        this.handleIceCandidate(message.senderId, message.data)
        break
    }
  }

  closePeerConnection(peerId: string): void {
    const pc = this.peerConnections.get(peerId)
    if (pc) {
      pc.close()
      this.peerConnections.delete(peerId)
    }
  }

  setOnParticipantJoin(callback: (participant: Participant) => void): void {
    this.onParticipantJoin = callback
  }

  setOnParticipantLeave(callback: (participantId: string) => void): void {
    this.onParticipantLeave = callback
  }

  setOnRemoteStream(callback: (participantId: string, stream: MediaStream) => void): void {
    this.onRemoteStream = callback
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.peerConnections.forEach((_, id) => this.closePeerConnection(id))
  }
}

export const webrtcService = new WebRTCService()
