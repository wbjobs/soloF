import React from 'react';

function VectorClockDisplay({ vectorClock, nodeId }) {
  const entries = Object.entries(vectorClock);
  const myClock = vectorClock[nodeId] || 0;

  return (
    <div className="vector-clock-display">
      <div className="clock-info">
        <h3>向量时钟状态</h3>
        <div className="clock-summary">
          <div className="clock-item">
            <span className="clock-label">本节点版本:</span>
            <span className="clock-value">{myClock}</span>
          </div>
          <div className="clock-item">
            <span className="clock-label">总节点数:</span>
            <span className="clock-value">{entries.length}</span>
          </div>
        </div>
      </div>

      <div className="clock-detail">
        <h4>各节点版本</h4>
        {entries.length === 0 ? (
          <div className="empty-state">
            <p>暂无时钟数据</p>
          </div>
        ) : (
          <div className="clock-table">
            <div className="clock-table-header">
              <span>节点ID</span>
              <span>版本号</span>
            </div>
            {entries.map(([id, value]) => (
              <div
                key={id}
                className={`clock-table-row ${id === nodeId ? 'current' : ''}`}
              >
                <span className="clock-node-id">
                  {id.substring(0, 8)}
                  {id === nodeId && ' (本节点)'}
                </span>
                <span className="clock-node-value">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default VectorClockDisplay;
