import React from 'react';
import type { SuspiciousAlert } from '../types';

interface AlertPanelProps {
  alerts: SuspiciousAlert[];
  onDismiss: () => void;
  onClear: () => void;
  onResumePid: (pid: number) => void;
  onStopPid: (pid: number) => void;
  showModal: boolean;
  onCloseModal: () => void;
  latestAlert: SuspiciousAlert | null;
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
};

export const AlertPanel: React.FC<AlertPanelProps> = React.memo(({
  alerts,
  onDismiss,
  onClear,
  onResumePid,
  onStopPid,
  showModal,
  onCloseModal,
  latestAlert,
}) => {
  if (alerts.length === 0) {
    return null;
  }

  return (
    <>
      <div className="bg-red-900/50 border border-red-600 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🚨</span>
            <div>
              <h3 className="text-white text-lg font-bold">安全警报</h3>
              <p className="text-red-300 text-sm">
                检测到 {alerts.length} 条可疑活动
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onDismiss}
              className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
            >
              忽略警报
            </button>
            <button
              onClick={onClear}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
            >
              清除所有
            </button>
          </div>
        </div>

        <div className="space-y-3 max-h-64 overflow-y-auto">
          {alerts.slice(0, 10).map((alert, index) => (
            <div
              key={`${alert.timestamp}-${index}`}
              className="bg-red-950/50 border border-red-800 rounded p-3"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-red-400 font-mono text-sm">
                      {alert.comm} (PID: {alert.pid})
                    </span>
                    <span className="text-gray-500 text-xs">
                      {formatTime(alert.timestamp)}
                    </span>
                  </div>
                  <p className="text-white text-sm">
                    <span className="text-yellow-400 font-bold">
                      {alert.syscall.toUpperCase()}
                    </span>
                    {' - '}
                    {alert.reason}
                  </p>
                  {alert.filename && (
                    <p className="text-gray-400 text-xs mt-1 font-mono">
                      文件: {alert.filename}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 ml-4">
                  {alert.stopped ? (
                    <button
                      onClick={() => onResumePid(alert.pid)}
                      className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-xs rounded transition-colors"
                    >
                      恢复进程
                    </button>
                  ) : (
                    <button
                      onClick={() => onStopPid(alert.pid)}
                      className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded transition-colors"
                    >
                      暂停进程
                    </button>
                  )}
                </div>
              </div>
              {alert.stopped && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded bg-red-500 animate-pulse" />
                  <span className="text-red-400 text-xs">进程已暂停</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {alerts.length > 10 && (
          <p className="text-gray-400 text-xs mt-2 text-center">
            还有 {alerts.length - 10} 条警报未显示
          </p>
        )}
      </div>

      {showModal && latestAlert && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border-2 border-red-600 rounded-lg max-w-lg w-full p-6 animate-pulse">
            <div className="flex items-center gap-4 mb-6">
              <span className="text-5xl">⚠️</span>
              <div>
                <h2 className="text-2xl font-bold text-red-500">检测到可疑活动！</h2>
                <p className="text-gray-400">系统检测到潜在的安全威胁</p>
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg p-4 mb-6">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-gray-400 text-xs">进程名</p>
                  <p className="text-white font-mono">{latestAlert.comm}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs">PID</p>
                  <p className="text-white font-mono">{latestAlert.pid}</p>
                </div>
              </div>
              <div className="mb-4">
                <p className="text-gray-400 text-xs">系统调用</p>
                <p className="text-yellow-400 font-bold text-lg">
                  {latestAlert.syscall.toUpperCase()}
                </p>
              </div>
              <div className="mb-4">
                <p className="text-gray-400 text-xs">原因</p>
                <p className="text-white">{latestAlert.reason}</p>
              </div>
              {latestAlert.filename && (
                <div>
                  <p className="text-gray-400 text-xs">文件路径</p>
                  <p className="text-red-400 font-mono text-sm">{latestAlert.filename}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${latestAlert.stopped ? 'bg-red-500' : 'bg-green-500'}`} />
                <span className="text-gray-400 text-sm">
                  {latestAlert.stopped ? '进程已暂停' : '进程正在运行'}
                </span>
              </div>
              <div className="flex gap-2">
                {latestAlert.stopped ? (
                  <button
                    onClick={() => {
                      onResumePid(latestAlert.pid);
                      onCloseModal();
                    }}
                    className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded transition-colors"
                  >
                    恢复进程
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      onStopPid(latestAlert.pid);
                      onCloseModal();
                    }}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
                  >
                    暂停进程
                  </button>
                )}
                <button
                  onClick={onCloseModal}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

AlertPanel.displayName = 'AlertPanel';
