import { useEffect, useRef, useCallback, useState } from 'react';
import type { SyscallEvent, WebSocketMessage } from './types';

interface UseWebSocketOptions {
  url: string;
  onMessage?: (message: WebSocketMessage) => void;
  onSyscallEvent?: (event: SyscallEvent) => void;
}

export function useWebSocket({ url, onMessage, onSyscallEvent }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        console.log('WebSocket connected');
      };

      ws.onclose = () => {
        setIsConnected(false);
        console.log('WebSocket disconnected');
        scheduleReconnect();
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onmessage = (event) => {
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          onMessage?.(data);
          if (data.type === 'syscall_event' && data.data) {
            onSyscallEvent?.(data.data);
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      scheduleReconnect();
    }
  }, [url, onMessage, onSyscallEvent]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
    }
    reconnectTimeoutRef.current = window.setTimeout(() => {
      connect();
    }, 3000);
  }, [connect]);

  const send = useCallback((message: object) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  const addPid = useCallback((pid: number) => {
    return send({ type: 'add_pid', pid });
  }, [send]);

  const removePid = useCallback((pid: number) => {
    return send({ type: 'remove_pid', pid });
  }, [send]);

  const listPids = useCallback(() => {
    return send({ type: 'list_pids' });
  }, [send]);

  const resumePid = useCallback((pid: number) => {
    return send({ type: 'resume_pid', pid });
  }, [send]);

  const stopPid = useCallback((pid: number) => {
    return send({ type: 'stop_pid', pid });
  }, [send]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    isConnected,
    send,
    addPid,
    removePid,
    listPids,
    resumePid,
    stopPid,
  };
}
