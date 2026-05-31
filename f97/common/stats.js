class TransferStats {
  constructor() {
    this.startTime = 0;
    this.endTime = 0;
    this.totalBytes = 0;
    this.sentBytes = 0;
    this.receivedBytes = 0;
    this.totalChunks = 0;
    this.sentChunks = 0;
    this.ackedChunks = 0;
    this.receivedChunks = 0;
    this.retransmittedChunks = 0;
    this.lostPackets = 0;
    this.duplicateAcks = 0;
    this.currentWindowSize = 0;
    this.cwnd = 0;
    this.ssthresh = 0;
    this.rtt = 0;
    this.rto = 1000;
    this.spuriousRecoveries = 0;
    this.pathStats = {};
    this.samples = [];
  }

  start() {
    this.startTime = Date.now();
  }

  end() {
    this.endTime = Date.now();
  }

  getElapsedMs() {
    const end = this.endTime || Date.now();
    return end - this.startTime;
  }

  getThroughput() {
    const elapsed = this.getElapsedMs() / 1000;
    if (elapsed === 0) return 0;
    return (this.receivedBytes || this.sentBytes) / elapsed;
  }

  getProgress() {
    if (this.totalBytes === 0) return 0;
    const total = this.ackedChunks || this.receivedChunks;
    return (total / this.totalChunks) * 100;
  }

  getRetransmissionRate() {
    if (this.sentChunks === 0) return 0;
    return (this.retransmittedChunks / this.sentChunks) * 100;
  }

  getLossRate() {
    const total = this.sentChunks || (this.receivedChunks + this.lostPackets);
    if (total === 0) return 0;
    return (this.lostPackets / total) * 100;
  }

  toJSON() {
    return {
      progress: parseFloat(this.getProgress().toFixed(2)),
      throughput: parseFloat(this.getThroughput().toFixed(2)),
      throughputStr: formatBytes(this.getThroughput()) + '/s',
      elapsedMs: this.getElapsedMs(),
      totalBytes: this.totalBytes,
      totalBytesStr: formatBytes(this.totalBytes),
      sentBytes: this.sentBytes,
      receivedBytes: this.receivedBytes,
      totalChunks: this.totalChunks,
      sentChunks: this.sentChunks,
      ackedChunks: this.ackedChunks,
      receivedChunks: this.receivedChunks,
      retransmittedChunks: this.retransmittedChunks,
      lostPackets: this.lostPackets,
      duplicateAcks: this.duplicateAcks,
      retransmissionRate: parseFloat(this.getRetransmissionRate().toFixed(2)),
      lossRate: parseFloat(this.getLossRate().toFixed(2)),
      cwnd: this.cwnd,
      ssthresh: this.ssthresh,
      rtt: parseFloat(this.rtt.toFixed(0)),
      rto: this.rto,
      spuriousRecoveries: this.spuriousRecoveries,
      pathStats: this.pathStats,
    };
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = { TransferStats, formatBytes };
