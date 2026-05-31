export interface TickData {
  timestamp: number;
  symbol: string;
  price: number;
  volume: number;
  amount: number;
  bs_flag: 'B' | 'S';
}

export interface OrderBookLevel {
  price: number;
  volume: number;
  amount?: number;
}

export interface OrderBook {
  timestamp: number;
  symbol: string;
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
}

export interface VWAPParams {
  symbol: string;
  total_volume: number;
  start_time: string;
  end_time: string;
  participation_rate: number;
  min_order_size: number;
  max_order_size: number;
}

export interface BacktestTask {
  task_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  strategy: string;
  params: VWAPParams;
  progress: number;
  created_at: string;
  completed_at?: string;
  error_message?: string;
}

export interface BacktestTrade {
  timestamp: number;
  price: number;
  volume: number;
  slippage: number;
  side: 'buy' | 'sell';
  commission?: number;
}

export interface BacktestMetrics {
  total_pnl: number;
  total_commission: number;
  avg_slippage: number;
  max_slippage: number;
  win_rate: number;
  sharpe_ratio: number;
  max_drawdown: number;
  total_trades: number;
  total_impact_cost?: number;
  large_order_count?: number;
  large_order_total_volume?: number;
  avg_large_order_slippage_bps?: number;
  max_large_order_slippage_bps?: number;
}

export interface ImpactAnalysis {
  timestamp: number;
  order_size: number;
  market_price: number;
  execution_price: number;
  bid_depth: number;
  ask_depth: number;
  temp_impact_bps: number;
  perm_impact_bps: number;
  total_impact_cost: number;
  slippage_bps: number;
}

export interface BacktestResult {
  task_id: string;
  pnl_curve: Array<{ timestamp: number; pnl: number; cumulative_pnl: number }>;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  impact_analysis: ImpactAnalysis[];
}

export interface WsMessage {
  type: 'tick' | 'orderbook' | 'trade';
  data: TickData | OrderBook | any;
}

export interface WsControl {
  action: 'play' | 'pause' | 'seek' | 'speed';
  payload?: {
    speed?: number;
    timestamp?: number;
  };
}

export interface ReplayState {
  isPlaying: boolean;
  speed: number;
  currentTime: number;
  startTime: number;
  endTime: number;
  currentTick: TickData | null;
  orderBook: OrderBook | null;
  trades: TickData[];
}
