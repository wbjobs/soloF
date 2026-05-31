import { useState } from 'react';
import { Role } from '@shared/types';

interface LoginFormProps {
  onJoin: (roomId: string, name: string, role: Role) => void;
  error: string | null;
}

export function LoginForm({ onJoin, error }: LoginFormProps) {
  const [roomId, setRoomId] = useState('microscope-lab-001');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('viewer');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim() && name.trim()) {
      onJoin(roomId.trim(), name.trim(), role);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>🔬 远程显微镜协作系统</h1>
        <p style={subtitleStyle}>WebRTC + Mediasoup SFU</p>

        <form onSubmit={handleSubmit} style={formStyle}>
          <div style={inputGroupStyle}>
            <label style={labelStyle}>房间号</label>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              style={inputStyle}
              placeholder="输入房间号"
            />
          </div>

          <div style={inputGroupStyle}>
            <label style={labelStyle}>你的名字</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              placeholder="输入你的名字"
              required
            />
          </div>

          <div style={inputGroupStyle}>
            <label style={labelStyle}>角色选择</label>
            <div style={roleContainerStyle}>
              <label
                style={{
                  ...roleOptionStyle,
                  ...(role === 'speaker' ? roleSelectedStyle : {}),
                }}
              >
                <input
                  type="radio"
                  name="role"
                  value="speaker"
                  checked={role === 'speaker'}
                  onChange={() => setRole('speaker')}
                  style={{ marginRight: '8px' }}
                />
                🎤 主讲人
                <span style={roleDescStyle}>推送摄像头/麦克风</span>
              </label>
              <label
                style={{
                  ...roleOptionStyle,
                  ...(role === 'viewer' ? roleSelectedStyle : {}),
                }}
              >
                <input
                  type="radio"
                  name="role"
                  value="viewer"
                  checked={role === 'viewer'}
                  onChange={() => setRole('viewer')}
                  style={{ marginRight: '8px' }}
                />
                👁️ 观众
                <span style={roleDescStyle}>观看主讲人视频流</span>
              </label>
            </div>
          </div>

          {error && <div style={errorStyle}>⚠️ {error}</div>}

          <button type="submit" style={buttonStyle}>
            加入房间
          </button>
        </form>

        <div style={infoStyle}>
          <p>💡 <strong>主讲人模式：</strong>主讲人的视频流通过 SFU 转发给所有观众</p>
          <p>🎥 <strong>H.264 编码：</strong>自动协商 H.264 视频编码，确保最佳兼容性</p>
          <p>🌊 <strong>3D 景深：</strong>集成 Three.js 实现显微镜景深叠加效果</p>
        </div>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  padding: '20px',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255, 255, 255, 0.95)',
  borderRadius: '16px',
  padding: '40px',
  maxWidth: '500px',
  width: '100%',
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: '28px',
  color: '#1a1a2e',
  textAlign: 'center',
};

const subtitleStyle: React.CSSProperties = {
  margin: '0 0 32px 0',
  fontSize: '14px',
  color: '#666',
  textAlign: 'center',
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '20px',
};

const inputGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: '600',
  color: '#333',
};

const inputStyle: React.CSSProperties = {
  padding: '12px 16px',
  border: '2px solid #e0e0e0',
  borderRadius: '8px',
  fontSize: '16px',
  outline: 'none',
  transition: 'border-color 0.2s',
};

const roleContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
};

const roleOptionStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  padding: '16px',
  border: '2px solid #e0e0e0',
  borderRadius: '8px',
  cursor: 'pointer',
  transition: 'all 0.2s',
  fontSize: '14px',
  fontWeight: '500',
};

const roleSelectedStyle: React.CSSProperties = {
  borderColor: '#4a90d9',
  backgroundColor: '#e8f4fd',
};

const roleDescStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#666',
  fontWeight: '400',
  marginTop: '4px',
  marginLeft: '24px',
};

const errorStyle: React.CSSProperties = {
  backgroundColor: '#fee',
  border: '1px solid #fcc',
  color: '#c33',
  padding: '12px',
  borderRadius: '8px',
  fontSize: '14px',
};

const buttonStyle: React.CSSProperties = {
  padding: '14px 24px',
  backgroundColor: '#4a90d9',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  fontSize: '16px',
  fontWeight: '600',
  cursor: 'pointer',
  transition: 'background-color 0.2s',
};

const infoStyle: React.CSSProperties = {
  marginTop: '24px',
  paddingTop: '24px',
  borderTop: '1px solid #e0e0e0',
  fontSize: '12px',
  color: '#666',
  lineHeight: '1.8',
};
