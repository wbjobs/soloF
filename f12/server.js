const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json({ limit: '100mb' }));

const MEMORY_LOG_INTERVAL = 10000;
let lastMemoryLog = 0;

function logMemoryUsage() {
  const used = process.memoryUsage();
  console.log(`[Server] 内存使用: RSS=${Math.round(used.rss / 1024 / 1024)}MB, Heap=${Math.round(used.heapUsed / 1024 / 1024)}MB/${Math.round(used.heapTotal / 1024 / 1024)}MB`);
}

setInterval(() => {
  if (Date.now() - lastMemoryLog > MEMORY_LOG_INTERVAL) {
    lastMemoryLog = Date.now();
    logMemoryUsage();
  }
}, 5000);

const fileIndex = new Map();
const transferProgress = new Map();
const connectedPeers = new Map();
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('客户端连接:', socket.id);
  connectedPeers.set(socket.id, {
    socket,
    joinedAt: Date.now(),
    roomId: null
  });

  socket.on('join-room', (roomId) => {
    socket.leaveAll();
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);
    
    if (connectedPeers.has(socket.id)) {
      connectedPeers.get(socket.id).roomId = roomId;
    }
    
    const clientsInRoom = Array.from(rooms.get(roomId) || []);
    io.to(roomId).emit('room-joined', {
      roomId,
      peers: clientsInRoom.filter(id => id !== socket.id)
    });
    
    console.log(`客户端 ${socket.id} 加入房间 ${roomId}, 房间内人数: ${clientsInRoom.length}`);
  });

  socket.on('offer', ({ to, offer }) => {
    if (connectedPeers.has(to)) {
      connectedPeers.get(to).socket.emit('offer', {
        from: socket.id,
        offer
      });
    }
  });

  socket.on('answer', ({ to, answer }) => {
    if (connectedPeers.has(to)) {
      connectedPeers.get(to).socket.emit('answer', {
        from: socket.id,
        answer
      });
    }
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    if (connectedPeers.has(to)) {
      connectedPeers.get(to).socket.emit('ice-candidate', {
        from: socket.id,
        candidate
      });
    }
  });

  socket.on('file-info', (fileInfo) => {
    const fileHash = fileInfo.hash;
    fileIndex.set(fileHash, {
      ...fileInfo,
      uploader: socket.id,
      createdAt: Date.now()
    });
    socket.to(fileInfo.roomId).emit('file-available', {
      fileHash,
      fileName: fileInfo.name,
      fileSize: fileInfo.size,
      totalChunks: fileInfo.totalChunks
    });
  });

  socket.on('request-chunk', ({ fileHash, chunkIndex, to }) => {
    if (connectedPeers.has(to)) {
      connectedPeers.get(to).socket.emit('chunk-request', {
        from: socket.id,
        fileHash,
        chunkIndex
      });
    }
  });

  socket.on('chunk-data', ({ to, fileHash, chunkIndex, data }) => {
    if (connectedPeers.has(to)) {
      connectedPeers.get(to).socket.emit('chunk-data', {
        from: socket.id,
        fileHash,
        chunkIndex,
        data
      });
    }
  });

  socket.on('progress-update', ({ fileHash, receivedChunks, to }) => {
    if (connectedPeers.has(to)) {
      connectedPeers.get(to).socket.emit('progress-update', {
        from: socket.id,
        fileHash,
        receivedChunks
      });
    }
  });

  socket.on('transfer-complete', ({ fileHash, to }) => {
    if (connectedPeers.has(to)) {
      connectedPeers.get(to).socket.emit('transfer-complete', {
        from: socket.id,
        fileHash
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('客户端断开:', socket.id);
    const peer = connectedPeers.get(socket.id);
    if (peer && peer.roomId && rooms.has(peer.roomId)) {
      rooms.get(peer.roomId).delete(socket.id);
      socket.to(peer.roomId).emit('peer-left', socket.id);
      if (rooms.get(peer.roomId).size === 0) {
        rooms.delete(peer.roomId);
      }
    }
    connectedPeers.delete(socket.id);
  });
});

app.get('/api/file/:hash', (req, res) => {
  const fileInfo = fileIndex.get(req.params.hash);
  if (fileInfo) {
    res.json(fileInfo);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

app.post('/api/progress', (req, res) => {
  const { fileHash, peerId, progress } = req.body;
  const key = `${fileHash}-${peerId}`;
  transferProgress.set(key, { progress, updatedAt: Date.now() });
  res.json({ success: true });
});

app.get('/api/progress/:fileHash/:peerId', (req, res) => {
  const key = `${req.params.fileHash}-${req.params.peerId}`;
  const progress = transferProgress.get(key);
  if (progress) {
    res.json(progress);
  } else {
    res.status(404).json({ error: 'Progress not found' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`信令服务器运行在端口 ${PORT}`);
});
