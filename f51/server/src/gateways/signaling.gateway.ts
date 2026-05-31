import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { MediasoupService } from '../services/mediasoup.service';
import { RoomService } from '../services/room.service';
import { Role } from '@shared/types';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/signaling',
})
export class SignalingGateway {
  @WebSocketServer()
  server: Server;

  private clientRooms: Map<string, string> = new Map();

  constructor(
    private readonly mediasoupService: MediasoupService,
    private readonly roomService: RoomService,
  ) {}

  @SubscribeMessage('join-room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; name: string; role: Role },
  ) {
    const { roomId, name, role } = payload;
    const peerId = client.id;

    await this.mediasoupService.createRouter(roomId);

    const roomState = await this.roomService.joinRoom(roomId, peerId, name, role);
    this.clientRooms.set(peerId, roomId);
    client.join(roomId);

    client.emit('joined', { peerId, roomState });
    client.to(roomId).emit('peer-joined', { peerId, name, role, roomState });
  }

  @SubscribeMessage('get-router-capabilities')
  async handleGetRouterCapabilities(
    @MessageBody() payload: { roomId: string },
  ) {
    const router = this.mediasoupService.getRouter(payload.roomId);
    if (!router) return { error: 'Router not found' };
    return router.rtpCapabilities;
  }

  @SubscribeMessage('create-transport')
  async handleCreateTransport(
    @MessageBody() payload: { roomId: string; direction: 'send' | 'recv' },
  ) {
    const transport = await this.mediasoupService.createWebRtcTransport(
      payload.roomId,
      payload.direction,
    );

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters,
    };
  }

  @SubscribeMessage('connect-transport')
  async handleConnectTransport(
    @MessageBody() payload: { transportId: string; dtlsParameters: any },
  ) {
    const transport = this.mediasoupService.getTransport(payload.transportId);
    if (!transport) return { error: 'Transport not found' };

    await transport.connect({ dtlsParameters: payload.dtlsParameters });
    return { connected: true };
  }

  @SubscribeMessage('produce')
  async handleProduce(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: {
      transportId: string;
      kind: 'audio' | 'video';
      rtpParameters: any;
      roomId: string;
    },
  ) {
    const producer = await this.mediasoupService.createProducer(
      payload.transportId,
      payload.kind,
      payload.rtpParameters,
    );

    client.to(payload.roomId).emit('new-producer', {
      producerId: producer.id,
      kind: producer.kind,
      peerId: client.id,
    });

    return { id: producer.id };
  }

  @SubscribeMessage('consume')
  async handleConsume(
    @MessageBody() payload: {
      transportId: string;
      producerId: string;
      rtpCapabilities: any;
    },
  ) {
    const consumer = await this.mediasoupService.createConsumer(
      payload.transportId,
      payload.producerId,
      payload.rtpCapabilities,
    );

    if (!consumer) {
      return null;
    }

    return {
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  @SubscribeMessage('resume-consumer')
  async handleResumeConsumer(
    @MessageBody() payload: { consumerId: string },
  ) {
    const consumer = this.mediasoupService.getConsumer(payload.consumerId);
    if (consumer) {
      await consumer.resume();
      return { resumed: true };
    }
    return { error: 'Consumer not found' };
  }

  @SubscribeMessage('get-active-speakers')
  async handleGetActiveSpeakers(
    @MessageBody() payload: { roomId: string },
  ) {
    const producers = this.mediasoupService.getProducersByRoom(payload.roomId);
    return producers.map(p => ({
      id: p.id,
      kind: p.kind,
      paused: p.paused,
    }));
  }

  @SubscribeMessage('set-magnification')
  async handleSetMagnification(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; magnification: number },
  ) {
    const result = this.roomService.setMagnification(payload.roomId, payload.magnification);
    if (!result) return { error: 'Room not found' };

    const scaleBarLength = this.roomService.calculateScaleBarLength(payload.roomId);

    const update = {
      roomId: payload.roomId,
      magnification: result.magnification,
      unit: result.scaleBarUnit,
      scaleBarLength,
    };

    this.server.to(payload.roomId).emit('magnification-updated', update);

    return update;
  }

  @SubscribeMessage('get-magnification')
  async handleGetMagnification(
    @MessageBody() payload: { roomId: string },
  ) {
    const result = this.roomService.getMagnification(payload.roomId);
    if (!result) return { error: 'Room not found' };

    const scaleBarLength = this.roomService.calculateScaleBarLength(payload.roomId);

    return {
      roomId: payload.roomId,
      magnification: result.magnification,
      unit: result.scaleBarUnit,
      scaleBarLength,
    };
  }

  @SubscribeMessage('leave-room')
  async handleLeaveRoom(@ConnectedSocket() client: Socket) {
    const peerId = client.id;
    const roomId = this.clientRooms.get(peerId);
    if (roomId) {
      const roomState = this.roomService.leaveRoom(roomId, peerId);
      this.clientRooms.delete(peerId);
      client.leave(roomId);

      if (roomState) {
        client.to(roomId).emit('peer-left', { peerId, roomState });
      } else {
        this.mediasoupService.closeRoom(roomId);
      }
    }
  }

  handleDisconnect(client: Socket) {
    this.handleLeaveRoom(client);
  }
}
