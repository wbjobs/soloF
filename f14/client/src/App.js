import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Whiteboard, TOOLS } from './components/Whiteboard';
import Toolbar from './components/Toolbar';
import Timeline from './components/Timeline';
import { CRDTDocument } from './utils/crdt';
import { WebRTCManager } from './utils/webrtc';

const App = () => {
  const [roomId] = useState('default-room');
  const [userId, setUserId] = useState(null);
  const [connected, setConnected] = useState(false);
  const [connectedPeers, setConnectedPeers] = useState([]);
  
  const [tool, setTool] = useState(TOOLS.PEN);
  const [color, setColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(2);
  
  const [shapes, setShapes] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  
  const [isViewMode, setIsViewMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(null);
  
  const [aiSelection, setAISelection] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [aiPrompt, setAIPrompt] = useState('beautiful illustration, masterpiece, high quality, colorful');
  
  const crdtRef = useRef(new CRDTDocument());
  const wsRef = useRef(null);
  const webrtcRef = useRef(null);
  const playIntervalRef = useRef(null);
  const whiteboardRef = useRef(null);

  const connectToServer = useCallback(() => {
    const ws = new WebSocket('ws://localhost:3001');
    
    ws.onopen = () => {
      console.log('Connected to signaling server');
      ws.send(JSON.stringify({
        type: 'join',
        roomId
      }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'init':
          setUserId(message.userId);
          setConnected(true);
          crdtRef.current.loadState(message.state);
          setShapes(crdtRef.current.getCurrentShapes());
          
          webrtcRef.current = new WebRTCManager(ws, message.userId, roomId);
          
          webrtcRef.current.onMessage = (msg) => {
            if (msg.type === 'operation') {
              crdtRef.current.mergeOperations([msg.operation]);
              setShapes(crdtRef.current.getCurrentShapes());
            } else if (msg.type === 'sync-state') {
              crdtRef.current.mergeOperations(msg.operations);
              setShapes(crdtRef.current.getCurrentShapes());
            }
          };
          
          webrtcRef.current.onPeerConnected = (peerId) => {
            setConnectedPeers(prev => [...new Set([...prev, peerId])]);
          };
          
          webrtcRef.current.onPeerDisconnected = (peerId) => {
            setConnectedPeers(prev => prev.filter(id => id !== peerId));
          };
          
          if (message.peers && message.peers.length > 0) {
            webrtcRef.current.connectToPeers(message.peers);
          }
          break;
          
        case 'peer-joined':
          if (webrtcRef.current && message.peerId !== userId) {
            webrtcRef.current.connectToPeers([message.peerId]);
          }
          break;
          
        case 'peer-left':
          setConnectedPeers(prev => prev.filter(id => id !== message.peerId));
          break;
          
        case 'webrtc-signal':
          if (webrtcRef.current && message.from !== userId) {
            webrtcRef.current.handleSignal(message.from, message.signal);
          }
          break;
          
        case 'operation':
          crdtRef.current.mergeOperations([message.operation]);
          setShapes(crdtRef.current.getCurrentShapes());
          break;
          
        case 'history':
          setSnapshots(message.snapshots);
          break;
      }
    };

    ws.onclose = () => {
      console.log('Disconnected from server');
      setConnected(false);
      if (webrtcRef.current) {
        webrtcRef.current.disconnect();
      }
    };

    wsRef.current = ws;
  }, [roomId, userId]);

  const loadHistory = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'get-history',
        roomId
      }));
    }
  }, [roomId]);

  const handleDraw = useCallback((type, data) => {
    if (isViewMode) return;
    
    const operation = crdtRef.current.addOperation(type, data);
    setShapes(crdtRef.current.getCurrentShapes());
    
    if (webrtcRef.current) {
      webrtcRef.current.broadcast({
        type: 'operation',
        operation
      });
    }
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'operation',
        roomId,
        operation
      }));
    }
  }, [roomId, isViewMode]);

  const handleMove = useCallback((shape, deltaX, deltaY) => {
    if (isViewMode) return;

    const { type, data } = shape;
    const newData = { ...data };

    switch (type) {
      case 'rectangle':
      case 'circle':
        newData.x1 += deltaX;
        newData.y1 += deltaY;
        newData.x2 += deltaX;
        newData.y2 += deltaY;
        break;
      case 'pen':
        if (newData.points) {
          newData.points = newData.points.map(p => ({
            x: p.x + deltaX,
            y: p.y + deltaY
          }));
        }
        break;
      case 'text':
        newData.x += deltaX;
        newData.y += deltaY;
        break;
      case 'image':
        newData.x += deltaX;
        newData.y += deltaY;
        break;
      default:
        return;
    }

    const operation = crdtRef.current.addOperation(type, newData);
    setShapes(crdtRef.current.getCurrentShapes());
    
    if (webrtcRef.current) {
      webrtcRef.current.broadcast({
        type: 'operation',
        operation
      });
    }
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'operation',
        roomId,
        operation
      }));
    }
  }, [roomId, isViewMode]);

  const handleAISelection = useCallback((rect) => {
    setAISelection(rect);
    setShowPromptModal(true);
  }, []);

  const dataURLtoBlob = (dataURL) => {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  const handleAIComplete = useCallback(async () => {
    if (!aiSelection || !whiteboardRef.current) return;
    
    setIsGenerating(true);
    
    try {
      const rect = aiSelection;
      const x = Math.min(rect.x1, rect.x2);
      const y = Math.min(rect.y1, rect.y2);
      const width = Math.abs(rect.x2 - rect.x1);
      const height = Math.abs(rect.y2 - rect.y1);
      
      const imageData = whiteboardRef.current.captureRegion(x, y, width, height);
      
      const formData = new FormData();
      formData.append('image', dataURLtoBlob(imageData), 'sketch.png');
      formData.append('prompt', aiPrompt);
      
      const response = await fetch('http://localhost:8000/api/ai/generate', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (result.success && result.image) {
        handleDraw('image', {
          src: result.image,
          x,
          y,
          width,
          height
        });
      } else {
        throw new Error(result.error || 'AI generation failed');
      }
    } catch (error) {
      console.error('AI generation error:', error);
      alert('AI生成失败: ' + error.message);
    } finally {
      setIsGenerating(false);
      setShowPromptModal(false);
      setAISelection(null);
    }
  }, [aiSelection, aiPrompt, handleDraw]);

  const handleSeek = useCallback((timestamp) => {
    setCurrentTime(timestamp);
    const historicalShapes = crdtRef.current.getShapesUntil(timestamp);
    setShapes(historicalShapes);
    setIsViewMode(true);
    setIsPlaying(false);
  }, []);

  const handlePlay = useCallback(() => {
    if (isPlaying) {
      clearInterval(playIntervalRef.current);
      setIsPlaying(false);
      return;
    }
    
    if (snapshots.length === 0) return;
    
    setIsViewMode(true);
    setIsPlaying(true);
    
    let index = 0;
    const minTime = snapshots[0].timestamp;
    const maxTime = snapshots[snapshots.length - 1].timestamp;
    
    if (!currentTime || currentTime >= maxTime) {
      setCurrentTime(minTime);
      const historicalShapes = crdtRef.current.getShapesUntil(minTime);
      setShapes(historicalShapes);
    }
    
    index = snapshots.findIndex(s => s.timestamp >= currentTime);
    if (index < 0) index = 0;
    
    playIntervalRef.current = setInterval(() => {
      index++;
      if (index >= snapshots.length) {
        clearInterval(playIntervalRef.current);
        setIsPlaying(false);
        return;
      }
      const ts = snapshots[index].timestamp;
      setCurrentTime(ts);
      const historicalShapes = crdtRef.current.getShapesUntil(ts);
      setShapes(historicalShapes);
    }, 500);
  }, [snapshots, currentTime, isPlaying]);

  const exitViewMode = useCallback(() => {
    setIsViewMode(false);
    setIsPlaying(false);
    setCurrentTime(null);
    clearInterval(playIntervalRef.current);
    setShapes(crdtRef.current.getCurrentShapes());
  }, []);

  useEffect(() => {
    return () => {
      clearInterval(playIntervalRef.current);
      if (webrtcRef.current) {
        webrtcRef.current.disconnect();
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#fafafa',
      padding: '24px'
    }}>
      <div style={{
        maxWidth: '1240px',
        margin: '0 auto'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px'
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', color: '#333' }}>
              🎨 多人实时协同白板
            </h1>
            <p style={{ margin: '8px 0 0 0', color: '#666', fontSize: '14px' }}>
              房间: {roomId} | 在线人数: {connectedPeers.length + (connected ? 1 : 0)}
            </p>
          </div>
          
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {!connected ? (
              <button
                onClick={connectToServer}
                style={{
                  padding: '10px 24px',
                  background: '#4a90d9',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                连接服务器
              </button>
            ) : (
              <span style={{ color: '#4caf50', fontSize: '14px' }}>
                ✅ 已连接
              </span>
            )}
            
            <button
              onClick={loadHistory}
              style={{
                padding: '10px 24px',
                background: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              加载历史
            </button>
            
            {isViewMode && (
              <button
                onClick={exitViewMode}
                style={{
                  padding: '10px 24px',
                  background: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                退出预览模式
              </button>
            )}
          </div>
        </div>

        {isViewMode && (
          <div style={{
            padding: '12px 16px',
            background: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: '6px',
            marginBottom: '16px',
            color: '#856404',
            fontSize: '14px'
          }}>
            ⚠️ 历史预览模式 - 无法编辑
          </div>
        )}

        <Toolbar
          tool={tool}
          setTool={setTool}
          color={color}
          setColor={setColor}
          strokeWidth={strokeWidth}
          setStrokeWidth={setStrokeWidth}
          onAIComplete={() => setShowPromptModal(true)}
          hasAISelection={!!aiSelection}
          isGenerating={isGenerating}
        />

        <Whiteboard
          ref={whiteboardRef}
          shapes={shapes}
          onDraw={handleDraw}
          onMove={handleMove}
          onAISelection={handleAISelection}
          tool={tool}
          color={color}
          strokeWidth={strokeWidth}
          isViewMode={isViewMode}
          aiSelection={aiSelection}
        />

        <Timeline
          snapshots={snapshots}
          currentTime={currentTime}
          onSeek={handleSeek}
          onPlay={handlePlay}
          isPlaying={isPlaying}
        />

        <div style={{
          marginTop: '24px',
          padding: '16px',
          background: '#e8f4ff',
          borderRadius: '8px',
          fontSize: '14px',
          color: '#495057'
        }}>
          <h4 style={{ margin: '0 0 12px 0' }}>📝 使用说明</h4>
          <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.8' }}>
            <li>点击"连接服务器"加入白板房间</li>
            <li>使用 🖱️ 选择工具点击图形，然后拖动移动它</li>
            <li>使用 🤖 AI补全工具框选区域，将手绘草图转换为精美插画</li>
            <li>多人同时移动同一图形时，最后操作生效（避免瞬移）</li>
            <li>使用 ✏️ 画笔、⬜ 矩形、⭕ 圆形、T 文本工具创建图形</li>
            <li>点击"加载历史"查看历史快照，拖动时间轴回放</li>
            <li>CRDT算法保证数据一致性，WebRTC实现低延迟同步</li>
          </ul>
        </div>
      </div>

      {showPromptModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '24px',
            width: '500px',
            maxWidth: '90%',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)'
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '20px' }}>
              🤖 AI 补全设置
            </h3>
            <p style={{ margin: '0 0 16px 0', color: '#666', fontSize: '14px' }}>
              输入描述词，AI将根据选中区域的草图生成精美插画。
            </p>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAIPrompt(e.target.value)}
              placeholder="例如: beautiful landscape painting, anime style, vibrant colors..."
              style={{
                width: '100%',
                padding: '12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '14px',
                minHeight: '100px',
                resize: 'vertical',
                marginBottom: '16px',
                boxSizing: 'border-box'
              }}
            />
            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={() => {
                  setShowPromptModal(false);
                  setAISelection(null);
                }}
                style={{
                  padding: '10px 20px',
                  background: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                取消
              </button>
              <button
                onClick={handleAIComplete}
                disabled={isGenerating}
                style={{
                  padding: '10px 20px',
                  background: isGenerating ? '#ccc' : '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: 'bold'
                }}
              >
                {isGenerating ? '生成中...' : '✨ 开始生成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
