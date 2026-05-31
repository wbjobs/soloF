const dgram = require('dgram');
const EventEmitter = require('events');
const {
  createDataPacket,
  createAckPacket,
  createSynPacket,
  createFinPacket,
  createResumeRequest,
  createResumeAck,
  parsePacket,
  CHUNK_SIZE,
  PACKET_TYPE,
} = require('./protocol');
const { TransferStats } = require('./stats');
const { MultiPathScheduler, DEFAULT_PATHS } = require('./PathManager');

class ReliableUDPSender extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 41234;
    this.windowSize = options.windowSize || 100;
    this.initialCwnd = options.initialCwnd || 10;
    this.ssthresh = options.ssthresh || 128;
    this.rto = options.rto || 1000;
    this.rtoMin = options.rtoMin || 200;
    this.rtoMax = options.rtoMax || 60000;

    this.multiPath = options.multiPath || false;
    this.paths = options.paths || DEFAULT_PATHS;
    this.scheduler = null;
    this.schedulingAlgorithm = options.schedulingAlgorithm || 'dynamicWeighted';

    this.socket = null;
    this.stats = new TransferStats();

    this.chunks = [];
    this.nextSeqNum = 0;
    this.sendBase = 0;
    this.cwnd = this.initialCwnd;

    this.sentTimes = new Map();
    this.retransmitTimers = new Map();
    this.retransmitTimes = new Map();
    this.acked = new Set();
    this.duplicateAckCount = new Map();

    this.srtt = 0;
    this.rttvar = 0;
    this.firstRtt = true;

    this.priorCwnd = 0;
    this.priorSsthresh = 0;
    this.spuriousRecoveryCount = 0;

    this.isRunning = false;
    this.isPaused = false;
    this.fileId = 0;
  }

  async connect() {
    if (this.multiPath) {
      this.scheduler = new MultiPathScheduler(this.paths);
      this.scheduler.setSchedulingAlgorithm(this.schedulingAlgorithm);

      this.scheduler.on('message', (msg, rinfo, pathId) => {
        this.handleMessage(msg, rinfo, pathId);
      });

      this.scheduler.on('error', (err, pathId) => {
        this.emit('error', err, pathId);
      });

      this.scheduler.on('pathStatsUpdated', (pathId, pathStats) => {
        this.emit('pathStatsUpdated', pathId, pathStats);
        this.stats.pathStats = this.scheduler.getAllStats();
      });

      this.scheduler.on('scheduled', (info) => {
        this.emit('scheduled', info);
      });

      await this.scheduler.connect();
      this.stats.pathStats = this.scheduler.getAllStats();
      this.emit('connected', { multiPath: true, paths: this.scheduler.getPathsConfig() });
      return;
    }

    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket('udp4');
      this.socket.on('message', this.handleMessage.bind(this));
      this.socket.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });
      this.socket.bind(0, () => {
        this.emit('connected', this.socket.address());
        resolve();
      });
    });
  }

  handleMessage(msg, rinfo) {
    const packet = parsePacket(msg);
    if (!packet) return;

    switch (packet.type) {
      case 'ACK':
        this.handleAck(packet);
        break;
      case 'RESUME_ACK':
        this.handleResumeAck(packet);
        break;
    }
  }

  handleAck(packet) {
    const ackNum = packet.ackNumber;

    if (ackNum === 0 && this.sendBase === 0 && this.acked.size === 0) {
      this.emit('ack', 0);
      return;
    }

    if (ackNum <= this.sendBase || this.acked.has(ackNum)) {
      this.stats.duplicateAcks++;
      const count = (this.duplicateAckCount.get(ackNum) || 0) + 1;
      this.duplicateAckCount.set(ackNum, count);

      this.resetRetransmitTimersForWindow(ackNum);

      if (count >= 3) {
        this.fastRetransmit(ackNum);
      }
      return;
    }

    const isSpuriousRetrans = this.detectSpuriousRetransmission(ackNum);
    if (isSpuriousRetrans) {
      this.recoverFromSpuriousRetransmission();
    }

    this.acked.add(ackNum);
    this.stats.ackedChunks++;
    this.stats.cwnd = this.cwnd;
    this.stats.ssthresh = this.ssthresh;

    if (this.sentTimes.has(ackNum)) {
      const rtt = Date.now() - this.sentTimes.get(ackNum);
      const isRetrans = this.retransmitTimes.has(ackNum);

      if (!isRetrans) {
        this.updateRto(rtt);
      }

      if (this.multiPath && this.scheduler) {
        this.scheduler.recordAck(ackNum, rtt, isRetrans);
      }

      this.sentTimes.delete(ackNum);
    }

    this.retransmitTimes.delete(ackNum);

    if (this.retransmitTimers.has(ackNum)) {
      clearTimeout(this.retransmitTimers.get(ackNum));
      this.retransmitTimers.delete(ackNum);
    }

    while (this.acked.has(this.sendBase + 1)) {
      this.sendBase++;
      if (this.cwnd < this.ssthresh) {
        this.cwnd += 1;
      } else {
        this.cwnd += 1 / Math.max(1, Math.floor(this.cwnd));
      }
    }

    this.duplicateAckCount.clear();
    this.stats.cwnd = Math.floor(this.cwnd);
    this.emit('ack', ackNum);
    this.emit('stats', this.stats.toJSON());

    if (this.sendBase >= this.chunks.length) {
      this.emit('complete');
    } else {
      this.sendWindow();
    }
  }

  handleResumeAck(packet) {
    this.emit('resumeAck', packet);
  }

  detectSpuriousRetransmission(ackNum) {
    if (!this.retransmitTimes.has(ackNum)) return false;

    const firstSentTime = this.sentTimes.get(ackNum);
    const retransmitTime = this.retransmitTimes.get(ackNum);
    const now = Date.now();

    if (firstSentTime && retransmitTime) {
      const rttFromFirst = now - firstSentTime;
      const rttFromRetrans = now - retransmitTime;

      if (rttFromFirst > rttFromRetrans && rttFromFirst > this.srtt * 2) {
        this.spuriousRecoveryCount++;
        return true;
      }
    }

    return false;
  }

  recoverFromSpuriousRetransmission() {
    if (this.priorCwnd > 0) {
      this.cwnd = Math.max(this.cwnd, this.priorCwnd);
      this.ssthresh = Math.max(this.ssthresh, this.priorSsthresh);
      this.stats.cwnd = Math.floor(this.cwnd);
      this.stats.ssthresh = this.ssthresh;
      this.stats.spuriousRecoveries++;

      if (this.stats.lostPackets > 0) {
        this.stats.lostPackets = Math.max(0, this.stats.lostPackets - 1);
      }

      this.priorCwnd = 0;
      this.priorSsthresh = 0;
    }
  }

  resetRetransmitTimersForWindow(ackNum) {
    const windowEnd = Math.min(
      this.sendBase + Math.floor(this.cwnd) + 1,
      this.chunks.length
    );

    for (let seq = this.sendBase + 1; seq < windowEnd; seq++) {
      if (this.acked.has(seq)) continue;
      if (!this.retransmitTimers.has(seq)) continue;

      clearTimeout(this.retransmitTimers.get(seq));

      const timer = setTimeout(() => {
        this.timeoutRetransmit(seq);
      }, this.rto);

      this.retransmitTimers.set(seq, timer);
    }
  }

  updateRto(rtt) {
    if (this.firstRtt) {
      this.srtt = rtt;
      this.rttvar = rtt / 2;
      this.firstRtt = false;
    } else {
      const alpha = 0.125;
      const beta = 0.25;
      this.rttvar = (1 - beta) * this.rttvar + beta * Math.abs(this.srtt - rtt);
      this.srtt = (1 - alpha) * this.srtt + alpha * rtt;
    }
    this.rto = Math.max(this.rtoMin, Math.min(this.srtt + Math.max(100, 4 * this.rttvar), this.rtoMax));
    this.stats.rtt = this.srtt;
    this.stats.rto = this.rto;
  }

  fastRetransmit(ackNum) {
    if (this.priorCwnd === 0) {
      this.priorCwnd = this.cwnd;
      this.priorSsthresh = this.ssthresh;
    }

    this.ssthresh = Math.max(2, Math.floor(this.cwnd / 2));
    this.cwnd = this.ssthresh + 3;
    this.stats.cwnd = Math.floor(this.cwnd);
    this.stats.ssthresh = this.ssthresh;

    const retransmitSeq = ackNum + 1;
    if (retransmitSeq < this.chunks.length && !this.acked.has(retransmitSeq)) {
      this.retransmit(retransmitSeq);
    }
  }

  timeoutRetransmit(seqNum) {
    if (this.acked.has(seqNum)) return;

    this.stats.lostPackets++;

    if (this.multiPath && this.scheduler) {
      this.scheduler.recordLoss(seqNum);
    }

    if (this.priorCwnd === 0) {
      this.priorCwnd = this.cwnd;
      this.priorSsthresh = this.ssthresh;
    }

    this.ssthresh = Math.max(2, Math.floor(this.cwnd / 2));
    this.cwnd = this.initialCwnd;
    this.stats.cwnd = Math.floor(this.cwnd);
    this.stats.ssthresh = this.ssthresh;

    this.retransmit(seqNum);
  }

  retransmit(seqNum) {
    if (this.acked.has(seqNum)) return;

    this.stats.retransmittedChunks++;
    this.sendChunk(seqNum, true);
  }

  sendChunk(seqNum, isRetransmit = false) {
    const chunk = this.chunks[seqNum];
    if (!chunk) return;

    const packet = createDataPacket(seqNum, chunk);
    const now = Date.now();

    if (!isRetransmit) {
      this.stats.sentChunks++;
      this.stats.sentBytes += chunk.length;
      this.sentTimes.set(seqNum, now);
    } else {
      this.retransmitTimes.set(seqNum, now);
    }

    if (this.multiPath && this.scheduler) {
      if (!isRetransmit && !this.scheduler.seqToPath.has(seqNum)) {
        this.scheduler.scheduleNext(seqNum);
      } else if (isRetransmit) {
        if (!this.scheduler.seqToPath.has(seqNum)) {
          this.scheduler.scheduleNext(seqNum);
        }
      }

      this.scheduler.send(packet, seqNum, this.host).catch((err) => {
        this.emit('error', err);
      });
    } else {
      this.socket.send(packet, this.port, this.host, (err) => {
        if (err) this.emit('error', err);
      });
    }

    if (this.retransmitTimers.has(seqNum)) {
      clearTimeout(this.retransmitTimers.get(seqNum));
    }

    const timer = setTimeout(() => {
      this.timeoutRetransmit(seqNum);
    }, this.rto);
    this.retransmitTimers.set(seqNum, timer);
  }

  sendWindow() {
    if (!this.isRunning || this.isPaused) return;

    const windowEnd = Math.min(
      this.sendBase + Math.floor(this.cwnd),
      this.chunks.length
    );

    while (this.nextSeqNum < windowEnd) {
      if (!this.acked.has(this.nextSeqNum)) {
        this.sendChunk(this.nextSeqNum);
      }
      this.nextSeqNum++;
    }
  }

  async sendFile(fileBuffer, fileName, fileId = Date.now() % 0xFFFFFFFF) {
    this.fileId = fileId;
    this.chunks = this.splitFile(fileBuffer);
    this.stats.totalBytes = fileBuffer.length;
    this.stats.totalChunks = this.chunks.length;
    this.stats.start();
    this.isRunning = true;

    const totalChunks = this.chunks.length;
    const synPacket = createSynPacket(fileId, fileBuffer.length, fileName, totalChunks);

    await this.sendReliable(synPacket, 'SYN');

    this.emit('start', {
      fileId,
      fileName,
      fileSize: fileBuffer.length,
      totalChunks,
    });

    this.sendWindow();

    return new Promise((resolve) => {
      this.once('complete', async () => {
        this.isRunning = false;
        this.stats.end();
        const finPacket = createFinPacket(fileId);
        await this.sendReliable(finPacket, 'FIN');
        this.cleanup();
        resolve(this.stats.toJSON());
      });
    });
  }

  async sendReliable(packet, type, maxRetries = 10) {
    return new Promise((resolve, reject) => {
      let retries = 0;
      let acked = false;
      const expectedAck = type === 'SYN' ? 0 : this.chunks.length;

      const onAck = (ackNum) => {
        if (type === 'SYN' || ackNum >= expectedAck) {
          acked = true;
          cleanup();
          resolve();
        }
      };

      const send = () => {
        if (retries >= maxRetries) {
          cleanup();
          reject(new Error(`Max retries exceeded for ${type}`));
          return;
        }

        const sendCallback = (err) => {
          if (err) {
            cleanup();
            reject(err);
          }
        };

        if (this.multiPath && this.scheduler) {
          const sendPromises = [];
          for (const [pathId, path] of this.scheduler.paths) {
            if (path.enabled) {
              const socket = this.scheduler.sockets.get(pathId);
              if (socket) {
                sendPromises.push(new Promise((res, rej) => {
                  socket.send(packet, path.remotePort, this.host, (err) => {
                    if (err) rej(err);
                    else res();
                  });
                }));
              }
            }
          }
          Promise.all(sendPromises).catch(sendCallback);
        } else {
          this.socket.send(packet, this.port, this.host, sendCallback);
        }

        retries++;
        timer = setTimeout(send, this.rto * Math.min(retries, 8));
      };

      const cleanup = () => {
        this.removeListener('ack', onAck);
        if (timer) clearTimeout(timer);
      };

      let timer;
      this.on('ack', onAck);
      send();
    });
  }

  splitFile(buffer) {
    const chunks = [];
    for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
      chunks.push(buffer.slice(i, i + CHUNK_SIZE));
    }
    return chunks;
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
    this.sendWindow();
  }

  cleanup() {
    this.retransmitTimers.forEach((timer) => clearTimeout(timer));
    this.retransmitTimers.clear();
    this.retransmitTimes.clear();
    this.sentTimes.clear();
    this.acked.clear();
    this.duplicateAckCount.clear();
    this.priorCwnd = 0;
    this.priorSsthresh = 0;
    if (this.scheduler) {
      this.scheduler.cleanup();
    }
  }

  close() {
    this.isRunning = false;
    this.cleanup();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    if (this.scheduler) {
      this.scheduler.close();
      this.scheduler = null;
    }
  }
}

module.exports = ReliableUDPSender;
