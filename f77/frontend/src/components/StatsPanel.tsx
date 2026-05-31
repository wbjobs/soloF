import React, { useMemo } from 'react';
import type { ProcessState } from '../types';

interface StatsPanelProps {
  processes: Map<number, ProcessState>;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const StatCard: React.FC<{ label: string; value: string | number; color: string }> = React.memo(({ label, value, color }) => (
  <div className="bg-gray-800 rounded-lg p-4">
    <p className="text-gray-400 text-sm">{label}</p>
    <p className={`text-2xl font-bold ${color}`}>{value}</p>
  </div>
));

StatCard.displayName = 'StatCard';

const ProcessItem: React.FC<{ process: ProcessState }> = React.memo(({ process }) => (
  <div className={`bg-gray-800 rounded p-3 flex justify-between items-center ${process.isStopped ? 'border border-red-500' : ''}`}>
    <div className="flex items-center gap-2">
      {process.isStopped && <span className="text-red-400">⏸</span>}
      <span className="text-white font-mono">{process.comm}</span>
      <span className="text-gray-500 ml-2 text-sm">PID: {process.pid}</span>
      {process.stats.alerts > 0 && (
        <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full">
          ⚠️ {process.stats.alerts}
        </span>
      )}
    </div>
    <div className="flex gap-4 text-sm">
      <span className="text-blue-400">O: {process.stats.openCount}</span>
      <span className="text-green-400">R: {process.stats.readCount}</span>
      <span className="text-yellow-400">W: {process.stats.writeCount}</span>
      <span className="text-purple-400">E: {process.stats.execveCount}</span>
    </div>
  </div>
));

ProcessItem.displayName = 'ProcessItem';

export const StatsPanel: React.FC<StatsPanelProps> = React.memo(({ processes }) => {
  const { totalStats, processList } = useMemo(() => {
    let openCount = 0;
    let readCount = 0;
    let writeCount = 0;
    let execveCount = 0;
    let totalBytesRead = 0;
    let totalBytesWritten = 0;
    let errors = 0;
    let alerts = 0;

    const list: ProcessState[] = [];

    processes.forEach((process) => {
      openCount += process.stats.openCount;
      readCount += process.stats.readCount;
      writeCount += process.stats.writeCount;
      execveCount += process.stats.execveCount;
      totalBytesRead += process.stats.totalBytesRead;
      totalBytesWritten += process.stats.totalBytesWritten;
      errors += process.stats.errors;
      alerts += process.stats.alerts;
      list.push(process);
    });

    return {
      totalStats: { openCount, readCount, writeCount, execveCount, totalBytesRead, totalBytesWritten, errors, alerts },
      processList: list,
    };
  }, [processes]);

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <h3 className="text-white text-lg font-semibold mb-4">系统统计</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        <StatCard label="OPEN 调用" value={totalStats.openCount} color="text-blue-400" />
        <StatCard label="READ 调用" value={totalStats.readCount} color="text-green-400" />
        <StatCard label="WRITE 调用" value={totalStats.writeCount} color="text-yellow-400" />
        <StatCard label="EXECVE 调用" value={totalStats.execveCount} color="text-purple-400" />
        <StatCard label="读取字节" value={formatBytes(totalStats.totalBytesRead)} color="text-cyan-400" />
        <StatCard label="写入字节" value={formatBytes(totalStats.totalBytesWritten)} color="text-pink-400" />
        <StatCard label="错误数" value={totalStats.errors} color="text-red-400" />
        <StatCard label="安全警报" value={totalStats.alerts} color="text-red-500" />
      </div>

      <div className="mt-6">
        <h4 className="text-white text-md font-semibold mb-3">进程列表 ({processes.size})</h4>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {processList.map((process) => (
            <ProcessItem key={process.pid} process={process} />
          ))}
          {processList.length === 0 && (
            <div className="text-gray-500 text-center py-4">
              暂无监控的进程
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

StatsPanel.displayName = 'StatsPanel';
