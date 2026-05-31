import React from 'react';

function AlertBanner({ alerts, onDismiss }) {
  const getAlertIcon = (type) => {
    switch (type) {
      case 'conductivity': return '⚡';
      case 'humidity': return '💧';
      case 'temperature': return '🌡️';
      default: return '⚠️';
    }
  };

  return (
    <div className="alert-banner">
      {alerts.map((alert) => (
        <div key={alert.id} className={`alert-item ${alert.level}`}>
          <div className="alert-header">
            <span className="alert-title">
              {getAlertIcon(alert.type)} 警报 - 设备 {alert.devEui.slice(-4)}
            </span>
            <button className="alert-close" onClick={() => onDismiss(alert.id)}>
              ×
            </button>
          </div>
          <div className="alert-message">{alert.message}</div>
          <div className="alert-time">
            {new Date(alert.timestamp).toLocaleString('zh-CN')}
          </div>
        </div>
      ))}
    </div>
  );
}

export default AlertBanner;
