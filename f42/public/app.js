const socket = io();

let currentRole = 'sender';
let currentRoomId = null;
let peerConnection = null;
let dataChannel = null;

const CHUNK_SIZE = 16384;
const MAX_BUFFERED_AMOUNT = CHUNK_SIZE * 1;
const BUFFER_LOW_THRESHOLD = CHUNK_SIZE * 0.5;

const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

let sendBufferQueue = [];
let isSending = false;
let sendIntervalId = null;

let currentFile = null;
let bytesTransferred = 0;
let lastBytesTransferred = 0;
let lastSpeedUpdate = Date.now();
let currentSpeed = 0;
let speedIntervalId = null;

let resumeData = null;
let isResuming = false;

document.querySelectorAll('.role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRole = btn.dataset.role;
        document.getElementById('senderPanel').classList.toggle('active', currentRole === 'sender');
        document.getElementById('receiverPanel').classList.toggle('active', currentRole === 'receiver');
    });
});

document.getElementById('resumeBtn').addEventListener('click', () => {
    hideResumeDialog();
    isResuming = true;
    if (currentRole === 'sender') {
        document.getElementById('fileUploadArea').classList.remove('hidden');
        document.getElementById('waitingStatus').textContent = `准备断点续传: ${resumeData.fileInfo.name}，请选择相同文件`;
    } else {
        showReceiverStatus(`准备断点续传: ${resumeData.fileInfo.name}`, 'waiting');
        if (resumeData.transferState) {
            bytesTransferred = resumeData.transferState.bytesTransferred;
        }
    }
});

document.getElementById('restartBtn').addEventListener('click', () => {
    hideResumeDialog();
    isResuming = false;
    bytesTransferred = 0;
    socket.emit('update-transfer-state', currentRoomId, { bytesTransferred: 0 });
    if (currentRole === 'sender') {
        document.getElementById('fileUploadArea').classList.remove('hidden');
    }
});

function showResumeDialog(data) {
    const dialog = document.getElementById('resumeDialog');
    const fileInfo = document.getElementById('resumeFileInfo');
    const progress = document.getElementById('resumeProgress');
    
    fileInfo.textContent = `文件: ${data.fileInfo.name} (${formatFileSize(data.fileInfo.size)})`;
    
    const percent = data.transferState ? 
        Math.round((data.transferState.bytesTransferred / data.fileInfo.size) * 100) : 0;
    progress.textContent = `已传输: ${formatFileSize(data.transferState?.bytesTransferred || 0)} / ${formatFileSize(data.fileInfo.size)} (${percent}%)`;
    
    dialog.classList.remove('hidden');
}

function hideResumeDialog() {
    document.getElementById('resumeDialog').classList.add('hidden');
}

document.getElementById('createRoomBtn').addEventListener('click', () => {
    socket.emit('create-room');
});

socket.on('room-created', (roomId) => {
    currentRoomId = roomId;
    document.getElementById('roomIdDisplay').textContent = roomId;
    document.getElementById('roomInfo').classList.remove('hidden');
    document.getElementById('waitingStatus').classList.remove('hidden');
    document.getElementById('createRoomBtn').disabled = true;
});

document.getElementById('copyBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(currentRoomId).then(() => {
        const btn = document.getElementById('copyBtn');
        btn.textContent = '已复制!';
        setTimeout(() => btn.textContent = '复制', 2000);
    });
});

document.getElementById('joinRoomBtn').addEventListener('click', () => {
    const roomId = document.getElementById('roomIdInput').value.trim().toUpperCase();
    if (roomId.length === 6) {
        socket.emit('join-room', roomId);
    } else {
        showReceiverStatus('请输入有效的6位房间号', 'error');
    }
});

socket.on('room-joined', (roomId, resumeInfo) => {
    currentRoomId = roomId;
    document.getElementById('joinRoomBtn').disabled = true;
    document.getElementById('roomIdInput').disabled = true;
    
    if (resumeInfo && resumeInfo.canResume) {
        resumeData = resumeInfo;
        showResumeDialog(resumeInfo);
    } else {
        showReceiverStatus('已加入房间，等待连接...', 'waiting');
    }
});

socket.on('error', (message) => {
    showReceiverStatus(message, 'error');
});

function showReceiverStatus(message, type) {
    const status = document.getElementById('receiverStatus');
    status.textContent = message;
    status.className = 'status ' + type;
    status.classList.remove('hidden');
}

socket.on('receiver-connected', async (resumeInfo) => {
    document.getElementById('waitingStatus').classList.add('hidden');
    
    if (resumeInfo && resumeInfo.canResume) {
        resumeData = resumeInfo;
        showResumeDialog(resumeInfo);
    } else {
        document.getElementById('fileUploadArea').classList.remove('hidden');
    }
    
    peerConnection = new RTCPeerConnection(iceServers);
    
    dataChannel = peerConnection.createDataChannel('fileTransfer');
    setupDataChannel(dataChannel);
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', currentRoomId, event.candidate, true);
        }
    };
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', currentRoomId, offer);
});

socket.on('offer', async (offer) => {
    peerConnection = new RTCPeerConnection(iceServers);
    
    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel(dataChannel);
    };
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', currentRoomId, event.candidate, false);
        }
    };
    
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', currentRoomId, answer);
    
    if (!isResuming) {
        showReceiverStatus('已连接！准备接收文件...', 'connected');
    } else {
        showReceiverStatus('已连接！准备继续传输...', 'connected');
    }
});

socket.on('answer', async (answer) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice-candidate', async (candidate) => {
    if (candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

socket.on('peer-disconnected', () => {
    stopSending();
    stopSpeedMonitor();
    
    if (currentRole === 'sender') {
        document.getElementById('waitingStatus').classList.remove('hidden');
        document.getElementById('fileUploadArea').classList.add('hidden');
        document.getElementById('senderProgress').classList.add('hidden');
        document.getElementById('senderSpeedInfo').textContent = '';
    } else {
        showReceiverStatus('对方已断开连接，等待重新连接...', 'waiting');
    }
    
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
});

function setupDataChannel(channel) {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;
    
    channel.onopen = () => {
        console.log('DataChannel 已打开');
        if (currentRole === 'sender' && currentFile) {
            startSending();
        }
    };
    
    channel.onclose = () => {
        console.log('DataChannel 已关闭');
        stopSending();
        stopSpeedMonitor();
    };
    
    channel.onerror = (error) => {
        console.error('DataChannel 错误:', error);
        stopSending();
        stopSpeedMonitor();
    };
    
    channel.onbufferedamountlow = () => {
        processSendQueue();
    };
    
    channel.onmessage = handleMessage;
}

function stopSending() {
    isSending = false;
    sendBufferQueue = [];
    if (sendIntervalId) {
        clearInterval(sendIntervalId);
        sendIntervalId = null;
    }
}

function stopSpeedMonitor() {
    if (speedIntervalId) {
        clearInterval(speedIntervalId);
        speedIntervalId = null;
    }
}

function startSpeedMonitor(isSender) {
    lastBytesTransferred = bytesTransferred;
    lastSpeedUpdate = Date.now();
    
    speedIntervalId = setInterval(() => {
        const now = Date.now();
        const timeDiff = (now - lastSpeedUpdate) / 1000;
        
        if (timeDiff >= 0.5) {
            const bytesDiff = bytesTransferred - lastBytesTransferred;
            currentSpeed = bytesDiff / timeDiff;
            
            const speedElement = isSender ? 
                document.getElementById('senderSpeedInfo') : 
                document.getElementById('receiverSpeedInfo');
            speedElement.textContent = `速度: ${formatFileSize(currentSpeed)}/s`;
            
            lastBytesTransferred = bytesTransferred;
            lastSpeedUpdate = now;
        }
    }, 500);
}

function processSendQueue() {
    if (!dataChannel || dataChannel.readyState !== 'open') {
        return;
    }
    
    let sentCount = 0;
    const maxPerCycle = 5;
    
    while (sendBufferQueue.length > 0 && 
           dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT &&
           sentCount < maxPerCycle) {
        const chunk = sendBufferQueue.shift();
        try {
            dataChannel.send(chunk);
            sentCount++;
            bytesTransferred += chunk.byteLength;
        } catch (e) {
            console.error('发送失败:', e);
            sendBufferQueue.unshift(chunk);
            break;
        }
    }
}

let receivedFile = {
    name: '',
    size: 0,
    chunks: [],
    received: 0
};

function handleMessage(event) {
    if (typeof event.data === 'string') {
        const message = JSON.parse(event.data);
        
        if (message.type === 'file-info') {
            handleFileInfo(message);
        } else if (message.type === 'resume-request') {
            handleResumeRequest(message);
        } else if (message.type === 'resume-ack') {
            handleResumeAck(message);
        } else if (message.type === 'transfer-complete') {
            saveFile();
        }
    } else {
        receivedFile.chunks.push(event.data);
        receivedFile.received += event.data.byteLength;
        bytesTransferred = receivedFile.received;
        
        const progress = Math.round((receivedFile.received / receivedFile.size) * 100);
        document.getElementById('receiverProgressFill').style.width = progress + '%';
        document.getElementById('receiverProgressFill').textContent = progress + '%';
        
        if (Math.random() < 0.05) {
            socket.emit('update-transfer-state', currentRoomId, { 
                bytesTransferred: receivedFile.received 
            });
        }
    }
}

function handleFileInfo(message) {
    receivedFile = {
        name: message.name,
        size: message.size,
        chunks: [],
        received: 0
    };
    bytesTransferred = 0;
    
    document.getElementById('receiverProgress').classList.remove('hidden');
    document.getElementById('receiverFileInfo').textContent = 
        `正在接收: ${receivedFile.name} (${formatFileSize(receivedFile.size)})`;
    
    startSpeedMonitor(false);
    
    socket.emit('save-file-info', currentRoomId, {
        name: message.name,
        size: message.size
    });
}

function handleResumeRequest(message) {
    const startByte = message.startByte;
    receivedFile.received = startByte;
    bytesTransferred = startByte;
    
    const progress = Math.round((startByte / receivedFile.size) * 100);
    document.getElementById('receiverProgressFill').style.width = progress + '%';
    document.getElementById('receiverProgressFill').textContent = progress + '%';
    
    dataChannel.send(JSON.stringify({
        type: 'resume-ack',
        startByte: startByte
    }));
    
    startSpeedMonitor(false);
}

function handleResumeAck(message) {
    const startByte = message.startByte;
    bytesTransferred = startByte;
    
    const progress = Math.round((startByte / currentFile.size) * 100);
    document.getElementById('senderProgressFill').style.width = progress + '%';
    document.getElementById('senderProgressFill').textContent = progress + '%';
    
    readAndSendChunks(startByte);
}

function saveFile() {
    stopSpeedMonitor();
    
    const blob = new Blob(receivedFile.chunks);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = receivedFile.name;
    a.click();
    URL.revokeObjectURL(url);
    
    showReceiverStatus('文件接收完成！', 'connected');
    document.getElementById('receiverSpeedInfo').textContent = '';
    
    socket.emit('update-transfer-state', currentRoomId, { bytesTransferred: 0 });
}

const fileUploadArea = document.getElementById('fileUploadArea');
const fileInput = document.getElementById('fileInput');

fileUploadArea.addEventListener('click', () => fileInput.click());

fileUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileUploadArea.classList.add('dragover');
});

fileUploadArea.addEventListener('dragleave', () => {
    fileUploadArea.classList.remove('dragover');
});

fileUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    fileUploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        prepareFile(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        prepareFile(e.target.files[0]);
    }
});

function prepareFile(file) {
    currentFile = file;
    document.getElementById('fileUploadArea').classList.add('hidden');
    document.getElementById('senderProgress').classList.remove('hidden');
    document.getElementById('senderFileInfo').textContent = 
        `正在发送: ${file.name} (${formatFileSize(file.size)})`;
    
    socket.emit('save-file-info', currentRoomId, {
        name: file.name,
        size: file.size
    });
    
    if (isResuming && resumeData && resumeData.transferState) {
        bytesTransferred = resumeData.transferState.bytesTransferred;
        startSending(true);
    } else {
        bytesTransferred = 0;
        startSending(false);
    }
}

function startSending(resume = false) {
    if (!dataChannel || dataChannel.readyState !== 'open') {
        return;
    }
    
    startSpeedMonitor(true);
    
    if (resume) {
        dataChannel.send(JSON.stringify({
            type: 'resume-request',
            startByte: bytesTransferred
        }));
    } else {
        dataChannel.send(JSON.stringify({
            type: 'file-info',
            name: currentFile.name,
            size: currentFile.size
        }));
        readAndSendChunks(0);
    }
}

function readAndSendChunks(startByte) {
    const totalChunks = Math.ceil(currentFile.size / CHUNK_SIZE);
    const startChunk = Math.floor(startByte / CHUNK_SIZE);
    let chunksProcessed = 0;
    const totalToProcess = totalChunks - startChunk;
    
    isSending = true;
    
    function updateProgress() {
        chunksProcessed++;
        const overallProgress = Math.round(
            ((startChunk + chunksProcessed) / totalChunks) * 100
        );
        document.getElementById('senderProgressFill').style.width = overallProgress + '%';
        document.getElementById('senderProgressFill').textContent = overallProgress + '%';
        
        if (chunksProcessed % 10 === 0) {
            socket.emit('update-transfer-state', currentRoomId, { 
                bytesTransferred: bytesTransferred 
            });
        }
    }
    
    function readNextBatch() {
        const batchSize = 100;
        const endChunk = Math.min(startChunk + chunksProcessed + batchSize, totalChunks);
        
        for (let i = startChunk + chunksProcessed; i < endChunk; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, currentFile.size);
            const blob = currentFile.slice(start, end);
            
            const reader = new FileReader();
            reader.onload = (e) => {
                sendBufferQueue.push(e.target.result);
            };
            reader.readAsArrayBuffer(blob);
        }
    }
    
    readNextBatch();
    
    sendIntervalId = setInterval(() => {
        if (!isSending || !dataChannel || dataChannel.readyState !== 'open') {
            clearInterval(sendIntervalId);
            return;
        }
        
        const beforeLength = sendBufferQueue.length;
        processSendQueue();
        const processedCount = beforeLength - sendBufferQueue.length;
        
        for (let i = 0; i < processedCount; i++) {
            updateProgress();
        }
        
        if (sendBufferQueue.length < 30) {
            readNextBatch();
        }
        
        if (chunksProcessed >= totalToProcess) {
            clearInterval(sendIntervalId);
            isSending = false;
            stopSpeedMonitor();
            document.getElementById('senderSpeedInfo').textContent = '';
            
            setTimeout(() => {
                if (dataChannel && dataChannel.readyState === 'open') {
                    dataChannel.send(JSON.stringify({ type: 'transfer-complete' }));
                    socket.emit('update-transfer-state', currentRoomId, { bytesTransferred: 0 });
                }
            }, 500);
        }
    }, 20);
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes.toFixed(1) + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}
