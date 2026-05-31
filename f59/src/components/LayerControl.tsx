import { PipelineLayer } from '../types';

interface LayerControlProps {
  layers: PipelineLayer[];
  onLayerToggle: (layerId: string) => void;
  isXrayMode: boolean;
  onXrayToggle: (enabled: boolean) => void;
}

const LayerControl = ({ layers, onLayerToggle, isXrayMode, onXrayToggle }: LayerControlProps) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        background: 'rgba(15, 23, 42, 0.9)',
        backdropFilter: 'blur(12px)',
        borderRadius: '12px',
        padding: '20px',
        minWidth: '260px',
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
        }}
      >
        地下管网 AR 可视化
      </h3>

      <div
        style={{
          marginBottom: '20px',
        }}
      >
        <button
          onClick={() => onXrayToggle(!isXrayMode)}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
            transition: 'all 0.2s ease',
            background: isXrayMode
              ? 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)'
              : 'linear-gradient(135deg, #475569 0%, #334155 100%)',
            color: 'white',
            boxShadow: isXrayMode
              ? '0 4px 15px rgba(6, 182, 212, 0.4)'
              : 'none',
          }}
        >
          {isXrayMode ? '✓ 透视模式已开启' : '🔍 开启透视模式'}
        </button>
        <p
          style={{
            margin: '8px 0 0 0',
            fontSize: '11px',
            color: '#94a3b8',
            textAlign: 'center',
          }}
        >
          右键点击地图也可切换透视模式
        </p>
      </div>

      <div
        style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          paddingTop: '16px',
        }}
      >
        <div
          style={{
            marginBottom: '12px',
            fontSize: '12px',
            color: '#94a3b8',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            fontWeight: 500,
          }}
        >
          图层控制
        </div>

        {layers.map((layer) => (
          <div
            key={layer.id}
            onClick={() => onLayerToggle(layer.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 12px',
              borderRadius: '8px',
              cursor: 'pointer',
              marginBottom: '6px',
              transition: 'all 0.2s ease',
              background: layer.visible
                ? 'rgba(255, 255, 255, 0.05)'
                : 'transparent',
              opacity: layer.visible ? 1 : 0.5,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = layer.visible
                ? 'rgba(255, 255, 255, 0.05)'
                : 'transparent';
            }}
          >
            <div
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '4px',
                marginRight: '12px',
                background: layer.color,
                boxShadow: `0 0 10px ${layer.color}40`,
              }}
            />
            <span
              style={{
                flex: 1,
                color: '#e2e8f0',
                fontSize: '14px',
              }}
            >
              {layer.name}
            </span>
            <div
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '4px',
                border: '2px solid rgba(255, 255, 255, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: layer.visible
                  ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                  : 'transparent',
              }}
            >
              {layer.visible && (
                <span
                  style={{
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: 'bold',
                  }}
                >
                  ✓
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          marginTop: '16px',
          paddingTop: '16px',
          fontSize: '11px',
          color: '#64748b',
          lineHeight: 1.6,
        }}
      >
        <div style={{ marginBottom: '4px' }}>💡 <strong>操作提示：</strong></div>
        <div>• 左键拖拽：旋转视角</div>
        <div>• 滚轮：缩放</div>
        <div>• 右键：切换透视模式</div>
      </div>
    </div>
  );
};

export default LayerControl;
