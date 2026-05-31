const dgram = require('dgram');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const {
  createAckPacket,
  createResumeAck,
  parsePacket,
  CHUNK_SIZE,
} = require('./protocol');
const { TransferStats } = require('./stats');

const DEFAULT_RECEIVE_PORTS = [41234, 41235];

class ReliableUDPReceiver extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || 41234;
    this.ports = options.ports || DEFAULT_RECEIVE_PORTS;
    this.outputDir = options.outputDir || './received_files';
    this.windowSize = options.windowSize || 65535;
    this.multiPath = options.multiPath || this.ports.length > 1;

    this.sockets = new Map();
    this.pathStats = new Map();
    this.clientAddress = null;
    this.clientPorts = new Map();

    this.transfers = new Map();
    this.stats = new TransferStats();

    this.ports.forEach((port, index) => {
      const pathId = index === 0 ? 'wifi' : 'ethernet';
      const pathName = index === 0 ? 'WiFi' : '有线网络';
      this.pathStats.set(port, {
        pathId,
        name: pathName,
        port,
        receivedPackets: 0,
        totalPackets: 0,
      });
    });
  }

  async start() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const bindPromises = [];

    for (const port of this.ports) {
      bindPromises.push(this.bindPort(port));
    }

    const results = await Promise.all(bindPromises);
    this.emit('listening', results);
    return results;
  }

  async bindPort(port) {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');

      socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo, port);
      });

      socket.on('error', (err) => {
        this.emit('error', err, port);
        reject(err);
      });

      socket.bind(port, () => {
        this.sockets.set(port, socket);
        resolve({ port, address: socket.address() });
      });
    });
  }

  handleMessage(msg, rinfo, receivePort) {
    const packet = parsePacket(msg);
    if (!packet) return;

    this.clientAddress = rinfo.address;
    this.clientPorts.set(receivePort, rinfo.port);

    const pathStat = this.pathStats.get(receivePort);
    if (pathStat) {
      pathStat.receivedPackets++;
      pathStat.totalPackets++;
      if (packet.type === 'DATA') {
        this.emit('pathPacketReceived', {
          port: receivePort,
          pathId: pathStat.pathId,
          pathName: pathStat.name,
          seq: packet.sequenceNumber,
          size: packet.length,
        });
      }
    }

    switch (packet.type) {
      case 'SYN':
        this.handleSyn(packet);
        break;
      case 'DATA':
        this.handleData(packet, receivePort);
        break;
      case 'FIN':
        this.handleFin(packet);
        break;
      case 'RESUME_REQ':
        this.handleResumeRequest(packet);
        break;
    }
  }

  handleSyn(packet) {
    const { fileId, fileSize, fileName, totalChunks } = packet;

    if (this.transfers.has(fileId)) {
      const transfer = this.transfers.get(fileId);
      if (transfer.complete) {
        this.sendAck(0);
        return;
      }
    }

    const safeFileName = path.basename(fileName);
    const filePath = path.join(this.outputDir, safeFileName);
    const tempPath = filePath + '.tmp';
    const statePath = filePath + '.state';

    let receivedBitmap = new Array(Math.ceil(totalChunks / 8)).fill(0);
    let receivedCount = 0;
    let nextSeqExpected = 0;

    if (fs.existsSync(statePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (state.fileId === fileId && state.totalChunks === totalChunks) {
          receivedBitmap = state.receivedBitmap;
          receivedCount = state.receivedCount;
          nextSeqExpected = state.nextSeqExpected;
          this.emit('resume', { fileId, fileName, receivedCount, totalChunks });
        }
      } catch (e) {
        // ignore corrupted state
      }
    }

    if (!fs.existsSync(tempPath)) {
      const fd = fs.openSync(tempPath, 'w');
      fs.ftruncateSync(fd, fileSize);
      fs.closeSync(fd);
    }

    const transfer = {
      fileId,
      fileName: safeFileName,
      fileSize,
      totalChunks,
      receivedBitmap,
      receivedCount,
      nextSeqExpected,
      filePath,
      tempPath,
      statePath,
      chunks: new Map(),
      complete: false,
    };

    this.transfers.set(fileId, transfer);

    this.stats = new TransferStats();
    this.stats.totalBytes = fileSize;
    this.stats.totalChunks = totalChunks;
    this.stats.receivedChunks = receivedCount;
    this.stats.receivedBytes = receivedCount * CHUNK_SIZE;
    this.stats.start();

    this.sendAck(0);
    this.emit('start', { fileId, fileName: safeFileName, fileSize, totalChunks });
    this.emit('stats', this.stats.toJSON());
  }

  handleData(packet, receivePort) {
    const { sequenceNumber, data } = packet;

    let transfer = null;
    for (const t of this.transfers.values()) {
      if (!t.complete) {
        transfer = t;
        break;
      }
    }

    if (!transfer) return;

    if (sequenceNumber >= transfer.totalChunks) {
      this.sendAck(transfer.nextSeqExpected - 1);
      return;
    }

    if (this.isChunkReceived(transfer, sequenceNumber)) {
      this.sendAck(transfer.nextSeqExpected - 1);
      return;
    }

    this.markChunkReceived(transfer, sequenceNumber);

    const fd = fs.openSync(transfer.tempPath, 'r+');
    fs.writeSync(fd, data, 0, data.length, sequenceNumber * CHUNK_SIZE);
    fs.closeSync(fd);

    transfer.receivedCount++;
    this.stats.receivedChunks = transfer.receivedCount;
    this.stats.receivedBytes = Math.min(
      transfer.receivedCount * CHUNK_SIZE,
      transfer.fileSize
    );

    while (this.isChunkReceived(transfer, transfer.nextSeqExpected)) {
      transfer.nextSeqExpected++;
    }

    this.saveState(transfer);
    this.sendAck(transfer.nextSeqExpected - 1);
    this.emit('stats', this.stats.toJSON());

    if (transfer.receivedCount >= transfer.totalChunks) {
      this.finalizeTransfer(transfer);
    }
  }

  handleFin(packet) {
    const { fileId } = packet;
    const transfer = this.transfers.get(fileId);
    if (!transfer) return;

    if (transfer.receivedCount >= transfer.totalChunks) {
      this.finalizeTransfer(transfer);
    }

    this.sendAck(transfer.totalChunks);
  }

  handleResumeRequest(packet) {
    const { fileId } = packet;
    const transfer = this.transfers.get(fileId);

    if (transfer) {
      const ack = createResumeAck(fileId, transfer.receivedBitmap);
      if (this.multiPath) {
        for (const [receivePort, clientPort] of this.clientPorts) {
          const socket = this.sockets.get(receivePort);
          if (socket && this.clientAddress && clientPort) {
            socket.send(ack, clientPort, this.clientAddress);
          }
        }
      } else {
        const firstPort = this.ports[0];
        const socket = this.sockets.get(firstPort) || this.socket;
        const clientPort = this.clientPorts.get(firstPort) || this.clientPort;
        if (socket && this.clientAddress && clientPort) {
          socket.send(ack, clientPort, this.clientAddress);
        }
      }
    }
  }

  isChunkReceived(transfer, seq) {
    const byteIndex = Math.floor(seq / 8);
    const bitIndex = seq % 8;
    return (transfer.receivedBitmap[byteIndex] & (1 << bitIndex)) !== 0;
  }

  markChunkReceived(transfer, seq) {
    const byteIndex = Math.floor(seq / 8);
    const bitIndex = seq % 8;
    transfer.receivedBitmap[byteIndex] |= (1 << bitIndex);
  }

  saveState(transfer) {
    const state = {
      fileId: transfer.fileId,
      fileName: transfer.fileName,
      fileSize: transfer.fileSize,
      totalChunks: transfer.totalChunks,
      receivedBitmap: transfer.receivedBitmap,
      receivedCount: transfer.receivedCount,
      nextSeqExpected: transfer.nextSeqExpected,
    };
    fs.writeFileSync(transfer.statePath, JSON.stringify(state));
  }

  sendAck(ackNumber) {
    const safeAck = Math.max(0, Math.floor(ackNumber));
    const ack = createAckPacket(safeAck, this.windowSize);

    if (this.multiPath) {
      for (const [receivePort, clientPort] of this.clientPorts) {
        const socket = this.sockets.get(receivePort);
        if (socket && this.clientAddress && clientPort) {
          socket.send(ack, clientPort, this.clientAddress);
        }
      }
    } else {
      const firstPort = this.ports[0];
      const socket = this.sockets.get(firstPort) || this.socket;
      const clientPort = this.clientPorts.get(firstPort) || this.clientPort;
      if (socket && this.clientAddress && clientPort) {
        socket.send(ack, clientPort, this.clientAddress);
      }
    }
  }

  finalizeTransfer(transfer) {
    if (transfer.complete) return;

    transfer.complete = true;
    this.stats.end();

    try {
      fs.renameSync(transfer.tempPath, transfer.filePath);
      if (fs.existsSync(transfer.statePath)) {
        fs.unlinkSync(transfer.statePath);
      }
    } catch (e) {
      this.emit('error', e);
    }

    this.emit('complete', {
      fileId: transfer.fileId,
      fileName: transfer.fileName,
      filePath: transfer.filePath,
      fileSize: transfer.fileSize,
      stats: this.stats.toJSON(),
    });
  }

  close() {
    for (const [port, socket] of this.sockets) {
      try {
        socket.close();
      } catch (e) {}
    }
    this.sockets.clear();

    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }
  }

  getPathStats() {
    const result = {};
    for (const [port, stat] of this.pathStats) {
      result[stat.pathId] = {
        ...stat,
        receiveRate: this.stats.receivedBytes > 0
          ? (stat.receivedPackets / Math.max(1, this.stats.receivedChunks) * 100).toFixed(1) + '%'
          : '0%',
      };
    }
    return result;
  }
}

module.exports = ReliableUDPReceiver;
