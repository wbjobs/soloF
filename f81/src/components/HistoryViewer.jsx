import React, { useState } from 'react';

function HistoryViewer({ history, onRefresh }) {
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);

  const handleSelectSnapshot = (snapshot) => {
    setSelectedSnapshot(snapshot);
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="history-viewer">
      <div className="history-header">
        <h3>配置历史记录</h3>
        <button onClick={onRefresh} className="btn btn-secondary">
          刷新
        </button>
      </div>

      <div className="history-content">
        {history.length === 0 ? (
          <div className="empty-state">
            <p>暂无历史记录</p>
            <p className="empty-hint">对配置进行修改后将在此显示历史记录</p>
          </div>
        ) : (
          <div className="history-list">
            {history.map((snapshot, index) => (
              <div
                key={snapshot.id || index}
                className={`history-item ${selectedSnapshot?.id === snapshot.id ? 'selected' : ''}`}
                onClick={() => handleSelectSnapshot(snapshot)}
              >
                <div className="history-item-header">
                  <span className="history-date">
                    {formatDate(snapshot.timestamp)}
                  </span>
                  <span className="history-node">
                    节点: {snapshot.nodeId?.substring(0, 8) || '未知'}
                  </span>
                </div>
                {snapshot.operations && (
                  <div className="history-operations">
                    {snapshot.operations.length} 个操作
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {selectedSnapshot && (
          <div className="history-detail">
            <h4>快照详情</h4>
            <div className="detail-row">
              <span className="detail-label">时间:</span>
              <span>{formatDate(selectedSnapshot.timestamp)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">节点:</span>
              <span>{selectedSnapshot.nodeId?.substring(0, 8)}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">配置内容:</span>
            </div>
            <pre className="detail-config">
              {JSON.stringify(selectedSnapshot.config, null, 2)}
            </pre>
            {selectedSnapshot.vectorClock && (
              <>
                <div className="detail-row">
                  <span className="detail-label">向量时钟:</span>
                </div>
                <pre className="detail-config">
                  {JSON.stringify(selectedSnapshot.vectorClock, null, 2)}
                </pre>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default HistoryViewer;
