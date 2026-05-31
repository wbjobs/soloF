import { DiscoveryClient } from './discovery.js';
import { CRDTHandler } from './crdt.js';
import { MeshNetwork } from './mesh.js';
import { createTextEditor } from './editor.js';

const $ = (sel) => document.querySelector(sel);

const lobby = $('#lobby');
const editorShell = $('#editorShell');
const roomInfo = $('#roomInfo');
const roomIdText = $('#roomIdText');
const myNameText = $('#myNameText');
const copyRoomBtn = $('#copyRoomBtn');
const leaveBtn = $('#leaveBtn');
const createBtn = $('#createBtn');
const joinBtn = $('#joinBtn');
const nameInput = $('#nameInput');
const joinIdInput = $('#joinIdInput');
const peerList = $('#peerList');
const modeText = $('#modeText');
const logEl = $('#log');
const editorContainer = $('#editorContainer');

let discovery = null;
let crdt = null;
let mesh = null;
let editor = null;
let peerMeta = new Map();

function log(msg, level = '') {
  const line = document.createElement('div');
  line.className = 'line ' + level;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/discovery`;
}

function colorForPeer(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

function renderPeers(peers) {
  peerList.innerHTML = '';
  for (const [id, meta] of peerMeta.entries()) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = meta.color;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = meta.name || id;
    const state = document.createElement('span');
    state.className = 'state';
    const p = peers && peers[id];
    if (p && p.iceFailed) state.textContent = '已降级';
    else if (p && p.open) state.textContent = 'P2P';
    else if (p) state.textContent = '连接中...';
    else state.textContent = '—';
    li.appendChild(dot);
    li.appendChild(name);
    li.appendChild(state);
    peerList.appendChild(li);
  }
}

function setMode(relay) {
  modeText.textContent = relay ? '中继 (Relay)' : 'P2P';
  modeText.classList.toggle('relay', !!relay);
}

function enterRoom(roomId, name, isCreator) {
  lobby.hidden = true;
  editorShell.hidden = false;
  roomInfo.hidden = false;
  roomIdText.textContent = roomId;
  myNameText.textContent = name;

  crdt = new CRDTHandler(roomId);

  discovery = new DiscoveryClient(wsUrl());
  discovery.onOpen = () => log('已连接到 Discovery 服务', 'ok');
  discovery.onClose = () => log('与 Discovery 服务断开，正在重连...', 'warn');
  discovery.onError = (err) => log('Discovery 错误: ' + String(err || '未知'), 'err');

  mesh = new MeshNetwork(discovery, crdt);

  crdt.onLocalUpdate = (update) => {
    mesh.broadcast(update);
  };

  crdt.onRemoteUpdate = (update) => {
    mesh.broadcast(update);
  };

  crdt.awareness.on('update', () => {
    const u = crdt.awareness.encodeUpdate();
    const msg = JSON.stringify({ t: 'awareness', u: Array.from(u) });
    mesh.broadcast(msg, { reliable: false });
  });

  mesh.onPeerStateChange = (info) => {
    renderPeers(info);
    if (editor) editor.refresh();
  };
  mesh.onRelayModeChange = (relay) => {
    setMode(relay);
    log(relay ? 'ICE 失败，切换到 Discovery 中继模式（性能下降）' : '恢复 P2P 直连', relay ? 'warn' : 'ok');
  };

  discovery.onRoomCreated = (msg) => {
    log('房间已创建: ' + String(msg.roomId), 'ok');
    for (const p of msg.peers || []) {
      peerMeta.set(p.id, { name: p.name, color: colorForPeer(p.id) });
      mesh.addPeer(p.id, { polite: false, initiator: true });
      log('向 ' + (p.name || p.id) + ' 发起 P2P 连接');
    }
    renderPeers();
  };

  discovery.onRoomJoined = (msg) => {
    log('已加入房间: ' + String(msg.roomId), 'ok');
    setMode(!!msg.relayOn);
    if (msg.relayOn) {
      mesh.relayMode = true;
      log('房间已处于中继模式', 'warn');
    }
    for (const p of msg.peers || []) {
      peerMeta.set(p.id, { name: p.name, color: colorForPeer(p.id) });
    }
    renderPeers();
  };

  discovery.onPeerJoined = (msg) => {
    log(String(msg.name || msg.peerId) + ' 加入房间');
    peerMeta.set(msg.peerId, { name: msg.name, color: colorForPeer(msg.peerId) });
    mesh.addPeer(msg.peerId, { polite: false, initiator: true });
    renderPeers();
  };

  discovery.onPeerLeft = (msg) => {
    log(String(msg.peerId) + ' 离开房间', 'warn');
    peerMeta.delete(msg.peerId);
    mesh.removePeer(msg.peerId);
    renderPeers();
    if (editor) editor.refresh();
  };

  discovery.onSignal = (msg) => {
    mesh.handleSignal(msg.from, msg.data);
  };

  discovery.onRelay = (msg) => {
    mesh.handleRelay(msg.from, msg.payload);
  };

  discovery.onRelayEnabled = () => {
    setMode(true);
    log('中继已启用');
  };

  discovery.connect();
  if (isCreator) discovery.createRoom(name);
  else discovery.joinRoom(roomId, name);

  editor = createTextEditor(editorContainer, crdt, mesh, {
    myName: name,
    myColor: colorForPeer(discovery.peerId || 'self')
  });
  setTimeout(() => editor.focus(), 50);
}

function leaveRoom() {
  if (editor) { editor.destroy(); editor = null; }
  if (mesh) { mesh.destroy(); mesh = null; }
  if (discovery) { discovery.close(); discovery = null; }
  if (crdt) { crdt.destroy(); crdt = null; }
  peerMeta.clear();
  editorContainer.innerHTML = '';
  peerList.innerHTML = '';
  logEl.innerHTML = '';
  lobby.hidden = false;
  editorShell.hidden = true;
  roomInfo.hidden = true;
}

createBtn.addEventListener('click', () => {
  const name = (nameInput.value || '').trim() || `user-${Math.random().toString(36).slice(2, 6)}`;
  nameInput.value = name;
  enterRoom(null, name, true);
});

joinBtn.addEventListener('click', () => {
  const roomId = (joinIdInput.value || '').trim();
  if (!roomId) {
    alert('请输入房间 ID');
    return;
  }
  const name = (nameInput.value || '').trim() || `user-${Math.random().toString(36).slice(2, 6)}`;
  nameInput.value = name;
  enterRoom(roomId, name, false);
});

copyRoomBtn.addEventListener('click', async () => {
  const id = roomIdText.textContent;
  try {
    await navigator.clipboard.writeText(id);
    copyRoomBtn.textContent = '已复制';
    setTimeout(() => copyRoomBtn.textContent = '复制', 1200);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = id;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }
});

leaveBtn.addEventListener('click', leaveRoom);

window.addEventListener('beforeunload', () => {
  if (discovery) discovery.close();
});
