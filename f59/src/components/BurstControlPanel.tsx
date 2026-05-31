import { BurstSimulationState, PipelineSegment, Valve } from '../types';

interface BurstControlPanelProps {
  burstState: BurstSimulationState;
  selectedPipeline: PipelineSegment | null;
  valves: Valve[];
  onStartSimulation: () => void;
  onStopSimulation: () => void;
}

const BurstControlPanel = ({
  burstState,
  selectedPipeline,
  valves,
  onStartSimulation,
  onStopSimulation,
}: BurstControlPanelProps) => {
  const getPipelineTypeLabel = (type: string) => {
    switch (type) {
      case 'water':
        return '给水管网';
      case 'sewage':
        return '排水管网';
      case 'gas':
        return '燃气管网';
      default:
        return type;
    }
  };

  const getValveTypeLabel = (type: string) => {
    switch (type) {
      case 'gate':
        return '闸阀';
      case 'butterfly':
        return '蝶阀';
      case 'check':
        return '止回阀';
      default:
        return type;
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(12px)',
        borderRadius: '12px',
        padding: '20px',
        minWidth: '300px',
        maxWidth: '340px',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        zIndex: 1000,
      }}
    >
      <h3
        style={{
          margin: '0 0 16px 0',
          color: '#f8fafc',
          fontSize: '16px',
          fontWeight: 600,
          letterSpacing: '0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '18px' }}>💥</span>
        爆管模拟
      </h3>

      {!selectedPipeline && !burstState.isActive && (
        <div
          style={{
            padding: '16px',
            background: 'rgba(251, 191, 36, 0.1)',
            border: '1px dashed rgba(251, 191, 36, 0.3)',
            borderRadius: '8px',
            color: '#fbbf24',
            fontSize: '13px',
            lineHeight: 1.6,
          }}
        >
          <div style={{ marginBottom: '8px', fontWeight: 600 }}>💡 操作提示</div>
          <div style={{ color: '#cbd5e1', fontSize: '12px' }}>
            点击地图上的管道进行选择，然后开始爆管模拟
          </div>
        </div>
      )}

      {selectedPipeline && !burstState.isActive && (
        <div>
          <div
            style={{
              padding: '12px',
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '8px',
              marginBottom: '16px',
            }}
          >
            <div
              style={{
                fontSize: '12px',
                color: '#94a3b8',
                marginBottom: '4px',
              }}
            >
              已选择管道
            </div>
            <div
              style={{
                color: '#f1f5f9',
                fontWeight: 600,
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <div
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '3px',
                  background: selectedPipeline.color,
                }}
              />
              {selectedPipeline.name}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: '#64748b',
                marginTop: '4px',
              }}
            >
              类型: {getPipelineTypeLabel(selectedPipeline.type)} | 半径:{' '}
              {selectedPipeline.radius}m
            </div>
          </div>

          <button
            onClick={onStartSimulation}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
              color: 'white',
              boxShadow: '0 4px 15px rgba(239, 68, 68, 0.4)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(239, 68, 68, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 15px rgba(239, 68, 68, 0.4)';
            }}
          >
            🚰 开始爆管模拟
          </button>
        </div>
      )}

      {burstState.isActive && (
        <div>
          <div
            style={{
              padding: '12px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '8px',
              marginBottom: '16px',
              animation: 'pulse 2s ease-in-out infinite',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: '#ef4444',
                fontWeight: 600,
                fontSize: '14px',
                marginBottom: '8px',
              }}
            >
              <span style={{ animation: 'spin 1s linear infinite' }}>⚠️</span>
              爆管模拟进行中
            </div>

            <div style={{ marginBottom: '12px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '11px',
                  color: '#94a3b8',
                  marginBottom: '4px',
                }}
              >
                <span>水流扩散进度</span>
                <span>{Math.round(burstState.waterSpreadProgress * 100)}%</span>
              </div>
              <div
                style={{
                  height: '6px',
                  background: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: '3px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: 'linear-gradient(90deg, #3b82f6, #06b6d4)',
                    width: `${burstState.waterSpreadProgress * 100}%`,
                    transition: 'width 0.3s ease',
                    borderRadius: '3px',
                  }}
                />
              </div>
            </div>

            <div
              style={{
                fontSize: '11px',
                color: '#94a3b8',
              }}
            >
              爆管位置: {burstState.burstPosition?.[0].toFixed(4)},{' '}
              {burstState.burstPosition?.[1].toFixed(4)}
            </div>
          </div>

          {valves.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div
                style={{
                  fontSize: '12px',
                  color: '#94a3b8',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>🔧</span>
                受影响阀门 ({valves.length})
              </div>
              <div
                style={{
                  maxHeight: '150px',
                  overflowY: 'auto',
                  paddingRight: '4px',
                }}
              >
                {valves.map((valve) => (
                  <div
                    key={valve.id}
                    style={{
                      padding: '8px 10px',
                      background: 'rgba(251, 191, 36, 0.1)',
                      border: '1px solid rgba(251, 191, 36, 0.2)',
                      borderRadius: '6px',
                      marginBottom: '6px',
                      fontSize: '12px',
                    }}
                  >
                    <div
                      style={{
                        color: '#fbbf24',
                        fontWeight: 500,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>{valve.name}</span>
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          background: 'rgba(251, 191, 36, 0.2)',
                          borderRadius: '4px',
                        }}
                      >
                        {getValveTypeLabel(valve.type)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#64748b',
                        marginTop: '2px',
                      }}
                    >
                      状态: <span style={{ color: '#22c55e' }}>需要关闭</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={onStopSimulation}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              background: 'linear-gradient(135deg, #64748b 0%, #475569 100%)',
              color: 'white',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            ⏹ 停止模拟
          </button>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        ::-webkit-scrollbar {
          width: 4px;
        }
        ::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 2px;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
};

export default BurstControlPanel;
