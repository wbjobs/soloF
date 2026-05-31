import { io, Socket } from 'socket.io-client';
import { Role, RoomState } from '@shared/types';

export class SignalingService {
  private socket: Socket;
  private roomId: string = '';

  constructor() {
    this.socket = io('http://localhost:3001/signaling', {
      transports: ['websocket'],
    });
  }

  connect() {
    return new Promise<void>((resolve) => {
      if (this.socket.connected) resolve();
      else this.socket.on('connect', resolve);
    });
  }

  on(event: string, callback: (data: any) => void) {
    this.socket.on(event, callback);
  }

  off(event: string, callback?: (data: any) => void) {
    if (callback) this.socket.off(event, callback);
    else this.socket.off(event);
  }

  async joinRoom(roomId: string, name: string, role: Role): Promise<{ peerId: string; roomState: RoomState }> {
    this.roomId = roomId;
    return this.emit('join-room', { roomId, name, role });
  }

  async getRouterCapabilities() {
    return this.emit('get-router-capabilities', { roomId: this.roomId });
  }

  async createTransport(direction: 'send' | 'recv') {
    return this.emit('create-transport', { roomId: this.roomId, direction });
  }

  async connectTransport(transportId: string, dtlsParameters: any) {
    return this.emit('connect-transport', { transportId, dtlsParameters });
  }

  async produce(transportId: string, kind: 'audio' | 'video', rtpParameters: any) {
    return this.emit('produce', { transportId, kind, rtpParameters, roomId: this.roomId });
  }

  async consume(transportId: string, producerId: string, rtpCapabilities: any) {
    return this.emit('consume', { transportId, producerId, rtpCapabilities });
  }

  async resumeConsumer(consumerId: string) {
    return this.emit('resume-consumer', { consumerId });
  }

  async getActiveSpeakers() {
    return this.emit('get-active-speakers', { roomId: this.roomId });
  }

  leaveRoom() {
    this.socket.emit('leave-room');
  }

  disconnect() {
    this.socket.disconnect();
  }

  async setMagnification(magnification: number) {
    return this.emit('set-magnification', { roomId: this.roomId, magnification });
  }

  async getMagnification() {
    return this.emit('get-magnification', { roomId: this.roomId });
  }

  private emit(event: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.socket.emit(event, data, (response: any) => {
        if (response && response.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  }
}
