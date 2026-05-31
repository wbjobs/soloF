const { ipcRenderer } = require('electron');

const CHUNK_SIZE = 1024 * 1024;
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;
const MAX_PARALLEL_REQUESTS = 5;
const MEMORY_LOG_INTERVAL = 5000;

let socket;
let peerConnections = {};
let selectedFile = null;
let currentRoomId = null;
let lastMemoryLog = 0;

const activeTransfers = new Map();
const selectedPeers = new Set();

const elements = {
  statusIndicator: document.getElementById('status-indicator'),
  statusText: document.getElementById('status-text'),
  roomId: document.getElementById('room-id'),
  joinBtn: document.getElementById('join-btn'),
  peersContainer: document.getElementById('peers-container'),
  dropZone: document.getElementById('drop-zone'),
  fileInput: document.getElementById('file-input'),
  selectedFileDiv: document.getElementById('selected-file'),
  fileName: document.getElementById('file-name'),
  fileSize: document.getElementById('file-size'),
  sendBtn: document.getElementById('send-btn'),
  transferList: document.getElementById('transfer-list'),
  availableFiles: document.getElementById('available-files'),
  transferModal: document.getElementById('transfer-modal'),
  modalFileInfo: document.getElementById('modal-file-info'),
  cancelTransfer: document.getElementById('cancel-transfer'),
  targetSelectPanel: document.getElementById('target-select-panel'),
  targetPeersContainer: document.getElementById('target-peers-container'),
  speedLimit: document.getElementById('speed-limit'),
  selectAllBtn: document.getElementById('select-all-btn'),
  deselectAllBtn: document.getElementById('deselect-all-btn'),
  multiTransferContainer: document.getElementById('multi-transfer-container'),
  pauseAllBtn: document.getElementById('pause-all-btn'),
  resumeAllBtn: document.getElementById('resume-all-btn')
};

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

function uint8ArrayToBase64(bytes) {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function calculateFileHash(file) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256');
  const chunkSize = 256 * 1024;
  let offset = 0;
  
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize);
    const arrayBuffer = await chunk.arrayBuffer();
    hash.update(Buffer.from(arrayBuffer));
    offset += chunkSize;
    
    if (Date.now() - lastMemoryLog > MEMORY_LOG_INTERVAL) {
      lastMemoryLog = Date.now();
      logMemoryUsage();
    }
  }
  
  return hash.digest('hex');
}

async function logMemoryUsage() {
  try {
    const usage = await ipcRenderer.invoke('get-memory-usage');
    console.log(`内存使用: RSS=${usage.rss}MB, Heap=${usage.heapUsed}MB/${usage.heapTotal}MB`);
  } catch (e) {}
}

function initSocket() {
  try {
    socket = io('http://localhost:3000');
  } catch (e) {
    socket = io.connect('http://localhost:3000');
  }

  socket.on('connect', () => {
    console.log('已连接到信令服务器');
    updateConnectionStatus(true);
  });

  socket.on('disconnect', () => {
    console.log('与信令服务器断开连接');
    updateConnectionStatus(false);
  });

  socket.on('room-joined', (data) => {
    console.log('加入房间:', data);
    currentRoomId = data.roomId;
    updatePeersList(data.peers);
    updateTargetPeersList(data.peers);
    
    data.peers.forEach(peerId => {
      if (!peerConnections[peerId]) {
        createPeerConnection(peerId, true);
      }
    });
  });

  socket.on('peer-left', (peerId) => {
    console.log('对等方离开:', peerId);
    if (peerConnections[peerId]) {
      peerConnections[peerId].close();
      delete peerConnections[peerId];
    }
    selectedPeers.delete(peerId);
    const peers = Object.keys(peerConnections).filter(id => 
      peerConnections[id].connectionState === 'connected'
    );
    updatePeersList(peers);
    updateTargetPeersList(peers);
  });

  socket.on('offer', async (data) => {
    console.log('收到Offer:', data.from);
    if (!peerConnections[data.from]) {
      createPeerConnection(data.from, false);
    }
    await peerConnections[data.from].setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnections[data.from].createAnswer();
    await peerConnections[data.from].setLocalDescription(answer);
    socket.emit('answer', { to: data.from, answer });
  });

  socket.on('answer', async (data) => {
    console.log('收到Answer:', data.from);
    await peerConnections[data.from].setRemoteDescription(new RTCSessionDescription(data.answer));
  });

  socket.on('ice-candidate', async (data) => {
    if (peerConnections[data.from]) {
      await peerConnections[data.from].addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  });

  socket.on('file-available', (data) => {
    console.log('收到可用文件:', data);
    addAvailableFile(data);
  });

  socket.on('chunk-request', async (data) => {
    console.log('收到分片请求:', data.chunkIndex, '来自:', data.from);
    handleChunkRequest(data);
  });

  socket.on('chunk-data', async (data) => {
    await handleReceiveChunkData(data);
  });

  socket.on('transfer-complete', (data) => {
    console.log('传输完成通知:', data.from);
    markTransferComplete(data.fileHash, data.from);
  });
}

function createPeerConnection(peerId, isInitiator) {
  const config = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  };

  const pc = new RTCPeerConnection(config);
  peerConnections[peerId] = pc;

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        to: peerId,
        candidate: event.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('连接状态:', pc.connectionState, peerId);
    if (pc.connectionState === 'connected') {
      const peers = Object.keys(peerConnections).filter(id => 
        peerConnections[id].connectionState === 'connected'
      );
      updatePeersList(peers);
      updateTargetPeersList(peers);
    }
  };

  if (isInitiator) {
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        socket.emit('offer', {
          to: peerId,
          offer: pc.localDescription
        });
      });
  }

  return pc;
}

async function handleChunkRequest(data) {
  const { fileHash, chunkIndex, from: peerId } = data;
  
  if (!selectedFile) return;
  
  const transferKey = `${fileHash}-${peerId}`;
  const transfer = activeTransfers.get(transferKey);
  
  if (!transfer || transfer.status === 'paused' || transfer.status === 'completed') {
    return;
  }

  try {
    const chunk = await ipcRenderer.invoke('get-file-chunk', selectedFile.path, chunkIndex);
    const base64Data = uint8ArrayToBase64(new Uint8Array(chunk));
    
    if (transfer.speedLimit > 0) {
      const chunkMB = chunk.length / (1024 * 1024);
      const delay = (chunkMB / transfer.speedLimit) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    socket.emit('chunk-data', {
      to: peerId,
      fileHash,
      chunkIndex,
      data: base64Data
    });
    
    transfer.sentChunks.add(chunkIndex);
    transfer.lastActivity = Date.now();
    updatePeerTransferUI(transferKey);
    
    if (Date.now() - lastMemoryLog > MEMORY_LOG_INTERVAL) {
      lastMemoryLog = Date.now();
      logMemoryUsage();
    }
  } catch (e) {
    console.error('发送分片失败:', e);
  }
}

async function handleReceiveChunkData(data) {
  const { fileHash, chunkIndex, data: chunkData, from: peerId } = data;
  const transferKey = `${fileHash}-${peerId}`;
  const transfer = activeTransfers.get(transferKey);
  
  if (!transfer || transfer.status === 'paused' || transfer.status === 'completed') return;

  try {
    const uint8Array = base64ToUint8Array(chunkData);
    
    await ipcRenderer.invoke('write-chunk-to-file', 
      transfer.savePath, 
      chunkIndex, 
      uint8Array, 
      transfer.totalChunks
    );

    transfer.receivedChunks.add(chunkIndex);
    transfer.lastActivity = Date.now();
    
    updatePeerTransferUI(transferKey);

    if (transfer.receivedChunks.size === transfer.totalChunks) {
      transfer.status = 'completed';
      transfer.endTime = Date.now();
      updatePeerTransferUI(transferKey);
      socket.emit('transfer-complete', {
        to: peerId,
        fileHash
      });
      console.log('文件传输完成:', transfer.fileName, '来自:', peerId);
    } else {
      requestMoreChunksForPeer(fileHash, peerId);
    }
  } catch (e) {
    console.error('处理分片失败:', e);
    requestMoreChunksForPeer(fileHash, peerId);
  }
}

function requestMoreChunksForPeer(fileHash, peerId) {
  const transferKey = `${fileHash}-${peerId}`;
  const transfer = activeTransfers.get(transferKey);
  
  if (!transfer || transfer.status !== 'transferring') return;

  while (transfer.requestedChunks.size < MAX_PARALLEL_REQUESTS) {
    let found = false;
    for (let i = 0; i < transfer.totalChunks; i++) {
      if (!transfer.receivedChunks.has(i) && !transfer.requestedChunks.has(i)) {
        transfer.requestedChunks.add(i);
        socket.emit('chunk-request', {
          to: peerId,
          fileHash,
          chunkIndex: i
        });
        found = true;
        break;
      }
    }
    if (!found) break;
  }
}

function updateConnectionStatus(connected) {
  if (connected) {
    elements.statusIndicator.className = 'status-connected';
    elements.statusText.textContent = '已连接';
  } else {
    elements.statusIndicator.className = 'status-disconnected';
    elements.statusText.textContent = '未连接';
  }
}

function updatePeersList(peers) {
  elements.peersContainer.innerHTML = '';
  
  if (peers.length === 0) {
    elements.peersContainer.innerHTML = '<p class="no-peers">暂无在线设备</p>';
  } else {
    peers.forEach(peerId => {
      const peerEl = document.createElement('div');
      peerEl.className = 'peer-item';
      peerEl.textContent = peerId.substring(0, 8) + '...';
      elements.peersContainer.appendChild(peerEl);
    });
  }
}

function updateTargetPeersList(peers) {
  elements.targetPeersContainer.innerHTML = '';
  
  if (peers.length === 0) {
    elements.targetPeersContainer.innerHTML = '<p class="no-peers">暂无在线设备</p>';
  } else {
    peers.forEach(peerId => {
      const peerEl = document.createElement('div');
      peerEl.className = 'target-peer-item';
      if (selectedPeers.has(peerId)) {
        peerEl.classList.add('selected');
      }
      peerEl.innerHTML = `
        <input type="checkbox" ${selectedPeers.has(peerId) ? 'checked' : ''}>
        <span class="target-peer-name">${peerId.substring(0, 8)}...</span>
      `;
      peerEl.addEventListener('click', (e) => {
        e.preventDefault();
        togglePeerSelection(peerId);
      });
      elements.targetPeersContainer.appendChild(peerEl);
    });
  }
  
  updateSelectedCount();
}

function togglePeerSelection(peerId) {
  if (selectedPeers.has(peerId)) {
    selectedPeers.delete(peerId);
  } else {
    selectedPeers.add(peerId);
  }
  
  updateTargetPeersList(Object.keys(peerConnections).filter(id => 
    peerConnections[id].connectionState === 'connected'
  ));
  updateSendButton();
}

function updateSelectedCount() {
  const countEl = document.querySelector('.selected-count');
  if (countEl) {
    countEl.textContent = `已选择 ${selectedPeers.size} 台设备`;
  }
}

function updateSendButton() {
  const hasFile = selectedFile !== null;
  const hasPeers = selectedPeers.size > 0;
  elements.sendBtn.disabled = !(hasFile && hasPeers);
}

function addAvailableFile(fileInfo) {
  const container = elements.availableFiles;
  
  const noFiles = container.querySelector('.no-files');
  if (noFiles) noFiles.remove();

  const fileEl = document.createElement('div');
  fileEl.className = 'available-file-item';
  fileEl.innerHTML = `
    <div class="available-file-name">${fileInfo.fileName}</div>
    <div class="available-file-size">${formatSize(fileInfo.fileSize)} · ${fileInfo.totalChunks} 个分片</div>
    <button class="btn-primary receive-btn" data-hash="${fileInfo.fileHash}" data-size="${fileInfo.fileSize}" data-chunks="${fileInfo.totalChunks}" data-name="${fileInfo.fileName}" data-from="${fileInfo.from || ''}">接收文件</button>
  `;
  
  fileEl.querySelector('.receive-btn').addEventListener('click', (e) => {
    const btn = e.target;
    startReceivingFile({
      fileHash: btn.dataset.hash,
      fileName: btn.dataset.name,
      fileSize: parseInt(btn.dataset.size),
      totalChunks: parseInt(btn.dataset.chunks),
      from: btn.dataset.from
    });
  });
  
  container.appendChild(fileEl);
}

async function startReceivingFile(fileInfo) {
  const { filePath } = await ipcRenderer.invoke('save-file-dialog', fileInfo.fileName);
  
  if (!filePath) return;

  console.log('开始接收文件，保存到:', filePath);

  await ipcRenderer.invoke('initialize-file', filePath, fileInfo.fileSize);
  
  const existingChunks = await ipcRenderer.invoke('get-existing-chunks', filePath, fileInfo.totalChunks);
  console.log('已存在的分片数量:', existingChunks.length);
  
  const senderPeer = Object.keys(peerConnections).find(id => 
    peerConnections[id].connectionState === 'connected'
  );
  
  if (!senderPeer) {
    alert('没有可连接的发送方');
    return;
  }
  
  const transferKey = `${fileInfo.fileHash}-${senderPeer}`;
  
  activeTransfers.set(transferKey, {
    id: generateId(),
    fileName: fileInfo.fileName,
    fileSize: fileInfo.fileSize,
    totalChunks: fileInfo.totalChunks,
    receivedChunks: new Set(existingChunks),
    requestedChunks: new Set(),
    sentChunks: new Set(),
    savePath: filePath,
    status: 'transferring',
    direction: 'receiving',
    peerId: senderPeer,
    fileHash: fileInfo.fileHash,
    startTime: Date.now(),
    lastActivity: Date.now(),
    speedLimit: 0
  });

  addTransferItem(transferKey);
  showMultiTransferModal();
  requestMoreChunksForPeer(fileInfo.fileHash, senderPeer);
}

function addTransferItem(transferKey) {
  const transfer = activeTransfers.get(transferKey);
  if (!transfer) return;
  
  const container = elements.transferList;
  
  const noTransfer = container.querySelector('.no-transfer');
  if (noTransfer) noTransfer.remove();

  const transferEl = document.createElement('div');
  transferEl.className = 'transfer-item';
  transferEl.id = `transfer-${transferKey}`;
  transferEl.innerHTML = `
    <div class="transfer-item-header">
      <span class="transfer-name">${transfer.fileName}</span>
      <span class="transfer-direction ${transfer.direction}">${transfer.direction === 'sending' ? '发送中' : '接收中'}</span>
    </div>
    <div class="transfer-progress-bar">
      <div class="transfer-progress-fill" style="width: 0%"></div>
    </div>
    <div class="transfer-stats">
      <span class="transfer-percentage">0%</span>
      <span class="transfer-speed">0 MB/s</span>
    </div>
  `;
  
  container.appendChild(transferEl);
}

function updatePeerTransferUI(transferKey) {
  const transfer = activeTransfers.get(transferKey);
  if (!transfer) return;

  const progress = transfer.receivedChunks.size / transfer.totalChunks * 100;
  const elapsed = (Date.now() - transfer.startTime) / 1000;
  const bytesTransferred = transfer.receivedChunks.size * CHUNK_SIZE;
  const speed = elapsed > 0 ? bytesTransferred / elapsed / 1024 / 1024 : 0;

  const transferEl = document.getElementById(`transfer-${transferKey}`);
  if (transferEl) {
    transferEl.querySelector('.transfer-progress-fill').style.width = `${progress}%`;
    transferEl.querySelector('.transfer-percentage').textContent = `${progress.toFixed(1)}%`;
    transferEl.querySelector('.transfer-speed').textContent = `${speed.toFixed(2)} MB/s`;
    
    if (transfer.status === 'completed') {
      transferEl.querySelector('.transfer-direction').textContent = '已完成';
      transferEl.querySelector('.transfer-direction').className = 'transfer-direction completed';
    }
  }

  const modalEl = document.getElementById(`modal-transfer-${transferKey}`);
  if (modalEl) {
    modalEl.querySelector('.peer-progress-fill').style.width = `${progress}%`;
    modalEl.querySelector('.peer-percentage').textContent = `${progress.toFixed(1)}%`;
    modalEl.querySelector('.peer-speed').textContent = `${speed.toFixed(2)} MB/s`;
    
    const statusEl = modalEl.querySelector('.peer-transfer-status');
    statusEl.textContent = getStatusText(transfer.status);
    statusEl.className = `peer-transfer-status ${transfer.status}`;
    
    const pauseBtn = modalEl.querySelector('.pause-peer-btn');
    const resumeBtn = modalEl.querySelector('.resume-peer-btn');
    
    if (transfer.status === 'paused') {
      pauseBtn.style.display = 'none';
      resumeBtn.style.display = 'block';
    } else if (transfer.status === 'transferring') {
      pauseBtn.style.display = 'block';
      resumeBtn.style.display = 'none';
    } else {
      pauseBtn.style.display = 'none';
      resumeBtn.style.display = 'none';
    }
  }
}

function getStatusText(status) {
  const statusMap = {
    'transferring': '传输中',
    'paused': '已暂停',
    'completed': '已完成',
    'error': '错误'
  };
  return statusMap[status] || status;
}

function showMultiTransferModal() {
  elements.multiTransferContainer.innerHTML = '';
  
  elements.modalFileInfo.textContent = `正在传输文件，共 ${activeTransfers.size} 个任务`;
  
  activeTransfers.forEach((transfer, key) => {
    const card = createPeerTransferCard(key, transfer);
    elements.multiTransferContainer.appendChild(card);
  });
  
  elements.transferModal.style.display = 'flex';
}

function createPeerTransferCard(transferKey, transfer) {
  const card = document.createElement('div');
  card.className = 'peer-transfer-card';
  card.id = `modal-transfer-${transferKey}`;
  
  const speedLimitText = transfer.speedLimit > 0 ? `${transfer.speedLimit} MB/s` : '无限制';
  
  card.innerHTML = `
    <div class="peer-transfer-header">
      <span class="peer-transfer-name">${transfer.peerId.substring(0, 8)}...</span>
      <span class="peer-transfer-status ${transfer.status}">${getStatusText(transfer.status)}</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill peer-progress-fill" style="width: 0%"></div>
    </div>
    <div class="progress-stats">
      <span class="peer-percentage">0%</span>
      <span class="peer-speed">0 MB/s</span>
    </div>
    <div class="speed-indicator">
      <span>速度限制:</span>
      <span class="speed-limit-badge">${speedLimitText}</span>
    </div>
    <div class="peer-transfer-controls">
      <button class="btn-secondary btn-small btn-pause pause-peer-btn" data-key="${transferKey}" style="${transfer.status !== 'transferring' ? 'display:none' : ''}">暂停</button>
      <button class="btn-secondary btn-small btn-resume resume-peer-btn" data-key="${transferKey}" style="${transfer.status !== 'paused' ? 'display:none' : ''}">继续</button>
      <select class="peer-speed-limit" data-key="${transferKey}">
        <option value="0" ${transfer.speedLimit === 0 ? 'selected' : ''}>无限制</option>
        <option value="1" ${transfer.speedLimit === 1 ? 'selected' : ''}>1 MB/s</option>
        <option value="5" ${transfer.speedLimit === 5 ? 'selected' : ''}>5 MB/s</option>
        <option value="10" ${transfer.speedLimit === 10 ? 'selected' : ''}>10 MB/s</option>
        <option value="25" ${transfer.speedLimit === 25 ? 'selected' : ''}>25 MB/s</option>
        <option value="50" ${transfer.speedLimit === 50 ? 'selected' : ''}>50 MB/s</option>
      </select>
    </div>
  `;
  
  card.querySelector('.pause-peer-btn').addEventListener('click', () => pausePeerTransfer(transferKey));
  card.querySelector('.resume-peer-btn').addEventListener('click', () => resumePeerTransfer(transferKey));
  card.querySelector('.peer-speed-limit').addEventListener('change', (e) => {
    transfer.speedLimit = parseInt(e.target.value);
    updatePeerTransferUI(transferKey);
  });
  
  return card;
}

function pausePeerTransfer(transferKey) {
  const transfer = activeTransfers.get(transferKey);
  if (transfer && transfer.status === 'transferring') {
    transfer.status = 'paused';
    updatePeerTransferUI(transferKey);
    console.log('暂停传输:', transferKey);
  }
}

function resumePeerTransfer(transferKey) {
  const transfer = activeTransfers.get(transferKey);
  if (transfer && transfer.status === 'paused') {
    transfer.status = 'transferring';
    updatePeerTransferUI(transferKey);
    
    if (transfer.direction === 'receiving') {
      requestMoreChunksForPeer(transfer.fileHash, transfer.peerId);
    }
    
    console.log('继续传输:', transferKey);
  }
}

function pauseAllTransfers() {
  activeTransfers.forEach((transfer, key) => {
    if (transfer.status === 'transferring') {
      pausePeerTransfer(key);
    }
  });
}

function resumeAllTransfers() {
  activeTransfers.forEach((transfer, key) => {
    if (transfer.status === 'paused') {
      resumePeerTransfer(key);
    }
  });
}

function markTransferComplete(fileHash, peerId) {
  const transferKey = `${fileHash}-${peerId}`;
  const transfer = activeTransfers.get(transferKey);
  if (transfer) {
    transfer.status = 'completed';
    transfer.endTime = Date.now();
    updatePeerTransferUI(transferKey);
  }
}

function initDragDrop() {
  const dropZone = elements.dropZone;

  dropZone.addEventListener('click', () => {
    elements.fileInput.click();
  });

  elements.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    
    if (e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  });
}

async function handleFileSelect(file) {
  if (file.size > MAX_FILE_SIZE) {
    alert('文件大小超过10GB限制');
    return;
  }

  selectedFile = file;
  
  elements.fileName.textContent = file.name;
  elements.fileSize.textContent = formatSize(file.size);
  elements.selectedFileDiv.style.display = 'flex';
  elements.targetSelectPanel.style.display = 'block';
  
  const connectedPeers = Object.keys(peerConnections).filter(id => 
    peerConnections[id].connectionState === 'connected'
  );
  
  updateTargetPeersList(connectedPeers);
  updateSendButton();
}

async function sendFile() {
  if (!selectedFile || selectedPeers.size === 0) return;

  console.log('开始发送文件:', selectedFile.name, '到', selectedPeers.size, '台设备');

  const fileHash = await calculateFileHash(selectedFile);
  const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);
  const speedLimit = parseInt(elements.speedLimit.value);

  const fileInfo = {
    hash: fileHash,
    name: selectedFile.name,
    size: selectedFile.size,
    totalChunks: totalChunks,
    roomId: currentRoomId
  };

  socket.emit('file-info', fileInfo);

  selectedPeers.forEach(peerId => {
    const transferKey = `${fileHash}-${peerId}`;
    activeTransfers.set(transferKey, {
      id: generateId(),
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      totalChunks: totalChunks,
      receivedChunks: new Set(),
      requestedChunks: new Set(),
      sentChunks: new Set(),
      status: 'transferring',
      direction: 'sending',
      peerId: peerId,
      fileHash: fileHash,
      startTime: Date.now(),
      lastActivity: Date.now(),
      speedLimit: speedLimit
    });
    
    addTransferItem(transferKey);
  });

  showMultiTransferModal();
}

function initEvents() {
  elements.joinBtn.addEventListener('click', () => {
    const roomId = elements.roomId.value.trim();
    if (roomId) {
      socket.emit('join-room', roomId);
    }
  });

  elements.sendBtn.addEventListener('click', sendFile);

  elements.cancelTransfer.addEventListener('click', () => {
    elements.transferModal.style.display = 'none';
  });

  elements.selectAllBtn.addEventListener('click', () => {
    Object.keys(peerConnections).forEach(peerId => {
      if (peerConnections[peerId].connectionState === 'connected') {
        selectedPeers.add(peerId);
      }
    });
    updateTargetPeersList(Object.keys(peerConnections).filter(id => 
      peerConnections[id].connectionState === 'connected'
    ));
    updateSendButton();
  });

  elements.deselectAllBtn.addEventListener('click', () => {
    selectedPeers.clear();
    updateTargetPeersList(Object.keys(peerConnections).filter(id => 
      peerConnections[id].connectionState === 'connected'
    ));
    updateSendButton();
  });

  elements.pauseAllBtn.addEventListener('click', pauseAllTransfers);
  elements.resumeAllBtn.addEventListener('click', resumeAllTransfers);
}

function init() {
  initSocket();
  initDragDrop();
  initEvents();

  logMemoryUsage();
}

init();
