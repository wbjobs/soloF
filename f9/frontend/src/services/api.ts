import { VWAPParams, BacktestTask, BacktestResult } from '../types';

const API_BASE = '/api';

export const api = {
  async uploadCSV(file: File): Promise<{ success: boolean; symbols: string[]; total_ticks: number }> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/replay/upload`, {
      method: 'POST',
      body: formData,
    });
    return response.json();
  },

  async getSymbols(): Promise<string[]> {
    const response = await fetch(`${API_BASE}/replay/symbols`);
    return response.json();
  },

  async submitVWAPBacktest(params: VWAPParams): Promise<BacktestTask> {
    const response = await fetch(`${API_BASE}/strategy/vwap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return response.json();
  },

  async getBacktestList(): Promise<BacktestTask[]> {
    const response = await fetch(`${API_BASE}/backtest/list`);
    return response.json();
  },

  async getBacktestResult(taskId: string): Promise<BacktestResult> {
    const response = await fetch(`${API_BASE}/backtest/${taskId}`);
    return response.json();
  },

  async getBacktestStatus(taskId: string): Promise<{ status: string; progress: number }> {
    const response = await fetch(`${API_BASE}/backtest/${taskId}/status`);
    return response.json();
  },
};

export const createWebSocket = (
  symbol: string,
  onMessage: (type: string, data: any) => void
): WebSocket => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/api/replay/ws?symbol=${symbol}`);

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    onMessage(message.type, message.data);
  };

  return ws;
};
