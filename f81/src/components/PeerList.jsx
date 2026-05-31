import React from 'react';

function PeerList({ peers, currentNodeId, encryptionEnabled, offlineThreshold = 30000 }) {
  const connectedPeers = peers.filter(p => p.connected);
  const disconnectedPeers = peers.filter(p => !p.connected);
  
  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return '未知';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}秒前`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
    return `${Math.floor(seconds / 3600)}小时前`;
  };
  
  const getStatusIcon = (peer) => {
    if (!peer.connected) return '⚫';
    if (encryptionEnabled && peer.hasPublicKey) return '🔒';
    if (encryptionEnabled && !peer.hasPublicKey) return '🔓';
    return '🟢';
  };
  
  const getStatusText = (peer) => {
    if (!peer.connected) return '离线';
    if (encryptionEnabled && peer.hasPublicKey) return '已加密';
    if (encryptionEnabled && !peer.hasPublicKey) return '加密握手中';
    return '已连接';
  };

  return (
    <div className="peer-list">
      <div className="peer-section">
        <h3>当前节点</h3>
        <div className="peer-item current">
          <div>
            <div className="peer-id">
              {encryptionEnabled ? '🔒' : '🔓'} {currentNodeId.substring(0, 8)}
            </div>
            <div className="peer-meta">
              加密状态: {encryptionEnabled ? 'E2EE 已启用' : '未加密'}
            </div>
          </div>
          <div className="peer-status">
            <span className="status-badge connected">在线</span>
          </div>
        </div>
      </div>

      <div className="peer-section">
        <h3>已连接节点 ({connectedPeers.length})</h3>
        {connectedPeers.length === 0 ? (
          <div className="empty-state">
            <p>暂无已连接节点</p>
            <p className="empty-hint">启动其他节点实例建立连接</p>
          </div>
        ) : (
          <div className="peer-items">
            {connectedPeers.map((peer) => {
              const timeSinceHeartbeat = Date.now() - (peer.lastSeen || 0);
              const isNearOffline = timeSinceHeartbeat > offlineThreshold * 0.7;
              
              return (
                <div key={peer.id} className={`peer-item ${isNearOffline ? 'warning' : ''}`}>
                  <div>
                    <div className="peer-id">
                      {getStatusIcon(peer)} {peer.id.substring(0, 8)}
                    </div>
                    <div className="peer-meta">
                      最后心跳: {formatTimeAgo(peer.lastSeen)}
                      {isNearOffline && (
                        <span className="warning-text"> (即将超时)</span>
                      )}
                    </div>
                    {encryptionEnabled && (
                      <div className="peer-meta">
                        加密: {peer.hasPublicKey ? 'E2EE 已激活' : '密钥交换中'}
                      </div>
                    )}
                  </div>
                  <div className="peer-status">
                    <span className={`status-badge ${peer.hasPublicKey ? 'encrypted' : 'connected'}`}>
                      {getStatusText(peer)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {disconnectedPeers.length > 0 && (
        <div className="peer-section">
          <h3>断开连接的节点 ({disconnectedPeers.length})</h3>
          <div className="peer-items">
            {disconnectedPeers.map((peer) => (
              <div key={peer.id} className="peer-item disconnected">
                <div>
                  <div className="peer-id">⚫ {peer.id.substring(0, 8)}</div>
                  <div className="peer-meta">
                    最后在线: {formatTimeAgo(peer.lastSeen)}
                  </div>
                </div>
                <div className="peer-status">
                  <span className="status-badge disconnected">断开</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <div className="peer-section info-section">
        <h4>说明</h4>
        <ul className="info-list">
          <li>🔒 端到端加密已激活</li>
          <li>🔓 未加密或密钥交换中</li>
          <li>⚫ 节点已离线</li>
          <li>离线阈值: {offlineThreshold / 1000}秒</li>
          <li>心跳间隔: 10秒</li>
        </ul>
      </div>
    </div>
  );
}

export default PeerList;
