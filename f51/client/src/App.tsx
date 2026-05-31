import { LoginForm } from './components/LoginForm';
import { MicroscopeView } from './components/MicroscopeView';
import { useRoom } from './hooks/useRoom';
import { Role } from '@shared/types';

function App() {
  const {
    roomId,
    role,
    roomState,
    localStream,
    remoteStreams,
    previousSpeakerStream,
    isSwitchingSpeaker,
    isConnected,
    error,
    magnification,
    scaleBarLength,
    scaleUnit,
    joinRoom,
    leaveRoom,
    updateMagnification,
  } = useRoom();

  const handleJoin = (room: string, name: string, userRole: Role) => {
    joinRoom(room, name, userRole);
  };

  if (!isConnected) {
    return <LoginForm onJoin={handleJoin} error={error} />;
  }

  const remoteStreamsArray = Array.from(remoteStreams.values());

  return (
    <div style={appStyle}>
      <header style={headerStyle}>
        <div style={headerLeftStyle}>
          <h1 style={headerTitleStyle}>🔬 远程显微镜协作系统</h1>
          <span style={roomBadgeStyle}>房间: {roomId}</span>
          <span style={{
            ...roleBadgeStyle,
            backgroundColor: role === 'speaker' ? '#e74c3c' : '#3498db',
          }}>
            {role === 'speaker' ? '🎤 主讲人' : '👁️ 观众'}
          </span>
        </div>
        <button onClick={leaveRoom} style={leaveButtonStyle}>
          离开房间
        </button>
      </header>

      <main style={mainStyle}>
        <div style={videoGridStyle}>
          {role === 'speaker' && localStream && (
            <div style={videoContainerStyle}>
              <MicroscopeView
                stream={localStream}
                isLocal={true}
                label="你的画面"
                scaleBarLength={scaleBarLength}
                magnification={magnification}
                scaleUnit={scaleUnit}
                onMagnificationChange={updateMagnification}
              />
            </div>
          )}

          {remoteStreamsArray.map(({ stream, peer }) => (
            <div key={peer.id} style={videoContainerStyle}>
              <MicroscopeView
                stream={stream}
                isLocal={false}
                label={`${peer.name}${peer.role === 'speaker' ? ' (主讲人)' : ''}`}
                scaleBarLength={scaleBarLength}
                magnification={magnification}
                scaleUnit={scaleUnit}
                onMagnificationChange={peer.role === 'speaker' ? updateMagnification : undefined}
              />
            </div>
          ))}

          {role === 'viewer' && remoteStreamsArray.length === 0 && !previousSpeakerStream && (
            <div style={emptyStateStyle}>
              <div style={emptyIconStyle}>🎥</div>
              <h3 style={{ margin: '16px 0 8px 0' }}>等待主讲人...</h3>
              <p style={{ color: '#666', margin: 0 }}>
                主讲人尚未开始推送视频流
              </p>
            </div>
          )}

          {role === 'viewer' && remoteStreamsArray.length === 0 && previousSpeakerStream && (
            <div style={videoContainerStyle}>
              <div style={switchingBannerStyle}>
                ⏳ 正在切换主讲人...
              </div>
              <MicroscopeView
                stream={previousSpeakerStream.stream}
                isLocal={false}
                label={`${previousSpeakerStream.peer.name} (上一位主讲人)`}
                scaleBarLength={scaleBarLength}
                magnification={magnification}
                scaleUnit={scaleUnit}
              />
            </div>
          )}
        </div>

        <aside style={sidebarStyle}>
          <div style={sidebarSectionStyle}>
            <h3 style={sidebarTitleStyle}>👥 参与者 ({roomState?.peers.length || 0})</h3>
            <div style={participantListStyle}>
              {roomState?.peers.map((peer) => (
                <div
                  key={peer.id}
                  style={{
                    ...participantItemStyle,
                    ...(peer.role === 'speaker' ? activeSpeakerStyle : {}),
                  }}
                >
                  <span>{peer.role === 'speaker' ? '🎤' : '👁️'} {peer.name}</span>
                  {peer.role === 'speaker' && (
                    <span style={speakerTagStyle}>主讲人</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={sidebarSectionStyle}>
            <h3 style={sidebarTitleStyle}>ℹ️ 系统信息</h3>
            <div style={infoListStyle}>
              <div style={infoItemStyle}>
                <span>编码格式:</span>
                <span style={codecStyle}>H.264</span>
              </div>
              <div style={infoItemStyle}>
                <span>传输协议:</span>
                <span style={codecStyle}>WebRTC/SFU</span>
              </div>
              <div style={infoItemStyle}>
                <span>3D 景深:</span>
                <span style={codecStyle}>Three.js</span>
              </div>
            </div>
          </div>

          <div style={sidebarSectionStyle}>
            <h3 style={sidebarTitleStyle}>💡 使用说明</h3>
            <ul style={tipsListStyle}>
              <li>点击右下角控制景深叠加效果</li>
              <li>线框模式可查看 3D 网格结构</li>
              <li>调整景深强度可改变起伏幅度</li>
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
}

const appStyle: React.CSSProperties = {
  minHeight: '100vh',
  backgroundColor: '#0a0a0f',
  color: '#fff',
  display: 'flex',
  flexDirection: 'column',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 24px',
  backgroundColor: 'rgba(20, 20, 30, 0.95)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
};

const headerLeftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
};

const headerTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '20px',
};

const roomBadgeStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255, 255, 255, 0.1)',
  padding: '6px 12px',
  borderRadius: '4px',
  fontSize: '14px',
};

const roleBadgeStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '4px',
  fontSize: '14px',
  fontWeight: '600',
};

const leaveButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  backgroundColor: '#e74c3c',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: '600',
  cursor: 'pointer',
  transition: 'background-color 0.2s',
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  padding: '24px',
  gap: '24px',
  overflow: 'hidden',
};

const videoGridStyle: React.CSSProperties = {
  flex: 1,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))',
  gap: '16px',
  overflowY: 'auto',
};

const videoContainerStyle: React.CSSProperties = {
  aspectRatio: '16 / 9',
  minHeight: '360px',
  borderRadius: '8px',
  overflow: 'hidden',
};

const sidebarStyle: React.CSSProperties = {
  width: '280px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  flexShrink: 0,
};

const sidebarSectionStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  borderRadius: '8px',
  padding: '16px',
};

const sidebarTitleStyle: React.CSSProperties = {
  margin: '0 0 12px 0',
  fontSize: '14px',
  color: '#aaa',
};

const participantListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const participantItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  borderRadius: '6px',
  fontSize: '14px',
};

const activeSpeakerStyle: React.CSSProperties = {
  backgroundColor: 'rgba(231, 76, 60, 0.2)',
  border: '1px solid rgba(231, 76, 60, 0.5)',
};

const speakerTagStyle: React.CSSProperties = {
  backgroundColor: '#e74c3c',
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '11px',
  fontWeight: '600',
};

const infoListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const infoItemStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: '13px',
  color: '#aaa',
};

const codecStyle: React.CSSProperties = {
  color: '#4a90d9',
  fontWeight: '600',
};

const tipsListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '20px',
  fontSize: '12px',
  color: '#888',
  lineHeight: '1.8',
};

const emptyStateStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '60px 20px',
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  borderRadius: '8px',
  border: '2px dashed rgba(255, 255, 255, 0.1)',
};

const emptyIconStyle: React.CSSProperties = {
  fontSize: '64px',
  opacity: 0.5,
};

const switchingBannerStyle: React.CSSProperties = {
  position: 'absolute',
  top: '12px',
  left: '50%',
  transform: 'translateX(-50%)',
  backgroundColor: 'rgba(231, 76, 60, 0.9)',
  color: 'white',
  padding: '8px 20px',
  borderRadius: '20px',
  fontSize: '14px',
  fontWeight: '600',
  zIndex: 15,
  animation: 'pulse 1.5s infinite',
};

export default App;
