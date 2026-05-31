const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { initDatabase, saveSnapshot, getSnapshots, getLatestSnapshot } = require('./config/database');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();
const snapshotIntervals = new Map();

const broadcastToRoom = (roomId, message, excludeSocket = null) => {
  const room = rooms.get(roomId);
  if (!room) return;
  
  room.clients.forEach(client => {
    if (client !== excludeSocket && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
};

const handleSnapshot = async (roomId) => {
  const room = rooms.get(roomId);
  if (!room || !room.crdtState || room.clients.size === 0) return;
  
  const timestamp = Date.now();
  try {
    await saveSnapshot(roomId, room.crdtState, timestamp);
    console.log(`Snapshot saved for room ${roomId} at ${timestamp}`);
  } catch (error) {
    console.error('Failed to save snapshot:', error);
  }
};

wss.on('connection', (ws) => {
  let currentRoom = null;
  let userId = uuidv4();
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'join': {
          const { roomId } = message;
          currentRoom = roomId;
          
          if (!rooms.has(roomId)) {
            rooms.set(roomId, {
              clients: new Set(),
              crdtState: { operations: [] },
              peerMap: new Map()
            });
            
            const latestSnapshot = await getLatestSnapshot(roomId);
            if (latestSnapshot) {
              rooms.get(roomId).crdtState = latestSnapshot.data;
            }
            
            snapshotIntervals.set(roomId, setInterval(() => {
              handleSnapshot(roomId);
            }, 5000));
          }
          
          const room = rooms.get(roomId);
          room.clients.add(ws);
          room.peerMap.set(userId, ws);
          
          ws.send(JSON.stringify({
            type: 'init',
            userId,
            roomId,
            state: room.crdtState,
            peers: Array.from(room.peerMap.keys()).filter(id => id !== userId)
          }));
          
          broadcastToRoom(roomId, {
            type: 'peer-joined',
            peerId: userId
          }, ws);
          
          console.log(`User ${userId} joined room ${roomId}. Total: ${room.clients.size}`);
          break;
        }
        
        case 'operation': {
          const { roomId, operation } = message;
          const room = rooms.get(roomId);
          if (room) {
            room.crdtState.operations.push(operation);
            
            broadcastToRoom(roomId, {
              type: 'operation',
              operation
            }, ws);
          }
          break;
        }
        
        case 'webrtc-signal': {
          const { to, from, signal } = message;
          const room = rooms.get(currentRoom);
          if (room && room.peerMap.has(to)) {
            const targetWs = room.peerMap.get(to);
            if (targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(JSON.stringify({
                type: 'webrtc-signal',
                from,
                signal
              }));
            }
          }
          break;
        }
        
        case 'sync-state': {
          const { roomId, state } = message;
          const room = rooms.get(roomId);
          if (room) {
            room.crdtState = state;
          }
          break;
        }
        
        case 'get-history': {
          const { roomId } = message;
          const snapshots = await getSnapshots(roomId);
          ws.send(JSON.stringify({
            type: 'history',
            snapshots
          }));
          break;
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });
  
  ws.on('close', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.clients.delete(ws);
      room.peerMap.delete(userId);
      
      broadcastToRoom(currentRoom, {
        type: 'peer-left',
        peerId: userId
      });
      
      console.log(`User ${userId} left room ${currentRoom}. Remaining: ${room.clients.size}`);
      
      if (room.clients.size === 0) {
        clearInterval(snapshotIntervals.get(currentRoom));
        snapshotIntervals.delete(currentRoom);
        rooms.delete(currentRoom);
        console.log(`Room ${currentRoom} closed`);
      }
    }
  });
});

app.get('/api/history/:roomId', async (req, res) => {
  try {
    const snapshots = await getSnapshots(req.params.roomId);
    res.json(snapshots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;

const startServer = async () => {
  try {
    await initDatabase();
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
