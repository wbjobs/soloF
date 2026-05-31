import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import FFmpegBuilder from './FFmpegBuilder.js';

class StreamSession {
  constructor(id, config, router, audioProducer, videoProducer, streamManager) {
    this.id = id;
    this.config = config;
    this.router = router;
    this.audioProducer = audioProducer;
    this.videoProducer = videoProducer;
    this.streamManager = streamManager;
    this.ffmpegProcesses = new Map();
    this.audioConsumer = null;
    this.videoConsumer = null;
    this.audioTransport = null;
    this.videoTransport = null;
    this.watermarkConfig = null;
    this.pipConfig = null;
    this.pipInputs = [];
    this.startTime = Date.now();
    this.stats = {
      bitrates: {},
      frameRates: {},
      droppedFrames: {},
      audioScore: 0,
      videoScore: 0,
      bytesReceived: 0,
      lastPacketTime: 0
    };
    this.outputDir = path.join(config.hls.outputDir, id);
    
    this.disconnectDetectionInterval = null;
    this.isDisconnected = false;
    this.disconnectStartTime = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = config.streamRecovery?.maxReconnectAttempts || 5;
    this.disconnectTimeout = (config.streamRecovery?.disconnectTimeout || 10) * 1000;
    this.lastPacketBytesReceived = Date.now();
    this.totalDisconnectCallbacks = [];
    this.isShuttingDown = false;
  }

  async initialize() {
    await fs.mkdir(this.outputDir, { recursive: true });
    
    await this.setupRtpConsumers();
    this.startDisconnectDetection();
    
    console.log(`Stream session initialized with disconnect detection: ${this.id}`);
  }

  async setupRtpConsumers() {
    if (this.audioTransport) this.audioTransport.close();
    if (this.videoTransport) this.videoTransport.close();

    this.audioTransport = await this.router.createPlainRtpTransport({
      listenIp: '127.0.0.1',
      rtcpMux: true,
      comedia: true
    });

    this.videoTransport = await this.router.createPlainRtpTransport({
      listenIp: '127.0.0.1',
      rtcpMux: true,
      comedia: true
    });

    this.audioConsumer = await this.audioTransport.consume({
      producerId: this.audioProducer.id,
      rtpCapabilities: this.router.rtpCapabilities,
      paused: false
    });

    this.videoConsumer = await this.videoTransport.consume({
      producerId: this.videoProducer.id,
      rtpCapabilities: this.router.rtpCapabilities,
      paused: false
    });

    this.audioConsumer.on('rtp', (packet) => {
      this.stats.bytesReceived += packet.length;
      this.lastPacketBytesReceived = Date.now();
      this.stats.lastPacketTime = Date.now();
      
      if (this.isDisconnected) {
        this.handleReconnect();
      }
    });

    this.videoConsumer.on('rtp', (packet) => {
      this.stats.bytesReceived += packet.length;
      this.lastPacketBytesReceived = Date.now();
      this.stats.lastPacketTime = Date.now();
      
      if (this.isDisconnected) {
        this.handleReconnect();
      }
    });

    this.audioProducer.on('close', () => this.handleProducerClose('audio'));
    this.videoProducer.on('close', () => this.handleProducerClose('video'));
    this.audioProducer.on('score', (score) => this.handleProducerScore('audio', score));
    this.videoProducer.on('score', (score) => this.handleProducerScore('video', score));
  }

  startDisconnectDetection() {
    if (this.disconnectDetectionInterval) {
      clearInterval(this.disconnectDetectionInterval);
    }

    this.disconnectDetectionInterval = setInterval(() => {
      if (this.isShuttingDown) return;

      const timeSinceLastPacket = Date.now() - this.lastPacketBytesReceived;
      const scoreThreshold = this.disconnectTimeout;
      
      const hasLowScore = (this.stats.audioScore === 0 && this.stats.videoScore === 0 && 
                          Date.now() - this.startTime > 5000);
      
      if (timeSinceLastPacket > scoreThreshold || hasLowScore) {
        if (!this.isDisconnected) {
          this.handleDisconnect();
        }
      }
    }, 1000);
  }

  handleProducerClose(kind) {
    console.log(`${kind} producer closed for stream: ${this.id}`);
    if (!this.isDisconnected) {
      this.handleDisconnect();
    }
  }

  handleDisconnect() {
    this.isDisconnected = true;
    this.disconnectStartTime = Date.now();
    this.reconnectAttempts = 0;

    console.warn(`Stream disconnected detected: ${this.id}, no packets for ${this.disconnectTimeout}ms`);

    this.streamManager.notifyStreamEvent(this.id, 'disconnect', {
      timestamp: Date.now(),
      streamId: this.id,
      uptime: Math.floor((Date.now() - this.startTime) / 1000)
    });

    this.startRecoveryTimer();
  }

  startRecoveryTimer() {
    const recoveryTimeout = (this.config.streamRecovery?.recoveryWindow || 60) * 1000;
    
    setTimeout(() => {
      if (this.isDisconnected && !this.isShuttingDown) {
        console.error(`Stream ${this.id} failed to reconnect within ${recoveryTimeout}ms, cleaning up`);
        this.streamManager.removeStream(this.id);
      }
    }, recoveryTimeout);
  }

  handleReconnect() {
    if (!this.isDisconnected) return;

    this.isDisconnected = false;
    const disconnectDuration = Date.now() - this.disconnectStartTime;
    this.reconnectAttempts++;

    console.log(`Stream reconnected: ${this.id}, was disconnected for ${disconnectDuration}ms`);

    this.streamManager.notifyStreamEvent(this.id, 'reconnect', {
      timestamp: Date.now(),
      streamId: this.id,
      disconnectDuration,
      reconnectAttempt: this.reconnectAttempts
    });

    this.lastPacketBytesReceived = Date.now();
  }

  async updateProducers(audioProducer, videoProducer) {
    console.log(`Updating producers for stream: ${this.id}`);
    
    this.audioProducer = audioProducer;
    this.videoProducer = videoProducer;
    
    await this.setupRtpConsumers();
    
    if (this.isDisconnected) {
      this.handleReconnect();
    }
  }

  async startTranscoding() {
    if (this.ffmpegProcesses.size > 0) {
      console.log(`FFmpeg processes already running, skipping start for: ${this.id}`);
      return;
    }

    for (const profile of this.config.profiles) {
      await this.startProfileTranscoding(profile);
    }
  }

  async startProfileTranscoding(profile) {
    const builder = new FFmpegBuilder();
    
    builder
      .addRtpInput(this.audioTransport.tuple.localPort, this.videoTransport.tuple.localPort)
      .setVideoCodec('libx264')
      .setAudioCodec('aac')
      .setVideoSize(profile.width, profile.height)
      .setVideoBitrate(profile.videoBitrate)
      .setAudioBitrate(profile.audioBitrate)
      .setFrameRate(profile.fps);

    if (this.watermarkConfig && this.watermarkConfig.enabled) {
      if (this.watermarkConfig.type === 'text') {
        builder.addTextWatermark(
          this.watermarkConfig.text,
          this.watermarkConfig.fontSize,
          this.watermarkConfig.fontColor,
          this.watermarkConfig.position
        );
      } else if (this.watermarkConfig.type === 'image' && this.watermarkConfig.imagePath) {
        builder.addImageWatermark(
          this.watermarkConfig.imagePath,
          this.watermarkConfig.position
        );
      }
    }

    if (this.pipConfig && this.pipConfig.enabled && this.pipInputs.length > 0) {
      builder.addPiP(this.pipInputs, this.pipConfig.layout);
    }

    builder.setHlsOutput(
      path.join(this.outputDir, `${profile.name}.m3u8`),
      this.config.hls.segmentDuration,
      this.config.hls.listSize
    );

    const command = builder.build();
    console.log(`Starting FFmpeg for ${profile.name}:`, command.join(' '));

    const ffmpeg = spawn('ffmpeg', command);
    
    ffmpeg.stderr.on('data', (data) => {
      this.parseFFmpegStats(profile.name, data.toString());
    });

    ffmpeg.on('close', (code) => {
      console.log(`FFmpeg ${profile.name} process exited with code ${code}`);
      this.ffmpegProcesses.delete(profile.name);
      
      if (!this.isShuttingDown && code !== 0 && !this.isDisconnected) {
        console.warn(`FFmpeg ${profile.name} exited unexpectedly, restarting...`);
        setTimeout(() => {
          if (!this.isShuttingDown) {
            this.startProfileTranscoding(profile);
          }
        }, 1000);
      }
    });

    ffmpeg.on('error', (error) => {
      console.error(`FFmpeg ${profile.name} error:`, error);
    });

    this.ffmpegProcesses.set(profile.name, {
      process: ffmpeg,
      profile,
      builder
    });
  }

  parseFFmpegStats(profileName, data) {
    const bitrateMatch = data.match(/bitrate=\s*(\d+\.?\d*)\s*kbits\/s/);
    const fpsMatch = data.match(/fps=\s*(\d+\.?\d*)/);
    const dropMatch = data.match(/drop=\s*(\d+)/);

    if (bitrateMatch) {
      this.stats.bitrates[profileName] = parseFloat(bitrateMatch[1]);
    }
    if (fpsMatch) {
      this.stats.frameRates[profileName] = parseFloat(fpsMatch[1]);
    }
    if (dropMatch) {
      this.stats.droppedFrames[profileName] = parseInt(dropMatch[1], 10);
    }
  }

  handleProducerScore(kind, score) {
    if (kind === 'audio') {
      this.stats.audioScore = score;
    } else if (kind === 'video') {
      this.stats.videoScore = score;
    }
  }

  async updateWatermark(watermarkConfig) {
    this.watermarkConfig = watermarkConfig;
    await this.restartTranscoding();
  }

  async updatePiP(pipConfig) {
    this.pipConfig = pipConfig;
    await this.restartTranscoding();
  }

  addPiPInputStream(pipStreamId, videoProducer) {
    if (this.pipInputs.length < 4) {
      this.pipInputs.push({ id: pipStreamId, videoProducer });
    }
  }

  async restartTranscoding() {
    for (const [profileName, { process }] of this.ffmpegProcesses) {
      process.kill('SIGTERM');
    }
    
    this.ffmpegProcesses.clear();
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    await this.startTranscoding();
  }

  getStats() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const timeSinceLastPacket = Date.now() - this.lastPacketBytesReceived;
    
    return {
      uptime,
      bitrates: this.stats.bitrates,
      frameRates: this.stats.frameRates,
      droppedFrames: this.stats.droppedFrames,
      audioScore: this.stats.audioScore,
      videoScore: this.stats.videoScore,
      bytesReceived: this.stats.bytesReceived,
      hasWatermark: !!this.watermarkConfig?.enabled,
      hasPiP: !!this.pipConfig?.enabled,
      pipInputCount: this.pipInputs.length,
      isDisconnected: this.isDisconnected,
      reconnectAttempts: this.reconnectAttempts,
      timeSinceLastPacket,
      disconnectDuration: this.isDisconnected ? (Date.now() - this.disconnectStartTime) : 0
    };
  }

  async stop() {
    console.log(`Stopping stream: ${this.id}`);
    this.isShuttingDown = true;
    
    if (this.disconnectDetectionInterval) {
      clearInterval(this.disconnectDetectionInterval);
      this.disconnectDetectionInterval = null;
    }
    
    for (const [profileName, { process }] of this.ffmpegProcesses) {
      process.kill('SIGTERM');
    }
    
    this.ffmpegProcesses.clear();

    if (this.audioConsumer) {
      try { this.audioConsumer.close(); } catch (e) {}
    }
    if (this.videoConsumer) {
      try { this.videoConsumer.close(); } catch (e) {}
    }
    if (this.audioTransport) {
      try { this.audioTransport.close(); } catch (e) {}
    }
    if (this.videoTransport) {
      try { this.videoTransport.close(); } catch (e) {}
    }

    try {
      await fs.rm(this.outputDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to cleanup output directory: ${error.message}`);
    }
  }
}

export default StreamSession;
