import { Injectable, OnModuleInit } from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import { mediasoupConfig } from '../config/mediasoup.config';

@Injectable()
export class MediasoupService implements OnModuleInit {
  private workers: mediasoup.types.Worker[] = [];
  private nextWorkerIndex = 0;
  private routers: Map<string, mediasoup.types.Router> = new Map();
  private transports: Map<string, mediasoup.types.WebRtcTransport> = new Map();
  private producers: Map<string, mediasoup.types.Producer> = new Map();
  private consumers: Map<string, mediasoup.types.Consumer> = new Map();

  async onModuleInit() {
    await this.createWorkers();
  }

  private async createWorkers() {
    const numWorkers = 1;
    for (let i = 0; i < numWorkers; i++) {
      const worker = await mediasoup.createWorker(mediasoupConfig.worker);
      worker.on('died', () => {
        console.error('Mediasoup worker died');
      });
      this.workers.push(worker);
    }
  }

  private getWorker(): mediasoup.types.Worker {
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  async createRouter(roomId: string): Promise<mediasoup.types.Router> {
    const existingRouter = this.routers.get(roomId);
    if (existingRouter) return existingRouter;

    const worker = this.getWorker();
    const router = await worker.createRouter(mediasoupConfig.router);
    this.routers.set(roomId, router);
    return router;
  }

  getRouter(roomId: string): mediasoup.types.Router | undefined {
    return this.routers.get(roomId);
  }

  async createWebRtcTransport(
    roomId: string,
    direction: 'send' | 'recv',
  ): Promise<mediasoup.types.WebRtcTransport> {
    const router = this.getRouter(roomId);
    if (!router) throw new Error(`Router not found for room: ${roomId}`);

    const transport = await router.createWebRtcTransport({
      ...mediasoupConfig.webRtcTransport,
      appData: { direction, roomId },
    });

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') transport.close();
    });

    transport.on('close', () => {
      this.transports.delete(transport.id);
    });

    this.transports.set(transport.id, transport);
    return transport;
  }

  getTransport(transportId: string): mediasoup.types.WebRtcTransport | undefined {
    return this.transports.get(transportId);
  }

  async createProducer(
    transportId: string,
    kind: mediasoup.types.MediaKind,
    rtpParameters: mediasoup.types.RtpParameters,
  ): Promise<mediasoup.types.Producer> {
    const transport = this.getTransport(transportId);
    if (!transport) throw new Error(`Transport not found: ${transportId}`);

    const producer = await transport.produce({ kind, rtpParameters });

    producer.on('close', () => {
      this.producers.delete(producer.id);
    });

    this.producers.set(producer.id, producer);
    return producer;
  }

  getProducer(producerId: string): mediasoup.types.Producer | undefined {
    return this.producers.get(producerId);
  }

  getProducersByRoom(roomId: string): mediasoup.types.Producer[] {
    const result: mediasoup.types.Producer[] = [];
    for (const producer of this.producers.values()) {
      const transport = this.transports.get(producer.transportId);
      if (transport && transport.appData.roomId === roomId) {
        result.push(producer);
      }
    }
    return result;
  }

  async createConsumer(
    transportId: string,
    producerId: string,
    rtpCapabilities: mediasoup.types.RtpCapabilities,
  ): Promise<mediasoup.types.Consumer | null> {
    const transport = this.getTransport(transportId);
    if (!transport) throw new Error(`Transport not found: ${transportId}`);

    const producer = this.getProducer(producerId);
    if (!producer) throw new Error(`Producer not found: ${producerId}`);

    const router = this.routers.get(transport.appData.roomId);
    if (!router) throw new Error('Router not found');

    if (!router.canConsume({ producerId, rtpCapabilities })) {
      return null;
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });

    consumer.on('close', () => {
      this.consumers.delete(consumer.id);
    });

    this.consumers.set(consumer.id, consumer);
    return consumer;
  }

  getConsumer(consumerId: string): mediasoup.types.Consumer | undefined {
    return this.consumers.get(consumerId);
  }

  closeRoom(roomId: string) {
    const router = this.routers.get(roomId);
    if (router) {
      router.close();
      this.routers.delete(roomId);
    }
  }
}
