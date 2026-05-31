import { create } from 'zustand';
import { TickData, OrderBook, ReplayState } from '../types';

interface ReplayStore extends ReplayState {
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  setCurrentTime: (time: number) => void;
  setTimeRange: (start: number, end: number) => void;
  setCurrentTick: (tick: TickData | null) => void;
  setOrderBook: (orderBook: OrderBook | null) => void;
  addTrade: (trade: TickData) => void;
  reset: () => void;
}

const initialState: ReplayState = {
  isPlaying: false,
  speed: 1,
  currentTime: 0,
  startTime: 0,
  endTime: 0,
  currentTick: null,
  orderBook: null,
  trades: [],
};

export const useReplayStore = create<ReplayStore>((set) => ({
  ...initialState,
  setPlaying: (playing) => set({ isPlaying: playing }),
  setSpeed: (speed) => set({ speed }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setTimeRange: (start, end) => set({ startTime: start, endTime: end, currentTime: start }),
  setCurrentTick: (tick) => set({ currentTick: tick }),
  setOrderBook: (orderBook) => set({ orderBook }),
  addTrade: (trade) => set((state) => ({
    trades: [...state.trades.slice(-99), trade],
  })),
  reset: () => set(initialState),
}));
