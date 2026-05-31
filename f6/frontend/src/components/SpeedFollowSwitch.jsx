const SpeedFollowSwitch = ({ isFollowing, onFollowingChange, disabled, label }) => {
  const handleToggle = () => {
    if (disabled) return
    if (onFollowingChange) {
      onFollowingChange(!isFollowing)
    }
  }

  return (
    <div className="speed-follow-switch-container">
      <div className="switch-header">
        <span className="switch-label">{label || '伴奏速度跟随'}</span>
        <span className={`status-indicator ${isFollowing ? 'active' : 'inactive'}`}>
          {isFollowing ? '● 已开启' : '○ 已关闭'}
        </span>
      </div>

      <div className="switch-main">
        <button
          className={`switch-button ${isFollowing ? 'on' : 'off'} ${disabled ? 'disabled' : ''}`}
          onClick={handleToggle}
          disabled={disabled}
          aria-label={isFollowing ? '关闭速度跟随' : '开启速度跟随'}
        >
          <div className="switch-track">
            <div className="switch-thumb"></div>
          </div>
          <span className="switch-text">{isFollowing ? '跟随中' : '未跟随'}</span>
        </button>

        <div className="switch-info">
          {isFollowing ? (
            <div className="info-active">
              <span className="info-icon">🎵</span>
              <span className="info-text">
                伴奏将实时跟随检测到的速度变化
              </span>
            </div>
          ) : (
            <div className="info-inactive">
              <span className="info-icon">⏸️</span>
              <span className="info-text">
                点击开关启用实时速度跟随
              </span>
            </div>
          )}
        </div>
      </div>

      {disabled && (
        <div className="switch-disabled-hint">
          <span className="hint-icon">🔗</span>
          <span className="hint-text">
            请先连接 WebSocket 以启用速度跟随功能
          </span>
        </div>
      )}
    </div>
  )
}

export default SpeedFollowSwitch
