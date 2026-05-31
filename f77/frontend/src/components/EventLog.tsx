import React, { useMemo } from 'react';
import type { SyscallEvent } from '../types';

interface EventLogProps {
  events: SyscallEvent[];
  onClear: () => void;
}

const SYS_CALL_COLORS: Record<string, string> = {
  open: 'bg-blue-900 text-blue-300',
  read: 'bg-green-900 text-green-300',
  write: 'bg-yellow-900 text-yellow-300',
  execve: 'bg-purple-900 text-purple-300',
};

const STATE_COLORS: Record<string, string> = {
  enter: 'text-cyan-400',
  exit: 'text-orange-400',
};

const MAX_DISPLAY_EVENTS = 100;

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp / 1000000);
  return date.toLocaleTimeString() + '.' + String(Math.floor((timestamp % 1000000000) / 1000)).padStart(6, '0');
};

const EventItem = React.memo<{ event: SyscallEvent }>(({ event }) => {
  return (
    <div className="flex items-center gap-3 py-1 px-2 hover:bg-gray-800 rounded border-b border-gray-800">
      <span className="text-gray-500 text-xs w-20 flex-shrink-0">
        {formatTime(event.timestamp)}
      </span>
      <span className="text-gray-400 text-xs w-16 flex-shrink-0">
        PID: {event.tgid}
      </span>
      <span className={`px-2 py-0.5 rounded text-xs font-bold ${SYS_CALL_COLORS[event.syscall] || 'bg-gray-700 text-gray-300'}`}>
        {event.syscall.toUpperCase()}
      </span>
      <span className={`font-bold ${STATE_COLORS[event.state] || 'text-gray-400'}`}>
        {event.state.toUpperCase()}
      </span>
      {event.filename && (
        <span className="text-purple-400 text-xs truncate max-w-xs">
          {event.filename}
        </span>
      )}
      {event.count > 0 && (
        <span className="text-cyan-400 text-xs">
          count: {event.count}
        </span>
      )}
      {event.state === 'exit' && (
        <span className={`text-xs ${event.retval < 0 ? 'text-red-400' : 'text-green-400'}`}>
          ret: {event.retval}
        </span>
      )}
    </div>
  );
});

EventItem.displayName = 'EventItem';

export const EventLog: React.FC<EventLogProps> = React.memo(({ events, onClear }) => {
  const displayEvents = useMemo(() => {
    return events.slice(-MAX_DISPLAY_EVENTS).reverse();
  }, [events]);

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-white text-lg font-semibold">事件日志 ({events.length})</h3>
        <button
          onClick={onClear}
          className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
        >
          清空
        </button>
      </div>
      <div className="overflow-x-auto">
        <div className="max-h-80 overflow-y-auto font-mono text-sm">
          {displayEvents.map((event, index) => (
            <EventItem
              key={`${event.timestamp}-${events.length - index}`}
              event={event}
            />
          ))}
          {events.length === 0 && (
            <div className="text-gray-500 text-center py-8">
              暂无事件，等待系统调用...
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

EventLog.displayName = 'EventLog';
