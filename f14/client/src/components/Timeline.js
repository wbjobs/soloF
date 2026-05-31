import React, { useState, useEffect } from 'react';

const Timeline = ({ snapshots, currentTime, onSeek, onPlay, isPlaying }) => {
  const [localTime, setLocalTime] = useState(currentTime);

  useEffect(() => {
    setLocalTime(currentTime);
  }, [currentTime]);

  if (snapshots.length === 0) {
    return (
      <div style={{
        padding: '16px',
        background: '#f5f5f5',
        borderRadius: '8px',
        textAlign: 'center',
        marginTop: '16px'
      }}>
        <span style={{ color: '#888', fontSize: '14px' }}>暂无历史快照</span>
      </div>
    );
  }

  const minTime = snapshots[0].timestamp;
  const maxTime = snapshots[snapshots.length - 1].timestamp;
  const range = maxTime - minTime;

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const handleSliderChange = (e) => {
    const value = parseInt(e.target.value);
    setLocalTime(value);
  };

  const handleSliderMouseUp = () => {
    onSeek(localTime);
  };

  const snapPositions = snapshots.map(s => ({
    timestamp: s.timestamp,
    position: range > 0 ? ((s.timestamp - minTime) / range) * 100 : 0
  }));

  return (
    <div style={{
      padding: '16px',
      background: '#f5f5f5',
      borderRadius: '8px',
      marginTop: '16px'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        marginBottom: '12px'
      }}>
        <button
          onClick={onPlay}
          style={{
            padding: '8px 16px',
            background: '#4a90d9',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          {isPlaying ? '⏸ 暂停' : '▶ 播放'}
        </button>

        <span style={{ fontSize: '14px', color: '#666' }}>
          {formatTime(localTime || maxTime)}
        </span>

        <span style={{ fontSize: '14px', color: '#666', marginLeft: 'auto' }}>
          共 {snapshots.length} 个历史快照
        </span>
      </div>

      <div style={{ position: 'relative', padding: '20px 0' }}>
        <div style={{
          position: 'absolute',
          top: '20px',
          left: 0,
          right: 0,
          height: '4px',
          background: '#ddd',
          borderRadius: '2px'
        }}>
          {snapPositions.map((pos, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${pos.position}%`,
                top: '-4px',
                width: '8px',
                height: '12px',
                background: '#4a90d9',
                borderRadius: '2px',
                transform: 'translateX(-50%)',
                cursor: 'pointer'
              }}
              onClick={() => onSeek(pos.timestamp)}
              title={formatTime(pos.timestamp)}
            />
          ))}
        </div>

        <input
          type="range"
          min={minTime}
          max={maxTime}
          value={localTime || maxTime}
          onChange={handleSliderChange}
          onMouseUp={handleSliderMouseUp}
          onTouchEnd={handleSliderMouseUp}
          style={{
            width: '100%',
            position: 'relative',
            zIndex: 10,
            margin: 0
          }}
        />
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '12px',
        color: '#888'
      }}>
        <span>{formatTime(minTime)}</span>
        <span>{formatTime(maxTime)}</span>
      </div>
    </div>
  );
};

export default Timeline;
