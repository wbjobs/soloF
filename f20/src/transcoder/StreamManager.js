import { promises as fs } from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import StreamSession from './StreamSession.js';

class StreamManager {
  constructor(config) {
    this.config = config;
    this.streams = new Map();
    this.hlsOutputDir = config.hls.outputDir;
    this.eventCallbacks = config.streamRecovery?.eventCallbacks || [];
    this.clientStreamMap = new Map();
  }

  async initialize() {
    await fs.mkdir(this.hlsOutputDir, { recursive: true });
    console.log('StreamManager initialized with auto-recovery support');
  }

  async createStream(streamId, router, audioProducer, videoProducer) {
    const existingSession = this.streams.get(streamId);
    
    if (existingSession) {
      console.log(`Stream ${streamId} exists, updating producers instead of recreating`);
      await existingSession.updateProducers(audioProducer, videoProducer);
      return existingSession;
    }

    const session = new StreamSession(streamId, this.config, router, audioProducer, videoProducer, this);
    this.streams.set(streamId, session);

    await session.initialize();
    await session.startTranscoding();

    this.notifyStreamEvent(streamId, 'create', {
      timestamp: Date.now(),
      streamId
    });

    console.log(`Stream created: ${streamId}`);
    return session;
  }

  async removeStream(streamId) {
    const session = this.streams.get(streamId);
    
    if (session) {
      await session.stop();
      this.streams.delete(streamId);
      
      this.notifyStreamEvent(streamId, 'destroy', {
        timestamp: Date.now(),
        streamId
      });
      
      console.log(`Stream removed: ${streamId}`);
    }
  }

  getStream(streamId) {
    return this.streams.get(streamId);
  }

  getAllStreams() {
    return Array.from(this.streams.values());
  }

  updateProducerScore(streamId, kind, score) {
    const session = this.streams.get(streamId);
    
    if (session) {
      session.handleProducerScore(kind, score);
    }
  }

  async updateWatermark(streamId, watermarkConfig) {
    const session = this.streams.get(streamId);
    
    if (session) {
      await session.updateWatermark(watermarkConfig);
    }
  }

  async updatePiP(streamId, pipConfig) {
    const session = this.streams.get(streamId);
    
    if (session) {
      await session.updatePiP(pipConfig);
    }
  }

  addPiPInputStream(mainStreamId, pipStreamId, videoProducer) {
    const mainSession = this.streams.get(mainStreamId);
    
    if (mainSession) {
      mainSession.addPiPInputStream(pipStreamId, videoProducer);
    }
  }

  notifyStreamEvent(streamId, eventType, data) {
    console.log(`Stream event: ${eventType} for stream ${streamId}`, data);

    for (const callbackUrl of this.eventCallbacks) {
      this.sendEventCallback(callbackUrl, eventType, data);
    }
  }

  async sendEventCallback(callbackUrl, eventType, data) {
    try {
      const url = new URL(callbackUrl);
      const payload = JSON.stringify({
        event: eventType,
        data,
        timestamp: Date.now()
      });

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      const httpModule = url.protocol === 'https:' ? https : http;
      
      const req = httpModule.request(options, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`Event callback delivered: ${callbackUrl} [${eventType}]`);
        } else {
          console.warn(`Event callback returned status ${res.statusCode}: ${callbackUrl}`);
        }
      });

      req.on('error', (error) => {
        console.error(`Failed to send event callback to ${callbackUrl}:`, error.message);
      });

      req.setTimeout(5000, () => {
        req.destroy();
        console.error(`Event callback timeout: ${callbackUrl}`);
      });

      req.write(payload);
      req.end();
      
    } catch (error) {
      console.error(`Error preparing event callback:`, error.message);
    }
  }

  addEventCallback(callbackUrl) {
    if (!this.eventCallbacks.includes(callbackUrl)) {
      this.eventCallbacks.push(callbackUrl);
      console.log(`Added event callback: ${callbackUrl}`);
    }
  }

  removeEventCallback(callbackUrl) {
    const index = this.eventCallbacks.indexOf(callbackUrl);
    if (index > -1) {
      this.eventCallbacks.splice(index, 1);
      console.log(`Removed event callback: ${callbackUrl}`);
    }
  }

  getStreamStats(streamId) {
    const session = this.streams.get(streamId);
    return session ? session.getStats() : null;
  }

  getAllStreamStats() {
    return Array.from(this.streams.values()).map(session => ({
      id: session.id,
      ...session.getStats()
    }));
  }

  async shutdown() {
    console.log('Shutting down all streams...');
    
    for (const session of this.streams.values()) {
      await session.stop();
    }
    
    this.streams.clear();
    console.log('All streams stopped');
  }
}

export default StreamManager;
