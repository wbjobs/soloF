import React, { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { createActor } from 'xstate';
import { syscallMachine } from './stateMachine';
import { useWebSocket } from './useWebSocket';
import type { SyscallEvent, WebSocketMessage, SuspiciousAlert, ProcessState } from './types';
import { PidControl } from './components/PidControl';
import { StatsPanel } from './components/StatsPanel';
import { StateTransitionGraph } from './components/StateTransitionGraph';
import { EventLog } from './components/EventLog';
import { AlertPanel } from './components/AlertPanel';

const WS_URL = window.location.protocol === 'https:'
  ? `wss://${window.location.host}/ws`
  : `ws://${window.location.host}/ws`;

const BATCH_INTERVAL = 100;
const MAX_BATCH_SIZE = 200;

const actor = createActor(syscallMachine);
actor.start();

function App() {
  const [snapshot, setSnapshot] = useState(actor.getSnapshot());
  const processes = snapshot.context.processes as Map<number, ProcessState>;
  const eventLog = snapshot.context.eventLog as SyscallEvent[];
  const alerts = snapshot.context.alerts as SuspiciousAlert[];
  const hasActiveAlert = snapshot.context.hasActiveAlert as boolean;
  const stoppedPids = snapshot.context.stoppedPids as Set<number>;

  useEffect(() => {
    const subscription = actor.subscribe({
      next: (s) => setSnapshot(s),
    });
    return () => subscription.unsubscribe();
  }, []);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [monitoredPids, setMonitoredPids] = useState<number[]>([]);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [latestAlert, setLatestAlert] = useState<SuspiciousAlert | null>(null);

  const eventBufferRef = useRef<SyscallEvent[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const isFlushingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playAlertSound = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = 800;
      oscillator.type = 'square';
      gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.error('Failed to play alert sound:', e);
    }
  }, []);

  const flushBuffer = useCallback(() => {
    if (isFlushingRef.current) return;

    const buffer = eventBufferRef.current;
    if (buffer.length === 0) {
      isFlushingRef.current = false;
      return;
    }

    isFlushingRef.current = true;
    const eventsToProcess = buffer.splice(0, Math.min(buffer.length, MAX_BATCH_SIZE));

    try {
      actor.send({ type: 'SYSCALLS_RECEIVED', events: eventsToProcess });
    } catch (e) {
      console.error('Error processing batch events:', e);
    }

    isFlushingRef.current = false;

    if (buffer.length > 0) {
      flushTimerRef.current = window.setTimeout(flushBuffer, 0);
    }
  }, []);

  const handleSyscallEvent = useCallback((event: SyscallEvent) => {
    eventBufferRef.current.push(event);

    if (flushTimerRef.current === null) {
      flushTimerRef.current = window.setTimeout(flushBuffer, BATCH_INTERVAL);
    }

    if (eventBufferRef.current.length >= MAX_BATCH_SIZE) {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      flushBuffer();
    }
  }, [flushBuffer]);

  const handleAlert = useCallback((alert: SuspiciousAlert) => {
    setLatestAlert(alert);
    setShowAlertModal(true);
    playAlertSound();
    actor.send({ type: 'ALERT_RECEIVED', alert });
  }, [playAlertSound]);

  const handleMessage = useCallback((message: WebSocketMessage) => {
    if (message.type === 'pid_list' && message.pids) {
      setMonitoredPids(message.pids);
    } else if (message.type === 'pid_added' && message.pid) {
      setMonitoredPids(prev => [...new Set([...prev, message.pid!])]);
    } else if (message.type === 'pid_removed' && message.pid) {
      setMonitoredPids(prev => prev.filter(p => p !== message.pid));
    } else if (message.type === 'suspicious_alert' && message.alert) {
      handleAlert(message.alert);
    } else if (message.type === 'pid_stopped' && message.pid) {
      actor.send({ type: 'PROCESS_STOPPED', pid: message.pid });
    } else if (message.type === 'pid_resumed' && message.pid) {
      actor.send({ type: 'PROCESS_RESUMED', pid: message.pid });
    }
  }, [handleAlert]);

  const { isConnected, addPid, removePid, listPids, resumePid, stopPid } = useWebSocket({
    url: WS_URL,
    onMessage: handleMessage,
    onSyscallEvent: handleSyscallEvent,
  });

  useEffect(() => {
    if (isConnected) {
      listPids();
    }
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
    };
  }, [isConnected, listPids]);

  const handleAddPid = useCallback((pid: number) => {
    if (addPid(pid)) {
      setMonitoredPids(prev => [...new Set([...prev, pid])]);
    }
  }, [addPid]);

  const handleRemovePid = useCallback((pid: number) => {
    if (removePid(pid)) {
      setMonitoredPids(prev => prev.filter(p => p !== pid));
      actor.send({ type: 'REMOVE_PROCESS', pid });
      if (selectedPid === pid) {
        setSelectedPid(null);
      }
    }
  }, [removePid, selectedPid]);

  const handleResumePid = useCallback((pid: number) => {
    resumePid(pid);
  }, [resumePid]);

  const handleStopPid = useCallback((pid: number) => {
    stopPid(pid);
  }, [stopPid]);

  const handleClearLog = useCallback(() => {
    actor.send({ type: 'CLEAR_LOG' });
  }, []);

  const handleDismissAlert = useCallback(() => {
    setShowAlertModal(false);
    actor.send({ type: 'DISMISS_ALERT' });
  }, []);

  const handleClearAlerts = useCallback(() => {
    setShowAlertModal(false);
    actor.send({ type: 'CLEAR_ALERTS' });
  }, []);

  const selectedProcess = useMemo(() => {
    return selectedPid ? processes.get(selectedPid) : null;
  }, [processes, selectedPid]);

  const processList = useMemo(() => {
    return Array.from(processes.values());
  }, [processes]);

  const alertBgClass = hasActiveAlert
    ? 'bg-red-900/30 transition-colors duration-300'
    : 'bg-gray-950 transition-colors duration-300';

  const alertBorderClass = hasActiveAlert
    ? 'border-red-500 animate-pulse'
    : 'border-gray-800';

  return (
    <div className={`min-h-screen ${alertBgClass} text-white transition-all duration-300`}>
      {hasActiveAlert && (
        <div className="fixed top-0 left-0 right-0 bg-red-600 text-white text-center py-2 z-50 animate-pulse">
          ⚠️ 检测到可疑活动！请查看警报面板。
        </div>
      )}

      <header className={`bg-gray-900 border-b ${alertBorderClass} px-6 py-4 mt-${hasActiveAlert ? '10' : '0'}`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              eBPF 系统调用监控可视化
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              实时监控进程的 open、read、write、execve 系统调用
            </p>
          </div>
          {alerts.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="bg-red-600 text-white px-3 py-1 rounded-full text-sm font-bold">
                {alerts.length} 条警报
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <AlertPanel
          alerts={alerts}
          onDismiss={handleDismissAlert}
          onClear={handleClearAlerts}
          onResumePid={handleResumePid}
          onStopPid={handleStopPid}
          showModal={showAlertModal}
          onCloseModal={() => setShowAlertModal(false)}
          latestAlert={latestAlert}
        />

        <PidControl
          isConnected={isConnected}
          onAddPid={handleAddPid}
          onRemovePid={handleRemovePid}
          onListPids={listPids}
          monitoredPids={monitoredPids}
          stoppedPids={stoppedPids}
          onResumePid={handleResumePid}
          onStopPid={handleStopPid}
        />

        <StatsPanel processes={processes} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <div className="bg-gray-900 rounded-lg p-4 mb-4">
              <h3 className="text-white text-lg font-semibold mb-4">选择进程查看状态流转图</h3>
              <div className="flex flex-wrap gap-2">
                {processList.map((process) => (
                  <button
                    key={process.pid}
                    onClick={() => setSelectedPid(process.pid)}
                    className={`px-3 py-2 rounded text-sm font-medium transition-colors flex items-center gap-2 ${
                      selectedPid === process.pid
                        ? 'bg-blue-600 text-white'
                        : process.isStopped
                        ? 'bg-red-900 text-red-300 hover:bg-red-800'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {process.isStopped && <span>⏸</span>}
                    {process.comm} ({process.pid})
                  </button>
                ))}
                {processList.length === 0 && (
                  <span className="text-gray-500 text-sm">暂无监控数据</span>
                )}
              </div>
            </div>

            {selectedProcess && (
              <StateTransitionGraph process={selectedProcess} />
            )}
          </div>

          <EventLog events={eventLog} onClear={handleClearLog} />
        </div>

        <div className="bg-gray-900 rounded-lg p-4">
          <h3 className="text-white text-lg font-semibold mb-4">系统调用说明</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-gray-800 rounded p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-4 h-4 rounded bg-blue-500" />
                <h4 className="text-blue-400 font-semibold">OPEN</h4>
              </div>
              <p className="text-gray-400 text-sm">
                打开或创建文件，返回文件描述符。监控该调用可以了解进程访问哪些文件。
              </p>
            </div>
            <div className="bg-gray-800 rounded p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-4 h-4 rounded bg-green-500" />
                <h4 className="text-green-400 font-semibold">READ</h4>
              </div>
              <p className="text-gray-400 text-sm">
                从文件描述符读取数据。可以监控读取的数据量和频率。
              </p>
            </div>
            <div className="bg-gray-800 rounded p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-4 h-4 rounded bg-yellow-500" />
                <h4 className="text-yellow-400 font-semibold">WRITE</h4>
              </div>
              <p className="text-gray-400 text-sm">
                向文件描述符写入数据。可以监控写入的数据量和频率。
              </p>
            </div>
            <div className="bg-gray-800 rounded p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-4 h-4 rounded bg-purple-500" />
                <h4 className="text-purple-400 font-semibold">EXECVE</h4>
              </div>
              <p className="text-gray-400 text-sm">
                执行新程序。敏感操作监控，防止执行恶意程序。
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-gray-900 border-t border-gray-800 px-6 py-4 mt-8">
        <div className="max-w-7xl mx-auto text-center text-gray-500 text-sm">
          eBPF Syscall Monitor - 基于 BCC + React + XState
        </div>
      </footer>
    </div>
  );
}

export default App;
