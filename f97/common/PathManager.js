const EventEmitter = require('events');
const dgram = require('dgram');

const PATH_TYPES = {
  WIFI: 'wifi',
  ETHERNET: 'ethernet',
};

const DEFAULT_PATHS = [
  {
    id: 'wifi',
    type: PATH_TYPES.WIFI,
    name: 'WiFi',
    localPort: 0,
    remotePort: 41234,
    weight: 1,
    enabled: true,
    color: '#3498db',
  },
  {
    id: 'ethernet',
    type: PATH_TYPES.ETHERNET,
    name: '有线网络',
    localPort: 0,
    remotePort: 41235,
    weight: 1,
    enabled: true,
    color: '#2ecc71',
  },
];

class PathStats {
  constructor(pathId) {
    this.pathId = pathId;
    this.sentPackets = 0;
    this.receivedPackets = 0;
    this.lostPackets = 0;
    this.retransmittedPackets = 0;
    this.sentBytes = 0;
    this.receivedBytes = 0;
    this.rttSamples = [];
    this.rtt = 0;
    this.rttvar = 0;
    this.srtt = 0;
    this.lossRate = 0;
    this.weight = 1;
    this.lastUsed = 0;
    this.totalTransmitTime = 0;
    this.samples = [];
    this.maxSamples = 50;
  }

  recordSent(bytes) {
    this.sentPackets++;
    this.sentBytes += bytes;
    this.lastUsed = Date.now();
  }

  recordAck(rtt, isRetrans = false) {
    this.receivedPackets++;
    this.updateRtt(rtt);

    if (isRetrans) {
      this.retransmittedPackets++;
    }

    this.updateMetrics();
  }

  recordLoss() {
    this.lostPackets++;
    this.updateMetrics();
  }

  updateRtt(rtt) {
    if (this.rttSamples.length === 0) {
      this.srtt = rtt;
      this.rttvar = rtt / 2;
    } else {
      const alpha = 0.125;
      const beta = 0.25;
      this.rttvar = (1 - beta) * this.rttvar + beta * Math.abs(this.srtt - rtt);
      this.srtt = (1 - alpha) * this.srtt + alpha * rtt;
    }
    this.rtt = this.srtt;
    this.rttSamples.push(rtt);
    if (this.rttSamples.length > 100) {
      this.rttSamples.shift();
    }

    this.samples.push({
      timestamp: Date.now(),
      rtt: this.rtt,
      lossRate: this.lossRate,
    });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  updateMetrics() {
    const total = this.sentPackets;
    if (total > 0) {
      this.lossRate = (this.lostPackets / total) * 100;
    }
  }

  getHealthScore() {
    const rttWeight = 0.5;
    const lossWeight = 0.5;

    const normalizedRtt = Math.max(0, 1 - (this.rtt / 1000));
    const normalizedLoss = Math.max(0, 1 - (this.lossRate / 20));

    return (normalizedRtt * rttWeight + normalizedLoss * lossWeight);
  }

  getThroughput() {
    if (this.totalTransmitTime === 0) return 0;
    return this.sentBytes / (this.totalTransmitTime / 1000);
  }

  toJSON() {
    return {
      pathId: this.pathId,
      sentPackets: this.sentPackets,
      receivedPackets: this.receivedPackets,
      lostPackets: this.lostPackets,
      retransmittedPackets: this.retransmittedPackets,
      sentBytes: this.sentBytes,
      rtt: parseFloat(this.rtt.toFixed(1)),
      lossRate: parseFloat(this.lossRate.toFixed(2)),
      healthScore: parseFloat(this.getHealthScore().toFixed(3)),
      weight: this.weight,
      samples: this.samples.slice(-30),
    };
  }
}

class MultiPathScheduler extends EventEmitter {
  constructor(paths = DEFAULT_PATHS) {
    super();
    this.paths = new Map();
    this.pathStats = new Map();
    this.seqToPath = new Map();
    this.sockets = new Map();
    this.currentPathIndex = 0;
    this.schedulingAlgorithm = 'weightedRoundRobin';
    this.totalScheduled = 0;

    paths.forEach(path => {
      this.paths.set(path.id, { ...path });
      this.pathStats.set(path.id, new PathStats(path.id));
    });
  }

  async connect() {
    const connectPromises = [];

    for (const [pathId, path] of this.paths) {
      connectPromises.push(this.createSocket(pathId, path));
    }

    await Promise.all(connectPromises);
    this.emit('connected', Array.from(this.paths.keys()));
  }

  async createSocket(pathId, path) {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');

      socket.on('message', (msg, rinfo) => {
        this.emit('message', msg, rinfo, pathId);
      });

      socket.on('error', (err) => {
        this.emit('error', err, pathId);
      });

      socket.bind(path.localPort || 0, () => {
        const address = socket.address();
        path.localPort = address.port;
        this.sockets.set(pathId, socket);
        resolve(address);
      });
    });
  }

  scheduleNext(seqNum) {
    const enabledPaths = this.getEnabledPaths();
    if (enabledPaths.length === 0) {
      throw new Error('No enabled paths available');
    }

    let selectedPath;

    switch (this.schedulingAlgorithm) {
      case 'weightedRoundRobin':
        selectedPath = this.weightedRoundRobin(enabledPaths);
        break;
      case 'leastLoaded':
        selectedPath = this.leastLoaded(enabledPaths);
        break;
      case 'bestHealth':
        selectedPath = this.bestHealth(enabledPaths);
        break;
      case 'dynamicWeighted':
        selectedPath = this.dynamicWeighted(enabledPaths);
        break;
      default:
        selectedPath = this.weightedRoundRobin(enabledPaths);
    }

    this.seqToPath.set(seqNum, selectedPath.id);
    this.totalScheduled++;

    this.emit('scheduled', {
      seqNum,
      pathId: selectedPath.id,
      totalScheduled: this.totalScheduled,
    });

    return selectedPath;
  }

  weightedRoundRobin(enabledPaths) {
    const totalWeight = enabledPaths.reduce((sum, p) => {
      const stats = this.pathStats.get(p.id);
      return sum + (stats?.weight || p.weight || 1);
    }, 0);

    let random = Math.random() * totalWeight;

    for (const path of enabledPaths) {
      const stats = this.pathStats.get(path.id);
      const weight = stats?.weight || path.weight || 1;
      random -= weight;
      if (random <= 0) {
        return path;
      }
    }

    return enabledPaths[enabledPaths.length - 1];
  }

  leastLoaded(enabledPaths) {
    let minLoad = Infinity;
    let selected = enabledPaths[0];

    for (const path of enabledPaths) {
      const stats = this.pathStats.get(path.id);
      const load = stats?.sentPackets || 0;
      if (load < minLoad) {
        minLoad = load;
        selected = path;
      }
    }

    return selected;
  }

  bestHealth(enabledPaths) {
    let bestScore = -Infinity;
    let selected = enabledPaths[0];

    for (const path of enabledPaths) {
      const stats = this.pathStats.get(path.id);
      const score = stats?.getHealthScore() || 0.5;
      if (score > bestScore) {
        bestScore = score;
        selected = path;
      }
    }

    return selected;
  }

  dynamicWeighted(enabledPaths) {
    const weightedPaths = enabledPaths.map(path => {
      const stats = this.pathStats.get(path.id);
      const health = stats?.getHealthScore() || 0.5;
      const baseWeight = path.weight || 1;
      const dynamicWeight = baseWeight * Math.max(0.1, health * 2);
      return { path, dynamicWeight };
    });

    const totalWeight = weightedPaths.reduce((sum, p) => sum + p.dynamicWeight, 0);
    let random = Math.random() * totalWeight;

    for (const { path, dynamicWeight } of weightedPaths) {
      random -= dynamicWeight;
      if (random <= 0) {
        return path;
      }
    }

    return weightedPaths[weightedPaths.length - 1].path;
  }

  send(packet, seqNum, remoteHost, remotePortOverride) {
    const pathId = this.seqToPath.get(seqNum);
    if (!pathId) {
      throw new Error(`No path assigned for sequence ${seqNum}`);
    }

    const path = this.paths.get(pathId);
    const socket = this.sockets.get(pathId);
    const stats = this.pathStats.get(pathId);

    if (!socket) {
      throw new Error(`Socket not found for path ${pathId}`);
    }

    const port = remotePortOverride || path.remotePort;

    return new Promise((resolve, reject) => {
      socket.send(packet, port, remoteHost, (err) => {
        if (err) {
          reject(err);
        } else {
          stats.recordSent(packet.length);
          this.emit('sent', { seqNum, pathId, bytes: packet.length });
          resolve(pathId);
        }
      });
    });
  }

  getPathForSeq(seqNum) {
    return this.seqToPath.get(seqNum);
  }

  recordAck(seqNum, rtt, isRetrans = false) {
    const pathId = this.seqToPath.get(seqNum);
    if (pathId) {
      const stats = this.pathStats.get(pathId);
      if (stats) {
        stats.recordAck(rtt, isRetrans);
        this.adjustWeights();
        this.emit('pathStatsUpdated', pathId, stats.toJSON());
      }
    }
  }

  recordLoss(seqNum) {
    const pathId = this.seqToPath.get(seqNum);
    if (pathId) {
      const stats = this.pathStats.get(pathId);
      if (stats) {
        stats.recordLoss();
        this.adjustWeights();
        this.emit('pathStatsUpdated', pathId, stats.toJSON());
      }
    }
  }

  adjustWeights() {
    for (const [pathId, stats] of this.pathStats) {
      const path = this.paths.get(pathId);
      if (path && path.enabled) {
        const health = stats.getHealthScore();
        stats.weight = Math.max(0.1, path.weight * health * 2);
      }
    }
  }

  getEnabledPaths() {
    return Array.from(this.paths.values()).filter(p => p.enabled);
  }

  setPathEnabled(pathId, enabled) {
    const path = this.paths.get(pathId);
    if (path) {
      path.enabled = enabled;
      this.emit('pathStatusChanged', pathId, enabled);
    }
  }

  setSchedulingAlgorithm(algorithm) {
    this.schedulingAlgorithm = algorithm;
    this.emit('algorithmChanged', algorithm);
  }

  getAllStats() {
    const result = {};
    for (const [pathId, stats] of this.pathStats) {
      result[pathId] = stats.toJSON();
    }
    return result;
  }

  getPathsConfig() {
    return Array.from(this.paths.values());
  }

  cleanup() {
    for (const [pathId, socket] of this.sockets) {
      try {
        socket.close();
      } catch (e) {}
    }
    this.sockets.clear();
    this.seqToPath.clear();
  }

  close() {
    this.cleanup();
  }
}

module.exports = {
  PATH_TYPES,
  DEFAULT_PATHS,
  PathStats,
  MultiPathScheduler,
};
