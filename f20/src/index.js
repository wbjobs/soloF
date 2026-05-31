import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import express from 'express';
import cors from 'cors';
import MediasoupServer from './mediasoup/MediasoupServer.js';
import StreamManager from './transcoder/StreamManager.js';
import ApiServer from './api/server.js';
import config from '../config/default.json' assert { type: 'json' };

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let mediasoupServer;
let streamManager;

async function initialize() {
  try {
    mediasoupServer = new MediasoupServer(config.mediasoup);
    await mediasoupServer.initialize();

    streamManager = new StreamManager(config.transcoding);
    await streamManager.initialize();

    mediasoupServer.setStreamManager(streamManager);

    io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);
      mediasoupServer.handleConnection(socket);

      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        mediasoupServer.handleDisconnection(socket.id);
      });
    });

    app.use('/hls', express.static(config.transcoding.hls.outputDir));

    ApiServer.initialize(config.server.apiPort, streamManager);

    httpServer.listen(config.server.port, config.server.host, () => {
      console.log(`WebSocket server running on http://${config.server.host}:${config.server.port}`);
      console.log(`HLS endpoint: http://${config.server.host}:${config.server.port}/hls`);
    });

  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await streamManager.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await streamManager.shutdown();
  process.exit(0);
});

initialize();
