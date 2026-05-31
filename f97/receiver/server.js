const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const ReliableUDPReceiver = require('../common/ReliableUDPReceiver');
const { formatBytes } = require('../common/stats');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const UDP_PORT = parseInt(process.env.UDP_PORT || '41234');
const UDP_PORTS = process.env.UDP_PORTS
  ? process.env.UDP_PORTS.split(',').map(p => parseInt(p))
  : [41234, 41235];
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3001');
const OUTPUT_DIR = path.join(__dirname, '..', 'received_files');
const MULTI_PATH = process.env.MULTI_PATH !== 'false';

const receiverOptions = {
  port: UDP_PORT,
  outputDir: OUTPUT_DIR,
};

if (MULTI_PATH) {
  receiverOptions.ports = UDP_PORTS;
  receiverOptions.multiPath = true;
}

const udpReceiver = new ReliableUDPReceiver(receiverOptions);

let currentTransfer = null;
let transferHistory = [];

const RECEIVE_PATHS = [
  { id: 'wifi', name: 'WiFi', port: UDP_PORTS[0], color: '#3498db' },
  { id: 'ethernet', name: '有线网络', port: UDP_PORTS[1], color: '#2ecc71' },
];

app.get('/api/config', (req, res) => {
  res.json({
    udpPort: UDP_PORT,
    udpPorts: UDP_PORTS,
    outputDir: OUTPUT_DIR,
    multiPath: MULTI_PATH,
    paths: RECEIVE_PATHS,
  });
});

app.get('/api/paths', (req, res) => {
  res.json({
    paths: RECEIVE_PATHS,
    stats: udpReceiver.getPathStats(),
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    hasActiveTransfer: currentTransfer !== null,
    currentTransfer: currentTransfer,
    history: transferHistory.slice(-20),
    pathStats: udpReceiver.getPathStats(),
    multiPath: MULTI_PATH,
  });
});

app.get('/api/files', (req, res) => {
  if (!fs.existsSync(OUTPUT_DIR)) {
    return res.json([]);
  }

  const files = fs.readdirSync(OUTPUT_DIR)
    .filter((f) => !f.endsWith('.tmp') && !f.endsWith('.state'))
    .map((f) => {
      const stat = fs.statSync(path.join(OUTPUT_DIR, f));
      return {
        name: f,
        size: stat.size,
        sizeStr: formatBytes(stat.size),
        modified: stat.mtime,
      };
    })
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));

  res.json(files);
});

udpReceiver.on('listening', (addrs) => {
  if (Array.isArray(addrs)) {
    addrs.forEach(addr => {
      console.log(`UDP Receiver listening on ${addr.address}:${addr.port}`);
    });
  } else {
    console.log(`UDP Receiver listening on ${addrs.address}:${addrs.port}`);
  }
});

udpReceiver.on('start', (info) => {
  currentTransfer = {
    ...info,
    status: 'receiving',
    startTime: Date.now(),
    multiPath: MULTI_PATH,
  };
  io.emit('transfer:start', currentTransfer);
  console.log(`\n=== Receiving file: ${info.fileName} ===`);
  console.log(`File size: ${formatBytes(info.fileSize)}`);
  console.log(`Total chunks: ${info.totalChunks}`);
  console.log(`Multi-path: ${MULTI_PATH ? 'enabled' : 'disabled'}`);
});

udpReceiver.on('resume', (info) => {
  io.emit('transfer:resume', info);
  console.log(`Resuming transfer: ${info.fileName} (${info.receivedCount}/${info.totalChunks} chunks)`);
});

udpReceiver.on('stats', (stats) => {
  const enhancedStats = {
    ...stats,
    pathStats: udpReceiver.getPathStats(),
  };
  io.emit('transfer:stats', enhancedStats);
});

udpReceiver.on('pathPacketReceived', (info) => {
  io.emit('path:packet', info);
});

udpReceiver.on('complete', (result) => {
  currentTransfer = null;
  const record = {
    ...result,
    completedAt: Date.now(),
  };
  transferHistory.push(record);
  io.emit('transfer:complete', record);

  console.log(`\n=== Transfer Complete: ${result.fileName} ===`);
  console.log(`Saved to: ${result.filePath}`);
  console.log(`Size: ${formatBytes(result.fileSize)}`);
  console.log(`Time: ${(result.stats.elapsedMs / 1000).toFixed(2)}s`);
  console.log(`Throughput: ${result.stats.throughputStr}`);
  console.log(`Retransmitted: ${result.stats.retransmittedChunks} chunks (${result.stats.retransmissionRate}%)`);
  console.log(`==========================================\n`);
});

udpReceiver.on('error', (err) => {
  console.error('UDP Receiver error:', err);
  io.emit('transfer:error', { error: err.message });
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  if (currentTransfer) {
    socket.emit('transfer:start', currentTransfer);
    socket.emit('transfer:stats', udpReceiver.stats.toJSON());
  }

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

process.on('SIGINT', () => {
  udpReceiver.close();
  server.close();
  process.exit(0);
});

async function start() {
  await udpReceiver.start();

  server.listen(HTTP_PORT, () => {
    console.log(`\n=== UDP Reliable File Transfer - Receiver ===`);
    console.log(`UDP Port: ${UDP_PORT}`);
    console.log(`HTTP Server: http://localhost:${HTTP_PORT}`);
    console.log(`WebSocket: ws://localhost:${HTTP_PORT}`);
    console.log(`Output Directory: ${OUTPUT_DIR}`);
    console.log(`Monitor: http://localhost:${HTTP_PORT}/receiver.html\n`);
  });
}

start().catch(console.error);
