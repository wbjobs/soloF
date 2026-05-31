import { Injectable } from '@nestjs/common';
import { Peer, Role, RoomState } from '@shared/types';

interface RoomData {
  peers: Map<string, Peer>;
  activeSpeakerId: string | null;
  magnification: number;
  scaleBarUnit: string;
}

@Injectable()
export class RoomService {
  private rooms: Map<string, RoomData> = new Map();

  async joinRoom(roomId: string, peerId: string, name: string, role: Role): Promise<RoomState> {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { peers: new Map(), activeSpeakerId: null, magnification: 100, scaleBarUnit: 'μm' };
      this.rooms.set(roomId, room);
    }

    const peer: Peer = { id: peerId, name, role };
    room.peers.set(peerId, peer);

    if (role === 'speaker' && !room.activeSpeakerId) {
      room.activeSpeakerId = peerId;
    }

    return this.getRoomState(roomId);
  }

  leaveRoom(roomId: string, peerId: string): RoomState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.peers.delete(peerId);

    if (room.activeSpeakerId === peerId) {
      const speakers = Array.from(room.peers.values()).filter(p => p.role === 'speaker');
      room.activeSpeakerId = speakers.length > 0 ? speakers[0].id : null;
    }

    if (room.peers.size === 0) {
      this.rooms.delete(roomId);
      return null;
    }

    return this.getRoomState(roomId);
  }

  getRoomState(roomId: string): RoomState {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { roomId, peers: [], activeSpeakerId: null };
    }
    return {
      roomId,
      peers: Array.from(room.peers.values()),
      activeSpeakerId: room.activeSpeakerId,
    };
  }

  setActiveSpeaker(roomId: string, peerId: string): RoomState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.activeSpeakerId = peerId;
    return this.getRoomState(roomId);
  }

  getRoom(roomId: string) {
    return this.rooms.get(roomId);
  }

  getPeerIds(roomId: string): string[] {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room.peers.keys()) : [];
  }

  setMagnification(roomId: string, magnification: number): { magnification: number; scaleBarUnit: string } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.magnification = Math.max(1, Math.min(10000, magnification));
    return { magnification: room.magnification, scaleBarUnit: room.scaleBarUnit };
  }

  getMagnification(roomId: string): { magnification: number; scaleBarUnit: string } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return { magnification: room.magnification, scaleBarUnit: room.scaleBarUnit };
  }

  calculateScaleBarLength(roomId: string, videoWidth: number = 1920): number {
    const room = this.rooms.get(roomId);
    if (!room) return 100;

    const basePixelSize = 0.5;
    const actualPixelSize = basePixelSize / room.magnification;
    const targetBarLength = 100;
    const barLengthInPixels = targetBarLength / actualPixelSize;

    const normalizedLength = barLengthInPixels / videoWidth;
    return Math.max(0.05, Math.min(0.5, normalizedLength));
  }
}
