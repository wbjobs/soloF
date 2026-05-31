const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('客户端连接:', socket.id);

  socket.on('create-room', () => {
    const roomId = generateRoomId();
    rooms.set(roomId, { 
      sender: socket.id,
      receiver: null,
      fileInfo: null,
      transferState: null
    });
    socket.join(roomId);
    socket.emit('room-created', roomId);
    console.log('房间创建:', roomId);
  });

  socket.on('join-room', (roomId) => {
    const room = rooms.get(roomId);
    if (room && room.sender) {
      room.receiver = socket.id;
      socket.join(roomId);
      
      const resumeData = {
        canResume: !!(room.fileInfo && room.transferState),
        fileInfo: room.fileInfo,
        transferState: room.transferState
      };
      
      socket.emit('room-joined', roomId, resumeData);
      io.to(room.sender).emit('receiver-connected', resumeData);
      console.log('接收方加入房间:', roomId, '可恢复:', resumeData.canResume);
    } else {
      socket.emit('error', '房间不存在');
    }
  });

  socket.on('update-transfer-state', (roomId, state) => {
    const room = rooms.get(roomId);
    if (room) {
      room.transferState = state;
      console.log('更新传输状态:', roomId, '已传输:', state.bytesTransferred);
    }
  });

  socket.on('save-file-info', (roomId, fileInfo) => {
    const room = rooms.get(roomId);
    if (room) {
      room.fileInfo = fileInfo;
      console.log('保存文件信息:', roomId, fileInfo.name);
    }
  });

  socket.on('offer', (roomId, offer) => {
    const room = rooms.get(roomId);
    if (room && room.receiver) {
      io.to(room.receiver).emit('offer', offer);
    }
  });

  socket.on('answer', (roomId, answer) => {
    const room = rooms.get(roomId);
    if (room && room.sender) {
      io.to(room.sender).emit('answer', answer);
    }
  });

  socket.on('ice-candidate', (roomId, candidate, isSender) => {
    const room = rooms.get(roomId);
    if (room) {
      const targetId = isSender ? room.receiver : room.sender;
      if (targetId) {
        io.to(targetId).emit('ice-candidate', candidate);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('客户端断开:', socket.id);
    rooms.forEach((room, roomId) => {
      if (room.sender === socket.id || room.receiver === socket.id) {
        io.to(roomId).emit('peer-disconnected');
        if (room.sender === socket.id) {
          room.sender = null;
        }
        if (room.receiver === socket.id) {
          room.receiver = null;
        }
        if (!room.sender && !room.receiver) {
          setTimeout(() => {
            const currentRoom = rooms.get(roomId);
            if (currentRoom && !currentRoom.sender && !currentRoom.receiver) {
              rooms.delete(roomId);
              console.log('房间清理:', roomId);
            }
          }, 5 * 60 * 1000);
        }
        console.log('客户端离开房间:', roomId, '保留传输状态');
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
