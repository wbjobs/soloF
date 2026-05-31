import pandas as pd
import numpy as np
import time
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
import asyncio

@dataclass
class TickData:
    timestamp: int
    symbol: str
    price: float
    volume: int
    amount: float
    bs_flag: str

@dataclass
class OrderBookLevel:
    price: float
    volume: int
    amount: float = 0.0

@dataclass
class OrderBook:
    timestamp: int
    symbol: str
    asks: List[OrderBookLevel]
    bids: List[OrderBookLevel]

class ReplayEngine:
    def __init__(self, data_path: str = "../data/sample_ticks.csv"):
        self.data_path = data_path
        self.df: Optional[pd.DataFrame] = None
        self.symbols: List[str] = []
        self.symbol_data: Dict[str, pd.DataFrame] = {}
        self.order_books: Dict[str, Dict] = {}
        self._load_data()

    def _load_data(self):
        try:
            self.df = pd.read_csv(self.data_path)
            self.df['timestamp'] = pd.to_datetime(self.df['timestamp']).astype('int64') // 10**6
            self.symbols = self.df['symbol'].unique().tolist()
            
            for symbol in self.symbols:
                symbol_df = self.df[self.df['symbol'] == symbol].sort_values('timestamp').reset_index(drop=True)
                self.symbol_data[symbol] = symbol_df
                
                base_price = symbol_df['price'].iloc[0]
                self._init_order_book(symbol, base_price)
                
        except Exception as e:
            print(f"加载数据失败: {e}")
            self._generate_sample_data()

    def _generate_sample_data(self):
        print("生成示例数据...")
        np.random.seed(42)
        
        symbols = ['600519.SH', '000001.SZ', '300750.SZ', '601318.SH', '000858.SZ']
        all_data = []
        
        start_time = pd.Timestamp.now().replace(hour=9, minute=30, second=0, microsecond=0)
        
        for symbol in symbols:
            base_price = {
                '600519.SH': 1800.0,
                '000001.SZ': 12.5,
                '300750.SZ': 220.0,
                '601318.SH': 45.0,
                '000858.SZ': 160.0,
            }[symbol]
            
            current_price = base_price
            n_ticks = np.random.randint(50000, 100000)
            
            timestamps = pd.date_range(start=start_time, periods=n_ticks, freq='50L')
            
            for i, ts in enumerate(timestamps):
                price_change = np.random.randn() * 0.001
                current_price *= (1 + price_change)
                current_price = round(current_price, 2)
                
                volume = np.random.randint(10, 5000)
                amount = current_price * volume
                bs_flag = 'B' if np.random.random() > 0.5 else 'S'
                
                all_data.append({
                    'timestamp': ts,
                    'symbol': symbol,
                    'price': current_price,
                    'volume': volume,
                    'amount': amount,
                    'bs_flag': bs_flag
                })
        
        self.df = pd.DataFrame(all_data)
        self.df['timestamp'] = self.df['timestamp'].astype('int64') // 10**6
        self.symbols = symbols
        
        for symbol in self.symbols:
            symbol_df = self.df[self.df['symbol'] == symbol].sort_values('timestamp').reset_index(drop=True)
            self.symbol_data[symbol] = symbol_df
            base_price = symbol_df['price'].iloc[0]
            self._init_order_book(symbol, base_price)

    def _init_order_book(self, symbol: str, base_price: float):
        asks = []
        bids = []
        
        for i in range(1, 11):
            ask_price = round(base_price + i * 0.01, 2)
            ask_volume = np.random.randint(1000, 10000)
            asks.append(OrderBookLevel(price=ask_price, volume=ask_volume, amount=ask_price * ask_volume))
            
            bid_price = round(base_price - i * 0.01, 2)
            bid_volume = np.random.randint(1000, 10000)
            bids.append(OrderBookLevel(price=bid_price, volume=bid_volume, amount=bid_price * bid_volume))
        
        self.order_books[symbol] = {
            'asks': asks,
            'bids': bids,
            'last_update': 0
        }

    def _update_order_book(self, symbol: str, price: float, volume: int, bs_flag: str, timestamp: int):
        ob = self.order_books[symbol]
        
        if bs_flag == 'B':
            for i, bid in enumerate(ob['bids']):
                if abs(bid.price - price) < 0.02:
                    bid.volume = max(0, bid.volume - volume)
                    bid.amount = bid.price * bid.volume
                    break
        else:
            for i, ask in enumerate(ob['asks']):
                if abs(ask.price - price) < 0.02:
                    ask.volume = max(0, ask.volume - volume)
                    ask.amount = ask.price * ask.volume
                    break
        
        for i in range(len(ob['asks'])):
            if ob['asks'][i].volume < 500:
                ob['asks'][i].volume = np.random.randint(1000, 10000)
                ob['asks'][i].amount = ob['asks'][i].price * ob['asks'][i].volume
        
        for i in range(len(ob['bids'])):
            if ob['bids'][i].volume < 500:
                ob['bids'][i].volume = np.random.randint(1000, 10000)
                ob['bids'][i].amount = ob['bids'][i].price * ob['bids'][i].volume
        
        ob['last_update'] = timestamp

    def get_symbols(self) -> List[str]:
        return self.symbols

    def get_time_range(self, symbol: str) -> Tuple[int, int]:
        if symbol not in self.symbol_data:
            return 0, 0
        df = self.symbol_data[symbol]
        return int(df['timestamp'].iloc[0]), int(df['timestamp'].iloc[-1])

    def get_tick_at(self, symbol: str, timestamp: int) -> Optional[TickData]:
        if symbol not in self.symbol_data:
            return None
        
        df = self.symbol_data[symbol]
        idx = df['timestamp'].searchsorted(timestamp)
        if idx >= len(df):
            idx = len(df) - 1
        
        row = df.iloc[idx]
        return TickData(
            timestamp=int(row['timestamp']),
            symbol=row['symbol'],
            price=float(row['price']),
            volume=int(row['volume']),
            amount=float(row['amount']),
            bs_flag=row['bs_flag']
        )

    def get_order_book(self, symbol: str, timestamp: int, tick: TickData) -> OrderBook:
        if symbol not in self.order_books:
            self._init_order_book(symbol, tick.price)
        
        self._update_order_book(symbol, tick.price, tick.volume, tick.bs_flag, timestamp)
        
        ob = self.order_books[symbol]
        return OrderBook(
            timestamp=timestamp,
            symbol=symbol,
            asks=[{'price': a.price, 'volume': a.volume, 'amount': a.amount} for a in ob['asks']],
            bids=[{'price': b.price, 'volume': b.volume, 'amount': b.amount} for b in ob['bids']]
        )

    def get_symbol_data(self, symbol: str) -> pd.DataFrame:
        return self.symbol_data.get(symbol, pd.DataFrame())

replay_engine = ReplayEngine()
