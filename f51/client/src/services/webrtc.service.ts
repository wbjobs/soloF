import { Device, types as mediasoupTypes } from 'mediasoup-client';
import { SignalingService } from './signaling.service';

export class WebRtcService {
  private device: Device | null = null;
  private sendTransport: mediasoupTypes.Transport | null = null;
  private recvTransport: mediasoupTypes.Transport | null = null;
  private producers: Map<string, mediasoupTypes.Producer> = new Map();
  private consumers: Map<string, mediasoupTypes.Consumer> = new Map();
  private localStream: MediaStream | null = null;
  private remoteStreams: Map<string, MediaStream> = new Map();

  constructor(private signaling: SignalingService) {}

  async initialize() {
    const routerCapabilities = await this.signaling.getRouterCapabilities();
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: routerCapabilities });
  }

  getRtpCapabilities() {
    if (!this.device) throw new Error('Device not initialized');
    return this.device.rtpCapabilities;
  }

  async createSendTransport() {
    if (!this.device) throw new Error('Device not initialized');

    const transportOptions = await this.signaling.createTransport('send');
    this.sendTransport = this.device.createSendTransport(transportOptions);

    this.setupTransportListeners(this.sendTransport, 'send');
    return this.sendTransport;
  }

  async createRecvTransport() {
    if (!this.device) throw new Error('Device not initialized');

    const transportOptions = await this.signaling.createTransport('recv');
    this.recvTransport = this.device.createRecvTransport(transportOptions);

    this.setupTransportListeners(this.recvTransport, 'recv');
    return this.recvTransport;
  }

  private setupTransportListeners(transport: mediasoupTypes.Transport, direction: 'send' | 'recv') {
    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await this.signaling.connectTransport(transport.id, dtlsParameters);
        callback();
      } catch (error) {
        errback(error as Error);
      }
    });

    if (direction === 'send') {
      (transport as mediasoupTypes.SendTransport).on(
        'produce',
        async ({ kind, rtpParameters }, callback, errback) => {
          try {
            const { id } = await this.signaling.produce(transport.id, kind, rtpParameters);
            callback({ id });
          } catch (error) {
            errback(error as Error);
          }
        }
      );
    }
  }

  async produceVideo(track: MediaStreamTrack): Promise<mediasoupTypes.Producer> {
    if (!this.sendTransport) throw new Error('Send transport not created');

    const producer = await this.sendTransport.produce({
      track,
      codecOptions: {
        videoGoogleStartBitrate: 1000,
      },
      encodings: [
        { maxBitrate: 100000, scaleResolutionDownBy: 4 },
        { maxBitrate: 300000, scaleResolutionDownBy: 2 },
        { maxBitrate: 900000 },
      ],
      codec: this.device!.rtpCapabilities.codecs?.find(
        (c) => c.mimeType.toLowerCase() === 'video/h264'
      ),
    });

    this.producers.set(producer.id, producer);
    return producer;
  }

  async produceAudio(track: MediaStreamTrack): Promise<mediasoupTypes.Producer> {
    if (!this.sendTransport) throw new Error('Send transport not created');

    const producer = await this.sendTransport.produce({ track });
    this.producers.set(producer.id, producer);
    return producer;
  }

  async consume(producerId: string): Promise<mediasoupTypes.Consumer | null> {
    if (!this.recvTransport) throw new Error('Recv transport not created');
    if (!this.device) throw new Error('Device not initialized');

    const consumerData = await this.signaling.consume(
      this.recvTransport.id,
      producerId,
      this.device.rtpCapabilities
    );

    if (!consumerData) return null;

    const consumer = await this.recvTransport.consume({
      id: consumerData.id,
      producerId: consumerData.producerId,
      kind: consumerData.kind,
      rtpParameters: consumerData.rtpParameters,
    });

    this.consumers.set(consumer.id, consumer);
    return consumer;
  }

  async consumeMany(producerIds: string[]): Promise<Map<string, mediasoupTypes.Consumer>> {
    if (!this.recvTransport) throw new Error('Recv transport not created');
    if (!this.device) throw new Error('Device not initialized');

    const results = new Map<string, mediasoupTypes.Consumer>();

    const consumerPromises = producerIds.map(async (producerId) => {
      try {
        const consumerData = await this.signaling.consume(
          this.recvTransport!.id,
          producerId,
          this.device!.rtpCapabilities
        );

        if (!consumerData) return null;

        const consumer = await this.recvTransport!.consume({
          id: consumerData.id,
          producerId: consumerData.producerId,
          kind: consumerData.kind,
          rtpParameters: consumerData.rtpParameters,
        });

        this.consumers.set(consumer.id, consumer);
        return { producerId, consumer };
      } catch (err) {
        console.error('Failed to consume producer:', producerId, err);
        return null;
      }
    });

    const resolved = await Promise.all(consumerPromises);

    for (const item of resolved) {
      if (item) {
        results.set(item.producerId, item.consumer);
      }
    }

    return results;
  }

  async resumeConsumer(consumerId: string) {
    const consumer = this.consumers.get(consumerId);
    if (consumer) {
      await this.signaling.resumeConsumer(consumerId);
      await consumer.resume();
    }
  }

  async resumeConsumers(consumerIds: string[]) {
    const resumePromises = consumerIds.map(async (consumerId) => {
      const consumer = this.consumers.get(consumerId);
      if (!consumer) return null;
      try {
        await this.signaling.resumeConsumer(consumerId);
        await consumer.resume();
        return consumerId;
      } catch (err) {
        console.error('Failed to resume consumer:', consumerId, err);
        return null;
      }
    });

    await Promise.all(resumePromises);
  }

  async startLocalVideo(): Promise<MediaStream> {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: true,
    });
    return this.localStream;
  }

  async getLocalStream(): Promise<MediaStream> {
    if (this.localStream) return this.localStream;
    return this.startLocalVideo();
  }

  getConsumerTrack(consumerId: string): MediaStreamTrack | undefined {
    const consumer = this.consumers.get(consumerId);
    return consumer?.track;
  }

  getRemoteStream(producerId: string): MediaStream | undefined {
    return this.remoteStreams.get(producerId);
  }

  setRemoteStream(producerId: string, stream: MediaStream) {
    this.remoteStreams.set(producerId, stream);
  }

  close() {
    this.producers.forEach((p) => p.close());
    this.consumers.forEach((c) => c.close());
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.localStream?.getTracks().forEach((t) => t.stop());
  }
}
