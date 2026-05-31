import { createMachine, assign, ActorRefFrom } from 'xstate';
import type { SyscallEvent, ProcessState, SyscallState, SuspiciousAlert } from './types';

export interface Context {
  processes: Map<number, ProcessState>;
  eventLog: SyscallEvent[];
  alerts: SuspiciousAlert[];
  maxLogSize: number;
  maxAlertsSize: number;
  pendingOpens: Map<number, { timestamp: number; filename: string }>;
  pendingReads: Map<number, { timestamp: number; count: number }>;
  pendingWrites: Map<number, { timestamp: number; count: number }>;
  pendingExecves: Map<number, { timestamp: number; filename: string }>;
  hasActiveAlert: boolean;
  stoppedPids: Set<number>;
}

export type Events =
  | { type: 'SYSCALLS_RECEIVED'; events: SyscallEvent[] }
  | { type: 'SYSCALL_RECEIVED'; event: SyscallEvent }
  | { type: 'ALERT_RECEIVED'; alert: SuspiciousAlert }
  | { type: 'CLEAR_LOG' }
  | { type: 'CLEAR_ALERTS' }
  | { type: 'DISMISS_ALERT' }
  | { type: 'ADD_PROCESS'; pid: number; comm: string }
  | { type: 'REMOVE_PROCESS'; pid: number }
  | { type: 'PROCESS_STOPPED'; pid: number }
  | { type: 'PROCESS_RESUMED'; pid: number };

const initialProcessStats = {
  openCount: 0,
  readCount: 0,
  writeCount: 0,
  execveCount: 0,
  totalBytesRead: 0,
  totalBytesWritten: 0,
  errors: 0,
  alerts: 0,
};

function createInitialProcessState(pid: number, comm: string, isStopped: boolean = false): ProcessState {
  return {
    pid,
    comm,
    states: [],
    stats: { ...initialProcessStats },
    lastActivity: Date.now(),
    isStopped,
  };
}

function processSingleEvent(context: Context, syscallEvent: SyscallEvent) {
  const { pid, tgid, syscall, state, timestamp, filename, count, retval, comm } = syscallEvent;
  const processPid = tgid || pid;

  if (!context.processes.has(processPid)) {
    context.processes.set(processPid, createInitialProcessState(processPid, comm, context.stoppedPids.has(processPid)));
  }

  const process = context.processes.get(processPid)!;
  const newProcess = {
    ...process,
    comm: comm || process.comm,
    lastActivity: timestamp,
    stats: { ...process.stats },
    states: [...process.states],
    isStopped: context.stoppedPids.has(processPid),
  };

  const syscallState: SyscallState = {
    syscall,
    state,
    timestamp,
  };

  const pendingKey = processPid;

  if (state === 'enter') {
    if (syscall === 'open') {
      syscallState.filename = filename;
      context.pendingOpens.set(pendingKey, { timestamp, filename });
    } else if (syscall === 'read') {
      syscallState.count = count;
      context.pendingReads.set(pendingKey, { timestamp, count });
    } else if (syscall === 'write') {
      syscallState.count = count;
      context.pendingWrites.set(pendingKey, { timestamp, count });
    } else if (syscall === 'execve') {
      syscallState.filename = filename;
      context.pendingExecves.set(pendingKey, { timestamp, filename });
    }
  } else if (state === 'exit') {
    syscallState.retval = retval;

    if (syscall === 'open') {
      const pending = context.pendingOpens.get(pendingKey);
      if (pending) {
        syscallState.duration = timestamp - pending.timestamp;
        syscallState.filename = pending.filename;
        context.pendingOpens.delete(pendingKey);
      }
      newProcess.stats.openCount++;
      if (retval < 0) newProcess.stats.errors++;
    } else if (syscall === 'read') {
      const pending = context.pendingReads.get(pendingKey);
      if (pending) {
        syscallState.duration = timestamp - pending.timestamp;
        syscallState.count = pending.count;
        context.pendingReads.delete(pendingKey);
      }
      newProcess.stats.readCount++;
      if (retval >= 0) newProcess.stats.totalBytesRead += retval;
      else newProcess.stats.errors++;
    } else if (syscall === 'write') {
      const pending = context.pendingWrites.get(pendingKey);
      if (pending) {
        syscallState.duration = timestamp - pending.timestamp;
        syscallState.count = pending.count;
        context.pendingWrites.delete(pendingKey);
      }
      newProcess.stats.writeCount++;
      if (retval >= 0) newProcess.stats.totalBytesWritten += retval;
      else newProcess.stats.errors++;
    } else if (syscall === 'execve') {
      const pending = context.pendingExecves.get(pendingKey);
      if (pending) {
        syscallState.duration = timestamp - pending.timestamp;
        syscallState.filename = pending.filename;
        context.pendingExecves.delete(pendingKey);
      }
      newProcess.stats.execveCount++;
    }
  }

  newProcess.states = [...newProcess.states, syscallState].slice(-100);
  context.processes.set(processPid, newProcess);
}

function createMutableContext(context: Context): Context {
  return {
    ...context,
    processes: new Map(context.processes),
    pendingOpens: new Map(context.pendingOpens),
    pendingReads: new Map(context.pendingReads),
    pendingWrites: new Map(context.pendingWrites),
    pendingExecves: new Map(context.pendingExecves),
    stoppedPids: new Set(context.stoppedPids),
  };
}

export const syscallMachine = createMachine({
  id: 'syscallMonitor',
  initial: 'idle',
  context: {
    processes: new Map(),
    eventLog: [],
    alerts: [],
    maxLogSize: 1000,
    maxAlertsSize: 100,
    pendingOpens: new Map(),
    pendingReads: new Map(),
    pendingWrites: new Map(),
    pendingExecves: new Map(),
    hasActiveAlert: false,
    stoppedPids: new Set(),
  } as Context,
  states: {
    idle: {
      on: {
        SYSCALL_RECEIVED: { actions: 'processSingleSyscallEvent', target: 'monitoring' },
        SYSCALLS_RECEIVED: { actions: 'processBatchSyscallEvents', target: 'monitoring' },
        ALERT_RECEIVED: { actions: 'processAlert', target: 'alerting' },
        ADD_PROCESS: { actions: 'addProcess' },
        REMOVE_PROCESS: { actions: 'removeProcess' },
        PROCESS_STOPPED: { actions: 'markProcessStopped' },
        PROCESS_RESUMED: { actions: 'markProcessResumed' },
      },
    },
    monitoring: {
      on: {
        SYSCALL_RECEIVED: { actions: 'processSingleSyscallEvent' },
        SYSCALLS_RECEIVED: { actions: 'processBatchSyscallEvents' },
        ALERT_RECEIVED: { actions: 'processAlert', target: 'alerting' },
        ADD_PROCESS: { actions: 'addProcess' },
        REMOVE_PROCESS: { actions: 'removeProcess' },
        CLEAR_LOG: { actions: 'clearLog' },
        PROCESS_STOPPED: { actions: 'markProcessStopped' },
        PROCESS_RESUMED: { actions: 'markProcessResumed' },
      },
    },
    alerting: {
      on: {
        SYSCALL_RECEIVED: { actions: 'processSingleSyscallEvent' },
        SYSCALLS_RECEIVED: { actions: 'processBatchSyscallEvents' },
        ALERT_RECEIVED: { actions: 'processAlert' },
        DISMISS_ALERT: { actions: 'dismissAlert', target: 'monitoring' },
        CLEAR_ALERTS: { actions: 'clearAlerts', target: 'monitoring' },
        ADD_PROCESS: { actions: 'addProcess' },
        REMOVE_PROCESS: { actions: 'removeProcess' },
        CLEAR_LOG: { actions: 'clearLog' },
        PROCESS_STOPPED: { actions: 'markProcessStopped' },
        PROCESS_RESUMED: { actions: 'markProcessResumed' },
      },
    },
  },
}, {
  actions: {
    addProcess: assign({
      processes: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'ADD_PROCESS' }>;
        const newProcesses = new Map(context.processes);
        if (!newProcesses.has(ev.pid)) {
          newProcesses.set(ev.pid, createInitialProcessState(ev.pid, ev.comm, context.stoppedPids.has(ev.pid)));
        }
        return newProcesses;
      },
    }),

    removeProcess: assign({
      processes: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'REMOVE_PROCESS' }>;
        const newProcesses = new Map(context.processes);
        newProcesses.delete(ev.pid);
        return newProcesses;
      },
      stoppedPids: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'REMOVE_PROCESS' }>;
        const newStoppedPids = new Set(context.stoppedPids);
        newStoppedPids.delete(ev.pid);
        return newStoppedPids;
      },
    }),

    markProcessStopped: assign({
      stoppedPids: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'PROCESS_STOPPED' }>;
        const newStoppedPids = new Set(context.stoppedPids);
        newStoppedPids.add(ev.pid);
        return newStoppedPids;
      },
      processes: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'PROCESS_STOPPED' }>;
        const newProcesses = new Map(context.processes);
        const process = newProcesses.get(ev.pid);
        if (process) {
          newProcesses.set(ev.pid, { ...process, isStopped: true });
        }
        return newProcesses;
      },
    }),

    markProcessResumed: assign({
      stoppedPids: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'PROCESS_RESUMED' }>;
        const newStoppedPids = new Set(context.stoppedPids);
        newStoppedPids.delete(ev.pid);
        return newStoppedPids;
      },
      processes: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'PROCESS_RESUMED' }>;
        const newProcesses = new Map(context.processes);
        const process = newProcesses.get(ev.pid);
        if (process) {
          newProcesses.set(ev.pid, { ...process, isStopped: false });
        }
        return newProcesses;
      },
    }),

    clearLog: assign({
      eventLog: () => [],
    }),

    clearAlerts: assign({
      alerts: () => [],
      hasActiveAlert: () => false,
    }),

    dismissAlert: assign({
      hasActiveAlert: () => false,
    }),

    processAlert: assign({
      alerts: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'ALERT_RECEIVED' }>;
        const newAlerts = [ev.alert, ...context.alerts];
        return newAlerts.length > context.maxAlertsSize ? newAlerts.slice(0, context.maxAlertsSize) : newAlerts;
      },
      hasActiveAlert: () => true,
      processes: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'ALERT_RECEIVED' }>;
        const newProcesses = new Map(context.processes);
        const alert = ev.alert;
        const process = newProcesses.get(alert.pid);
        if (process) {
          newProcesses.set(alert.pid, {
            ...process,
            stats: { ...process.stats, alerts: process.stats.alerts + 1 },
            isStopped: alert.stopped,
          });
        } else {
          newProcesses.set(alert.pid, createInitialProcessState(alert.pid, alert.comm, alert.stopped));
        }
        return newProcesses;
      },
      stoppedPids: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'ALERT_RECEIVED' }>;
        if (ev.alert.stopped) {
          const newStoppedPids = new Set(context.stoppedPids);
          newStoppedPids.add(ev.alert.pid);
          return newStoppedPids;
        }
        return context.stoppedPids;
      },
    }),

    processSingleSyscallEvent: assign({
      eventLog: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'SYSCALL_RECEIVED' }>;
        const newLog = [...context.eventLog, ev.event];
        return newLog.length > context.maxLogSize ? newLog.slice(-context.maxLogSize) : newLog;
      },
      processes: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'SYSCALL_RECEIVED' }>;
        const mutableContext = createMutableContext(context as Context);
        processSingleEvent(mutableContext, ev.event);
        return mutableContext.processes;
      },
      pendingOpens: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'SYSCALL_RECEIVED' }>;
        const mutableContext = createMutableContext(context as Context);
        processSingleEvent(mutableContext, ev.event);
        return mutableContext.pendingOpens;
      },
      pendingReads: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'SYSCALL_RECEIVED' }>;
        const mutableContext = createMutableContext(context as Context);
        processSingleEvent(mutableContext, ev.event);
        return mutableContext.pendingReads;
      },
      pendingWrites: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'SYSCALL_RECEIVED' }>;
        const mutableContext = createMutableContext(context as Context);
        processSingleEvent(mutableContext, ev.event);
        return mutableContext.pendingWrites;
      },
      pendingExecves: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'SYSCALL_RECEIVED' }>;
        const mutableContext = createMutableContext(context as Context);
        processSingleEvent(mutableContext, ev.event);
        return mutableContext.pendingExecves;
      },
    }),

    processBatchSyscallEvents: assign({
      eventLog: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'SYSCALLS_RECEIVED' }>;
        const newLog = [...context.eventLog, ...ev.events];
        return newLog.length > context.maxLogSize ? newLog.slice(-context.maxLogSize) : newLog;
      },
      processes: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'SYSCALLS_RECEIVED' }>;
        const mutableContext = createMutableContext(context as Context);
        for (const syscallEvent of ev.events) {
          processSingleEvent(mutableContext, syscallEvent);
        }
        return mutableContext.processes;
      },
      pendingOpens: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'SYSCALLS_RECEIVED' }>;
        const mutableContext = createMutableContext(context as Context);
        for (const syscallEvent of ev.events) {
          processSingleEvent(mutableContext, syscallEvent);
        }
        return mutableContext.pendingOpens;
      },
      pendingReads: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'SYSCALLS_RECEIVED' }>;
        const mutableContext = createMutableContext(context as Context);
        for (const syscallEvent of ev.events) {
          processSingleEvent(mutableContext, syscallEvent);
        }
        return mutableContext.pendingReads;
      },
      pendingWrites: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'SYSCALLS_RECEIVED' }>;
        const mutableContext = createMutableContext(context as Context);
        for (const syscallEvent of ev.events) {
          processSingleEvent(mutableContext, syscallEvent);
        }
        return mutableContext.pendingWrites;
      },
      pendingExecves: ({ context, event }) => {
        const ev = event as Extract<Events, { type: 'SYSCALLS_RECEIVED' }>;
        const mutableContext = createMutableContext(context as Context);
        for (const syscallEvent of ev.events) {
          processSingleEvent(mutableContext, syscallEvent);
        }
        return mutableContext.pendingExecves;
      },
    }),
  },
});

export type SyscallActor = ActorRefFrom<typeof syscallMachine>;
