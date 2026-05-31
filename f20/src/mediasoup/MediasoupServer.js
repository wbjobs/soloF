import * as mediasoup from '@mediasoup/mediasoup';
import { v4 as uuidv4 } from 'uuid';

class MediasoupServer {
  constructor(config) {
    this.config = config;
    this.workers = [];
    this.routers = new Map();
    this.transports = new Map();
    this.producers = new Map();
    this.clients = new Map();
    this.streamManager = null;
  }

  async initialize() {
    const worker = await mediasoup.createWorker({
      rtcMinPort: this.config.rtcMinPort,
      rtcMaxPort: this.config.rtcMaxPort,
      logLevel: 'warn',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp']
    });

    worker.on('died', () => {
      console.error('Mediasoup worker died, exiting in 2 seconds...');
      setTimeout(() => process.exit(1), 2000);
    });

    this.workers.push(worker);

    const webRtcServer = await worker.createWebRtcServer({
      listenInfos: this.config.webRtcServerOptions.listenInfos
    });

    this.webRtcServer = webRtcServer;
    console.log('Mediasoup worker and WebRTC server initialized');
  }

  setStreamManager(streamManager) {
    this.streamManager = streamManager;
  }

  async handleConnection(socket) {
    const clientId = socket.id;
    
    const worker = this.workers[0];
    const router = await worker.createRouter({
      mediaCodecs: this.config.routerOptions.mediaCodecs
    });

    this.routers.set(clientId, router);
    this.clients.set(clientId, { socket, router, producers: [] });

    socket.emit('router-rtp-capabilities', router.rtpCapabilities);

    socket.on('create-transport', async (data, callback) => {
      try {
        const { transportType } = data;
        const transport = await this.createTransport(clientId, transportType);
        
        callback({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        });
      } catch (error) {
        console.error('Error creating transport:', error);
        callback({ error: error.message });
      }
    });

    socket.on('connect-transport', async (data, callback) => {
      try {
        const { transportId, dtlsParameters } = data;
        const transport = this.transports.get(transportId);
        
        if (!transport) {
          throw new Error('Transport not found');
        }

        await transport.connect({ dtlsParameters });
        callback({ success: true });
      } catch (error) {
        console.error('Error connecting transport:', error);
        callback({ error: error.message });
      }
    });

    socket.on('produce', async (data, callback) => {
      try {
        const { transportId, kind, rtpParameters } = data;
        const transport = this.transports.get(transportId);
        
        if (!transport) {
          throw new Error('Transport not found');
        }

        const producer = await transport.produce({
          kind,
          rtpParameters
        });

        this.producers.set(producer.id, producer);
        
        const client = this.clients.get(clientId);
        if (client) {
          client.producers.push(producer);
        }

        producer.on('transportclose', () => {
          this.producers.delete(producer.id);
        });

        producer.on('score', (score) => {
          this.handleProducerScore(clientId, producer, score);
        });

        const audioProducer = client.producers.find(p => p.kind === 'audio');
        const videoProducer = client.producers.find(p => p.kind === 'video');
        
        if (this.streamManager && audioProducer && videoProducer) {
          const existingStream = this.streamManager.getStream(clientId);
          
          if (existingStream) {
            console.log(`Updating existing stream for client: ${clientId}`);
            await existingStream.updateProducers(audioProducer, videoProducer);
          } else {
            console.log(`Creating new stream for client: ${clientId}`);
            await this.streamManager.createStream(clientId, client.router, audioProducer, videoProducer);
          }
        }

        callback({ id: producer.id });
      } catch (error) {
        console.error('Error producing:', error);
        callback({ error: error.message });
      }
    });
  }

  async createTransport(clientId, transportType) {
    const router = this.routers.get(clientId);
    
    if (!router) {
      throw new Error('Router not found');
    }

    const transport = await router.createWebRtcTransport({
      webRtcServer: this.webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    });

    this.transports.set(transport.id, transport);

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        transport.close();
        this.transports.delete(transport.id);
      }
    });

    transport.on('close', () => {
      this.transports.delete(transport.id);
    });

    return transport;
  }

  handleProducerScore(clientId, producer, score) {
    if (this.streamManager) {
      this.streamManager.updateProducerScore(clientId, producer.kind, score);
    }
  }

  async handleDisconnection(clientId) {
    const client = this.clients.get(clientId);
    
    if (client) {
      if (this.streamManager) {
        await this.streamManager.removeStream(clientId);
      }

      for (const producer of client.producers) {
        this.producers.delete(producer.id);
      }

      const router = this.routers.get(clientId);
      if (router) {
        router.close();
        this.routers.delete(clientId);
      }

      this.clients.delete(clientId);
    }
  }
}

export default MediasoupServer;
