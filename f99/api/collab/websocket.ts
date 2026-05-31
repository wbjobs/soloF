import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import * as syncProtocol from 'y-protocols/sync.js';
import { encoding, decoding } from 'lib0';

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

const CALLBACK_DEBOUNCE_WAIT = 2000;
const CALLBACK_DEBOUNCE_MAXWAIT = 10000;

interface DocState {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Set<WebSocket>;
}

const docs = new Map<string, DocState>();
const COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#22C55E',
  '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#A855F7',
  '#EC4899', '#F43F5E',
];

function getColorForUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

const messageSync = 0;
const messageAwareness = 1;
const messageAuth = 2;

const setupWSConnection = (
  conn: WebSocket,
  req: http.IncomingMessage,
  { docName = '', gc = true }: { docName?: string; gc?: boolean } = {}
) => {
  conn.binaryType = 'arraybuffer';
  const url = new URL(req.url || '/', 'http://localhost');
  const roomId = url.searchParams.get('room') || 'default';
  const userId = url.searchParams.get('userId') || 'anon';
  const userName = url.searchParams.get('name') || 'Anonymous';
  docName = roomId;

  let docState = docs.get(docName);
  if (docState === undefined) {
    const ydoc = new Y.Doc({ gc });
    const awareness = new awarenessProtocol.Awareness(ydoc);
    docState = {
      doc: ydoc,
      awareness,
      conns: new Set(),
    };
    docs.set(docName, docState);
  }
  const { doc, awareness, conns } = docState;
  conns.add(conn);

  const send = (m: Uint8Array) => {
    if (
      conn.readyState !== wsReadyStateConnecting &&
      conn.readyState !== wsReadyStateOpen
    ) {
      closeConn();
    }
    try {
      conn.send(m, (error: any) => {
        error != null && closeConn();
      });
    } catch (e) {
      closeConn();
    }
  };

  const closeConn = () => {
    conns.delete(conn);
    if (conns.size === 0) {
      setTimeout(() => {
        const ds = docs.get(docName);
        if (ds && ds.conns.size === 0) {
          ds.doc.destroy();
          ds.awareness.destroy();
          docs.delete(docName);
        }
      }, CALLBACK_DEBOUNCE_WAIT);
    }
    conn.close();
  };

  conn.on('message', (message) => {
    try {
      const encoder = encoding.createEncoder();
      const decoder = decoding.createDecoder(new Uint8Array(message as ArrayBuffer));
      const messageType = decoding.readVarUint(decoder);
      switch (messageType) {
        case messageSync:
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.readSyncMessage(decoder, encoder, doc, null);
          if (encoding.length(encoder) > 1) {
            send(encoding.toUint8Array(encoder));
          }
          break;
        case messageAwareness: {
          awarenessProtocol.applyAwarenessUpdate(
            awareness,
            decoding.readVarUint8Array(decoder),
            conn
          );
          break;
        }
      }
    } catch (err) {
      console.error('[collab] message error', err);
    }
  });

  const awarenessChangeHandler = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    _conn: WebSocket | null
  ) => {
    const changedClients = added.concat(updated).concat(removed);
    const encoderAwareness = encoding.createEncoder();
    encoding.writeVarUint(encoderAwareness, messageAwareness);
    encoding.writeVarUint8Array(
      encoderAwareness,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
    );
    const buff = encoding.toUint8Array(encoderAwareness);
    conns.forEach((c) => {
      if (c !== conn && c.readyState === wsReadyStateOpen) {
        c.send(buff);
      }
    });
  };

  awareness.on('update', awarenessChangeHandler);
  conn.on('close', () => {
    awareness.off('update', awarenessChangeHandler);
    closeConn();
  });

  const syncEncoder = encoding.createEncoder();
  encoding.writeVarUint(syncEncoder, messageSync);
  syncProtocol.writeSyncStep1(syncEncoder, doc);
  send(encoding.toUint8Array(syncEncoder));

  const awarenessEncoder = encoding.createEncoder();
  encoding.writeVarUint(awarenessEncoder, messageAwareness);
  encoding.writeVarUint8Array(
    awarenessEncoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, [
      ...awareness.getStates().keys(),
    ])
  );
  send(encoding.toUint8Array(awarenessEncoder));
};

export function setupWebSocketServer(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (conn, req) => {
    setupWSConnection(conn, req);
  });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname === '/ws/collab') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  console.log('[Collab] WebSocket server ready on /ws/collab');
}

export function getActiveUsers(roomId: string): Array<{ id: string; name: string; color: string }> {
  const state = docs.get(roomId);
  if (!state) return [];
  const users: Array<{ id: string; name: string; color: string }> = [];
  state.awareness.getStates().forEach((clientState) => {
    if (clientState.user) {
      users.push({
        id: clientState.user.id,
        name: clientState.user.name,
        color: clientState.user.color,
      });
    }
  });
  return users;
}

export { docs, getColorForUserId };
