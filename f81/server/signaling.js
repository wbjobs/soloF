const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;
const MAX_NODES = 10;

const wss = new WebSocket.Server({ port: PORT });

const nodes = new Map();

console.log(`信令服务器启动在端口 ${PORT}`);
console.log(`最大支持 ${MAX_NODES} 个节点同时在线`);

wss.on('connection', (ws) => {
  const nodeId = uuidv4();
  
  if (nodes.size >= MAX_NODES) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `已达到最大节点数限制 (${MAX_NODES})`
    }));
    ws.close();
    return;
  }

  nodes.set(nodeId, {
    id: nodeId,
    ws: ws,
    connectedAt: Date.now()
  });

  console.log(`节点 ${nodeId.substring(0, 8)} 已连接，当前在线: ${nodes.size}/${MAX_NODES}`);

  ws.send(JSON.stringify({
    type: 'connected',
    nodeId: nodeId,
    peerCount: nodes.size - 1
  }));

  broadcast({
    type: 'node-joined',
    nodeId: nodeId,
    peerCount: nodes.size
  }, nodeId);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleMessage(nodeId, data);
    } catch (err) {
      console.error('消息解析错误:', err);
    }
  });

  ws.on('close', () => {
    console.log(`节点 ${nodeId.substring(0, 8)} 已断开，当前在线: ${nodes.size - 1}/${MAX_NODES}`);
    nodes.delete(nodeId);
    broadcast({
      type: 'node-left',
      nodeId: nodeId,
      peerCount: nodes.size
    });
  });

  ws.on('error', (err) => {
    console.error(`节点 ${nodeId.substring(0, 8)} 错误:`, err);
  });
});

function handleMessage(nodeId, data) {
  switch (data.type) {
    case 'offer':
    case 'answer':
    case 'ice-candidate':
      relayMessage(nodeId, data);
      break;
    case 'get-peers':
      sendPeerList(nodeId);
      break;
    case 'broadcast-presence':
      broadcast({
        type: 'peer-presence',
        nodeId: nodeId,
        metadata: data.metadata
      }, nodeId);
      break;
    default:
      console.log(`未知消息类型: ${data.type}`);
  }
}

function relayMessage(fromId, data) {
  const targetId = data.targetId;
  const target = nodes.get(targetId);
  
  if (target && target.ws.readyState === WebSocket.OPEN) {
    target.ws.send(JSON.stringify({
      ...data,
      fromId: fromId
    }));
  }
}

function sendPeerList(nodeId) {
  const node = nodes.get(nodeId);
  if (!node) return;

  const peers = Array.from(nodes.values())
    .filter(n => n.id !== nodeId)
    .map(n => ({ id: n.id }));

  node.ws.send(JSON.stringify({
    type: 'peer-list',
    peers: peers
  }));
}

function broadcast(data, excludeId = null) {
  const message = JSON.stringify(data);
  
  nodes.forEach((node, id) => {
    if (id !== excludeId && node.ws.readyState === WebSocket.OPEN) {
      node.ws.send(message);
    }
  });
}

setInterval(() => {
  broadcast({
    type: 'heartbeat',
    timestamp: Date.now(),
    peerCount: nodes.size
  });
}, 30000);
