import React, { useState, useCallback } from 'react';

interface PidControlProps {
  isConnected: boolean;
  onAddPid: (pid: number) => void;
  onRemovePid: (pid: number) => void;
  onListPids: () => void;
  monitoredPids: number[];
  stoppedPids: Set<number>;
  onResumePid: (pid: number) => void;
  onStopPid: (pid: number) => void;
}

export const PidControl: React.FC<PidControlProps> = React.memo(({
  isConnected,
  onAddPid,
  onRemovePid,
  monitoredPids,
  stoppedPids,
  onResumePid,
  onStopPid,
}) => {
  const [pidInput, setPidInput] = useState('');

  const handleAddPid = useCallback(() => {
    const pid = parseInt(pidInput, 10);
    if (!isNaN(pid) && pid > 0) {
      onAddPid(pid);
      setPidInput('');
    }
  }, [pidInput, onAddPid]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddPid();
    }
  }, [handleAddPid]);

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white text-lg font-semibold">进程监控控制</h3>
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-gray-400 text-sm">
            {isConnected ? '已连接' : '未连接'}
          </span>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="number"
          value={pidInput}
          onChange={(e) => setPidInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="输入要监控的 PID"
          className="flex-1 px-4 py-2 bg-gray-800 text-white rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
          min="1"
          disabled={!isConnected}
        />
        <button
          onClick={handleAddPid}
          disabled={!isConnected || !pidInput}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
        >
          添加监控
        </button>
      </div>

      <div>
        <h4 className="text-gray-400 text-sm mb-2">
          正在监控的进程 ({monitoredPids.length})
        </h4>
        <div className="flex flex-wrap gap-2">
          {monitoredPids.length === 0 ? (
            <span className="text-gray-500 text-sm">暂无监控的进程</span>
          ) : (
            monitoredPids.map((pid) => {
              const isStopped = stoppedPids.has(pid);
              return (
                <div
                  key={pid}
                  className={`flex items-center gap-2 px-3 py-1 rounded-full ${
                    isStopped ? 'bg-red-900 border border-red-600' : 'bg-gray-800'
                  }`}
                >
                  {isStopped && <span className="text-red-400">⏸</span>}
                  <span className={`font-mono text-sm ${isStopped ? 'text-red-300' : 'text-white'}`}>
                    PID {pid}
                  </span>
                  {isStopped ? (
                    <button
                      onClick={() => onResumePid(pid)}
                      className="text-green-400 hover:text-green-300 transition-colors"
                      title="恢复进程"
                    >
                      ▶
                    </button>
                  ) : (
                    <button
                      onClick={() => onStopPid(pid)}
                      className="text-yellow-400 hover:text-yellow-300 transition-colors"
                      title="暂停进程"
                    >
                      ⏸
                    </button>
                  )}
                  <button
                    onClick={() => onRemovePid(pid)}
                    className="text-red-400 hover:text-red-300 transition-colors"
                    title="移除监控"
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-800">
        <h4 className="text-gray-400 text-sm mb-2">快速操作</h4>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => onAddPid(1)}
            disabled={!isConnected || monitoredPids.includes(1)}
            className="px-3 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
          >
            监控 init (PID 1)
          </button>
          <button
            onClick={() => onAddPid(Math.floor(Math.random() * 9000) + 1000)}
            disabled={!isConnected}
            className="px-3 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
          >
            添加模拟 PID
          </button>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-800">
        <h4 className="text-gray-400 text-sm mb-2">敏感规则说明</h4>
        <div className="text-xs text-gray-500 space-y-1">
          <p>• 访问敏感文件 (/etc/passwd, /etc/shadow, /root 等)</p>
          <p>• 写入敏感文件</p>
          <p>• 执行敏感程序 (/bin/su, /usr/bin/sudo 等)</p>
          <p>触发时自动暂停进程并发出警报</p>
        </div>
      </div>
    </div>
  );
});

PidControl.displayName = 'PidControl';
