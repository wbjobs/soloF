export type SyscallType = 'open' | 'read' | 'write' | 'execve';
export type EventState = 'enter' | 'exit';

export interface SyscallEvent {
  pid: number;
  tgid: number;
  timestamp: number;
  syscall: SyscallType;
  state: EventState;
  retval: number;
  comm: string;
  filename: string;
  count: number;
}

export interface SuspiciousAlert {
  pid: number;
  comm: string;
  syscall: string;
  filename: string;
  reason: string;
  timestamp: number;
  stopped: boolean;
}

export interface SyscallState {
  syscall: SyscallType;
  state: EventState;
  timestamp: number;
  duration?: number;
  filename?: string;
  count?: number;
  retval?: number;
}

export interface ProcessState {
  pid: number;
  comm: string;
  states: SyscallState[];
  stats: {
    openCount: number;
    readCount: number;
    writeCount: number;
    execveCount: number;
    totalBytesRead: number;
    totalBytesWritten: number;
    errors: number;
    alerts: number;
  };
  lastActivity: number;
  isStopped: boolean;
}

export interface WebSocketMessage {
  type: 'syscall_event' | 'pid_added' | 'pid_removed' | 'pid_list' | 'suspicious_alert' | 'pid_resumed' | 'pid_stopped';
  data?: SyscallEvent;
  alert?: SuspiciousAlert;
  pid?: number;
  success?: boolean;
  pids?: number[];
  stopped_pids?: number[];
}
