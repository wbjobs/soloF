const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { nanoid } = require('nanoid');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/discovery' });

const rooms = new Map();

function makeRoomId() {
  return nanoid(8);
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      peers: new Map(),
      relayOn: false,
      createdAt: Date.now(),
      ownerId: null,
    });
  }
  return rooms.get(roomId);
}

function broadcastToRoom(room, senderId, payload) {
  const msg = JSON.stringify(payload);
  for (const [peerId, peer] of room.peers.entries()) {
    if (peerId === senderId) continue;
    if (peer.ws.readyState === 1) {
      peer.ws.send(msg);
    }
  }
}

function peerList(room, excludeId) {
  const list = [];
  for (const [peerId, peer] of room.peers.entries()) {
    if (peerId === excludeId) continue;
    list.push({ id: peerId, name: peer.name, isOwner: peerId === room.ownerId });
  }
  return list;
}

function cleanupPeer(ws) {
  const peer = ws.__peer;
  if (!peer) return;
  const { roomId, peerId } = peer;
  const room = rooms.get(roomId);
  if (!room) return;
  room.peers.delete(peerId);
  broadcastToRoom(room, peerId, {
    type: 'peer-left',
    peerId,
    peers: peerList(room),
  });
  if (room.peers.size === 0) {
    rooms.delete(roomId);
  }
}

wss.on('connection', (ws) => {
  ws.__peer = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', error: 'invalid-json' }));
      return;
    }

    const { type } = msg;

    if (type === 'create-room') {
      const roomId = makeRoomId();
      const peerId = nanoid(10);
      const room = getOrCreateRoom(roomId);
      const name = typeof msg.name === 'string' && msg.name.trim()
        ? msg.name.trim().slice(0, 32)
        : `user-${peerId.slice(0, 4)}`;
      const peer = { id: peerId, name, ws };
      room.peers.set(peerId, peer);
      room.ownerId = peerId;
      ws.__peer = { roomId, peerId };
      ws.send(JSON.stringify({
        type: 'room-created',
        roomId,
        peerId,
        name,
        peers: peerList(room),
        isOwner: true,
      }));
      return;
    }

    if (type === 'join-room') {
      const roomId = typeof msg.roomId === 'string' ? msg.roomId.trim() : '';
      if (!roomId) {
        ws.send(JSON.stringify({ type: 'error', error: 'missing-room-id' }));
        return;
      }
      const room = rooms.get(roomId);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', error: 'room-not-found' }));
        return;
      }
      const peerId = nanoid(10);
      const name = typeof msg.name === 'string' && msg.name.trim()
        ? msg.name.trim().slice(0, 32)
        : `user-${peerId.slice(0, 4)}`;
      const peer = { id: peerId, name, ws };
      room.peers.set(peerId, peer);
      ws.__peer = { roomId, peerId };

      ws.send(JSON.stringify({
        type: 'room-joined',
        roomId,
        peerId,
        name,
        peers: peerList(room),
        relayOn: room.relayOn,
        isOwner: peerId === room.ownerId,
      }));

      broadcastToRoom(room, peerId, {
        type: 'peer-joined',
        peerId,
        name,
        peers: peerList(room),
        isOwner: peerId === room.ownerId,
      });
      return;
    }

    const state = ws.__peer;
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', error: 'not-joined' }));
      return;
    }
    const room = rooms.get(state.roomId);
    if (!room) return;

    if (type === 'signal') {
      const { to, data } = msg;
      if (!to || !room.peers.has(to)) {
        ws.send(JSON.stringify({ type: 'error', error: 'unknown-target' }));
        return;
      }
      const target = room.peers.get(to);
      if (target.ws.readyState === 1) {
        target.ws.send(JSON.stringify({
          type: 'signal',
          from: state.peerId,
          data,
        }));
      }
      return;
    }

    if (type === 'request-relay') {
      room.relayOn = true;
      broadcastToRoom(room, state.peerId, {
        type: 'relay-enabled',
        by: state.peerId,
      });
      ws.send(JSON.stringify({ type: 'relay-ack', relayOn: true }));
      return;
    }

    if (type === 'relay') {
      if (!room.relayOn) {
        ws.send(JSON.stringify({ type: 'error', error: 'relay-not-enabled' }));
        return;
      }
      broadcastToRoom(room, state.peerId, {
        type: 'relay',
        from: state.peerId,
        payload: msg.payload,
      });
      return;
    }

    if (type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', ts: msg.ts || Date.now() }));
      return;
    }

    if (type === 'kick') {
      if (state.peerId !== room.ownerId) {
        ws.send(JSON.stringify({ type: 'error', error: 'not-owner' }));
        return;
      }
      const { targetPeerId } = msg;
      const target = room.peers.get(targetPeerId);
      if (!target) {
        ws.send(JSON.stringify({ type: 'error', error: 'peer-not-found' }));
        return;
      }
      if (target.ws.readyState === 1) {
        target.ws.send(JSON.stringify({ type: 'kicked' }));
      }
      setTimeout(() => {
        try { target.ws.close(); } catch {}
      }, 100);
      ws.send(JSON.stringify({ type: 'kick-ack', targetPeerId }));
      return;
    }
  });

  ws.on('close', () => cleanupPeer(ws));
  ws.on('error', () => cleanupPeer(ws));
});

server.listen(PORT, () => {
  console.log(`[discovery] listening on http://localhost:${PORT}`);
  console.log(`[discovery] signaling  on ws://localhost:${PORT}/discovery`);
});
