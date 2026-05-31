import React, { useState, useEffect, useCallback, useRef } from 'react';
import NodeManager from './utils/NodeManager';
import ConfigEditor from './components/ConfigEditor';
import PeerList from './components/PeerList';
import VectorClockDisplay from './components/VectorClockDisplay';
import HistoryViewer from './components/HistoryViewer';
import './App.css';

const SIGNALING_SERVER_URL = 'ws://localhost:8080';

function App() {
  const [nodeManager, setNodeManager] = useState(null);
  const [config, setConfig] = useState({});
  const [peers, setPeers] = useState([]);
  const [vectorClock, setVectorClock] = useState({});
  const [history, setHistory] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [nodeId, setNodeId] = useState('');
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('config');
  const [encryptionEnabled, setEncryptionEnabled] = useState(false);
  const [offlineThreshold, setOfflineThreshold] = useState(30000);
  
  const peerUpdateTimer = useRef(null);

  const addLog = useCallback((message) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-49), `[${timestamp}] ${message}`]);
  }, []);

  const refreshPeers = useCallback(() => {
    if (nodeManager) {
      setPeers(nodeManager.getAllPeers());
    }
  }, [nodeManager]);

  useEffect(() => {
    const initNode = async () => {
      try {
        const manager = new NodeManager(SIGNALING_SERVER_URL);
        await manager.init();
        
        setNodeManager(manager);
        setNodeId(manager.nodeId);
        setConfig(manager.getAllConfig());
        setVectorClock(manager.getVectorClock().toJSON());
        setIsConnected(true);
        setEncryptionEnabled(manager.isEncryptionEnabled());
        setOfflineThreshold(manager.getOfflineThreshold());
        
        addLog(`节点初始化成功: ${manager.nodeId.substring(0, 8)}`);
        addLog(`加密状态: ${manager.isEncryptionEnabled() ? 'E2EE 已启用' : '未加密'}`);
        addLog(`离线阈值: ${manager.getOfflineThreshold() / 1000}秒`);

        manager.on('initialized', (data) => {
          setEncryptionEnabled(data.encryptionEnabled);
          addLog(`初始化完成，加密状态: ${data.encryptionEnabled ? '已启用' : '未启用'}`);
        });

        manager.on('config-changed', (data) => {
          setConfig(manager.getAllConfig());
          setVectorClock(manager.getVectorClock().toJSON());
          addLog(`配置变更: ${data.key} = ${JSON.stringify(data.value)}`);
        });

        manager.on('config-synced', (data) => {
          setConfig(manager.getAllConfig());
          setVectorClock(manager.getVectorClock().toJSON());
          const encrypted = data.encrypted ? ' [E2EE]' : '';
          addLog(`配置同步完成${encrypted} (来自: ${data.fromId?.substring(0, 8) || '未知'})`);
        });

        manager.on('remote-operation', (data) => {
          const encrypted = data.encrypted ? ' [E2EE]' : '';
          addLog(`收到远程操作${encrypted}: ${data.operation.type} ${data.operation.key}`);
        });

        manager.on('conflict-resolved', (data) => {
          addLog(`冲突解决: ${data.conflicts.length} 个冲突`);
        });

        manager.on('node-joined', (data) => {
          addLog(`新节点加入: ${data.nodeId.substring(0, 8)}`);
          setPeers(manager.getAllPeers());
        });

        manager.on('node-left', (data) => {
          addLog(`节点离开: ${data.nodeId.substring(0, 8)}`);
          setPeers(manager.getAllPeers());
        });

        manager.on('node-offline', (data) => {
          addLog(`节点离线: ${data.nodeId.substring(0, 8)} (超时 ${Math.round(data.offlineDuration / 1000)}秒)`);
        });

        manager.on('offline-nodes-detected', (data) => {
          if (data.offlineNodes.length > 0) {
            addLog(`检测到 ${data.offlineNodes.length} 个离线节点`);
          }
        });

        manager.on('key-exchange-completed', (data) => {
          addLog(`密钥交换完成: ${data.peerId.substring(0, 8)}`);
          setPeers(manager.getAllPeers());
        });

        manager.on('decryption-failed', (data) => {
          addLog(`⚠️ 解密失败 (来自: ${data.peerId.substring(0, 8)}): ${data.error}`);
        });

        manager.on('connection-state', (data) => {
          setPeers(manager.getAllPeers());
        });

        manager.on('peer-presence', (data) => {
          setPeers(manager.getAllPeers());
        });

        manager.on('signaling-connected', () => {
          addLog('信令服务器已连接');
        });

        manager.on('error', (data) => {
          addLog(`错误: ${data.message || '未知错误'}`);
        });

        setPeers(manager.getAllPeers());

        const historyData = await manager.getHistory(50);
        setHistory(historyData);
        
        peerUpdateTimer.current = setInterval(() => {
          refreshPeers();
        }, 2000);

      } catch (error) {
        console.error('初始化失败:', error);
        addLog(`初始化失败: ${error.message}`);
      }
    };

    initNode();

    return () => {
      if (peerUpdateTimer.current) {
        clearInterval(peerUpdateTimer.current);
      }
      if (nodeManager) {
        nodeManager.destroy();
      }
    };
  }, []);

  const handleSetConfig = async (key, value) => {
    if (!nodeManager) return;
    
    try {
      let parsedValue = value;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        parsedValue = value;
      }
      
      await nodeManager.setConfig(key, parsedValue);
    } catch (error) {
      addLog(`设置配置失败: ${error.message}`);
    }
  };

  const handleDeleteConfig = async (key) => {
    if (!nodeManager) return;
    
    try {
      await nodeManager.deleteConfig(key);
    } catch (error) {
      addLog(`删除配置失败: ${error.message}`);
    }
  };

  const handleRefreshHistory = async () => {
    if (!nodeManager) return;
    
    try {
      const historyData = await nodeManager.getHistory(50);
      setHistory(historyData);
      addLog('历史记录已刷新');
    } catch (error) {
      addLog(`获取历史失败: ${error.message}`);
    }
  };

  const handleForceSync = () => {
    if (!nodeManager) return;
    nodeManager._syncWithPeers();
    addLog('强制同步已触发');
  };

  if (!isConnected) {
    return (
      <div className="app-loading">
        <div className="loading-spinner"></div>
        <p>正在初始化节点...</p>
        <p className="loading-sub">请确保信令服务器已启动 (ws://localhost:8080)</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>去中心化配置同步服务</h1>
          <div className="node-info">
            <span className="node-id">
              {encryptionEnabled ? '🔒' : '🔓'} 节点: {nodeId.substring(0, 8)}
            </span>
            <span className={`status-badge ${encryptionEnabled ? 'encrypted' : 'connected'}`}>
              {encryptionEnabled ? 'E2EE' : '未加密'}
            </span>
            <span className="status-badge connected">已连接</span>
            <span className="peer-count">
              在线节点: {peers.filter(p => p.connected).length + 1}/10
            </span>
          </div>
        </div>
        <div className="header-actions">
          <button onClick={handleForceSync} className="btn btn-primary">
            强制同步
          </button>
        </div>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${activeTab === 'config' ? 'active' : ''}`}
          onClick={() => setActiveTab('config')}
        >
          配置编辑
        </button>
        <button
          className={`tab ${activeTab === 'peers' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('peers');
            refreshPeers();
          }}
        >
          节点列表 ({peers.filter(p => p.connected).length})
        </button>
        <button
          className={`tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('history');
            handleRefreshHistory();
          }}
        >
          历史记录
        </button>
        <button
          className={`tab ${activeTab === 'vector' ? 'active' : ''}`}
          onClick={() => setActiveTab('vector')}
        >
          向量时钟
        </button>
        <button
          className={`tab ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          日志 ({logs.length})
        </button>
      </nav>

      <main className="app-main">
        {activeTab === 'config' && (
          <ConfigEditor
            config={config}
            onSetConfig={handleSetConfig}
            onDeleteConfig={handleDeleteConfig}
          />
        )}

        {activeTab === 'peers' && (
          <PeerList 
            peers={peers} 
            currentNodeId={nodeId}
            encryptionEnabled={encryptionEnabled}
            offlineThreshold={offlineThreshold}
          />
        )}

        {activeTab === 'history' && (
          <HistoryViewer
            history={history}
            onRefresh={handleRefreshHistory}
          />
        )}

        {activeTab === 'vector' && (
          <VectorClockDisplay
            vectorClock={vectorClock}
            nodeId={nodeId}
          />
        )}

        {activeTab === 'logs' && (
          <div className="logs-container">
            <div className="logs-header">
              <h3>系统日志</h3>
              <button onClick={() => setLogs([])} className="btn btn-secondary">
                清除日志
              </button>
            </div>
            <div className="logs-content">
              {logs.length === 0 ? (
                <p className="empty-state">暂无日志</p>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="log-item">
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <span>WebRTC P2P 配置同步 | E2EE加密 | 向量时钟 | OT算法 | 30秒离线检测</span>
      </footer>
    </div>
  );
}

export default App;
