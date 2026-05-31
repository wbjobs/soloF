const express = require('express');
const http = require('http');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const ReliableUDPSender = require('../common/ReliableUDPSender');
const { formatBytes } = require('../common/stats');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: Infinity },
});

const UDP_PORT = parseInt(process.env.UDP_PORT || '41234');
const UDP_HOST = process.env.UDP_HOST || '127.0.0.1';
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3000');
const MULTI_PATH = process.env.MULTI_PATH !== 'false';

let currentSender = null;
let currentTransfer = null;

const MULTI_PATH_CONFIG = [
  {
    id: 'wifi',
    type: 'wifi',
    name: 'WiFi',
    localPort: 0,
    remotePort: 41234,
    weight: 1,
    enabled: true,
    color: '#3498db',
  },
  {
    id: 'ethernet',
    type: 'ethernet',
    name: '有线网络',
    localPort: 0,
    remotePort: 41235,
    weight: 1,
    enabled: true,
    color: '#2ecc71',
  },
];

app.get('/api/config', (req, res) => {
  res.json({
    udpHost: UDP_HOST,
    udpPort: UDP_PORT,
    multiPath: MULTI_PATH,
    paths: MULTI_PATH_CONFIG,
  });
});

app.get('/api/paths', (req, res) => {
  if (currentSender && currentSender.scheduler) {
    res.json({
      paths: currentSender.scheduler.getPathsConfig(),
      stats: currentSender.scheduler.getAllStats(),
      algorithm: currentSender.scheduler.schedulingAlgorithm,
    });
  } else {
    res.json({
      paths: MULTI_PATH_CONFIG,
      stats: {},
      algorithm: 'dynamicWeighted',
    });
  }
});

app.post('/api/paths/:pathId/toggle', (req, res) => {
  const { pathId } = req.params;
  const { enabled } = req.body;

  if (currentSender && currentSender.scheduler) {
    currentSender.scheduler.setPathEnabled(pathId, enabled);
    res.json({ success: true, pathId, enabled });
  } else {
    res.status(404).json({ error: 'No active scheduler' });
  }
});

app.post('/api/scheduling-algorithm', (req, res) => {
  const { algorithm } = req.body;
  const validAlgorithms = ['weightedRoundRobin', 'leastLoaded', 'bestHealth', 'dynamicWeighted'];

  if (!validAlgorithms.includes(algorithm)) {
    return res.status(400).json({ error: 'Invalid algorithm', valid: validAlgorithms });
  }

  if (currentSender && currentSender.scheduler) {
    currentSender.scheduler.setSchedulingAlgorithm(algorithm);
    res.json({ success: true, algorithm });
  } else {
    res.status(404).json({ error: 'No active scheduler' });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    hasActiveTransfer: currentSender !== null,
    transfer: currentTransfer
      ? {
          ...currentTransfer,
          stats: currentSender?.stats?.toJSON(),
        }
      : null,
  });
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (currentSender) {
    return res.status(409).json({ error: 'Another transfer is in progress' });
  }

  const filePath = req.file.path;
  const fileName = req.file.originalname;

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileSize = fileBuffer.length;

    const senderOptions = {
      host: UDP_HOST,
      port: UDP_PORT,
      initialCwnd: 20,
      ssthresh: 128,
    };

    if (MULTI_PATH) {
      senderOptions.multiPath = true;
      senderOptions.paths = MULTI_PATH_CONFIG;
      senderOptions.schedulingAlgorithm = 'dynamicWeighted';
    }

    currentSender = new ReliableUDPSender(senderOptions);

    await currentSender.connect();

    if (MULTI_PATH && currentSender.scheduler) {
      currentSender.scheduler.on('pathStatsUpdated', (pathId, pathStats) => {
        io.emit('path:stats', { pathId, pathStats });
      });

      currentSender.scheduler.on('scheduled', (info) => {
        io.emit('path:scheduled', info);
      });
    }

    currentSender.on('start', (info) => {
      currentTransfer = { ...info, status: 'transferring', multiPath: MULTI_PATH };
      io.emit('transfer:start', currentTransfer);
    });

    currentSender.on('stats', (stats) => {
      io.emit('transfer:stats', stats);
    });

    currentSender.on('ack', (ackNum) => {
      io.emit('transfer:ack', { ackNum });
    });

    currentSender.on('complete', () => {
      io.emit('transfer:complete', {
        fileName,
        fileSize,
      });
    });

    res.json({
      success: true,
      message: 'Transfer started',
      fileName,
      fileSize,
      fileSizeStr: formatBytes(fileSize),
    });

    const result = await currentSender.sendFile(fileBuffer, fileName);

    io.emit('transfer:finished', result);

    setTimeout(() => {
      cleanup();
      fs.unlinkSync(filePath);
    }, 1000);
  } catch (err) {
    console.error('Transfer error:', err);
    io.emit('transfer:error', { error: err.message });
    cleanup();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

app.post('/api/pause', (req, res) => {
  if (currentSender) {
    currentSender.pause();
    res.json({ success: true, paused: true });
  } else {
    res.status(404).json({ error: 'No active transfer' });
  }
});

app.post('/api/resume', (req, res) => {
  if (currentSender) {
    currentSender.resume();
    res.json({ success: true, resumed: true });
  } else {
    res.status(404).json({ error: 'No active transfer' });
  }
});

app.post('/api/cancel', (req, res) => {
  cleanup();
  res.json({ success: true, cancelled: true });
});

function cleanup() {
  if (currentSender) {
    currentSender.close();
    currentSender = null;
  }
  currentTransfer = null;
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  if (currentSender && currentTransfer) {
    socket.emit('transfer:start', currentTransfer);
    socket.emit('transfer:stats', currentSender.stats.toJSON());
  }

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

server.listen(HTTP_PORT, () => {
  console.log(`\n=== UDP Reliable File Transfer - Sender ===`);
  console.log(`HTTP Server: http://localhost:${HTTP_PORT}`);
  console.log(`UDP Target: ${UDP_HOST}:${UDP_PORT}`);
  console.log(`WebSocket: ws://localhost:${HTTP_PORT}\n`);
});
