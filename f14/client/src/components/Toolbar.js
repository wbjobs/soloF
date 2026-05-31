import React from 'react';

const Toolbar = ({ 
  tool, 
  setTool, 
  color, 
  setColor, 
  strokeWidth, 
  setStrokeWidth,
  onAIComplete,
  hasAISelection,
  isGenerating
}) => {
  const tools = [
    { id: 'pen', name: '画笔', icon: '✏️' },
    { id: 'rectangle', name: '矩形', icon: '⬜' },
    { id: 'circle', name: '圆形', icon: '⭕' },
    { id: 'text', name: '文本', icon: 'T' },
    { id: 'select', name: '选择', icon: '🖱️' },
    { id: 'ai_select', name: 'AI补全', icon: '🤖' }
  ];

  const colors = [
    '#000000', '#ff0000', '#00ff00', '#0000ff',
    '#ffff00', '#ff00ff', '#00ffff', '#808080'
  ];

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      padding: '12px 16px',
      background: '#f5f5f5',
      borderRadius: '8px',
      marginBottom: '16px',
      flexWrap: 'wrap'
    }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        {tools.map(t => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            style={{
              padding: '8px 16px',
              border: tool === t.id ? '2px solid #4a90d9' : '1px solid #ddd',
              borderRadius: '6px',
              background: tool === t.id ? '#e8f4ff' : 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '14px'
            }}
          >
            <span>{t.icon}</span>
            <span>{t.name}</span>
          </button>
        ))}
      </div>

      <div style={{ height: '24px', width: '1px', background: '#ddd' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '14px' }}>颜色:</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {colors.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: c,
                border: color === c ? '2px solid #4a90d9' : '2px solid transparent',
                cursor: 'pointer',
                boxSizing: 'border-box'
              }}
            />
          ))}
        </div>
      </div>

      <div style={{ height: '24px', width: '1px', background: '#ddd' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '14px' }}>粗细:</span>
        <input
          type="range"
          min="1"
          max="20"
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
          style={{ width: '100px' }}
        />
        <span style={{ fontSize: '14px', width: '24px' }}>{strokeWidth}</span>
      </div>

      <div style={{ height: '24px', width: '1px', background: '#ddd' }} />

      <button
        onClick={onAIComplete}
        disabled={!hasAISelection || isGenerating}
        style={{
          padding: '10px 20px',
          background: hasAISelection && !isGenerating ? '#10b981' : '#ccc',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: hasAISelection && !isGenerating ? 'pointer' : 'not-allowed',
          fontSize: '14px',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
      >
        {isGenerating ? (
          <>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>
              ⏳
            </span>
            生成中...
          </>
        ) : (
          <>
            <span>✨</span>
            AI补全
          </>
        )}
      </button>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default Toolbar;
