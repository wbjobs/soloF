import pandas as pd
import numpy as np
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engines.replay import replay_engine

@dataclass
class MarketImpactAnalysis:
    order_size: int
    bid_depth: float
    ask_depth: float
    temp_impact_bps: float
    perm_impact_bps: float
    total_impact_cost: float
    expected_slippage_bps: float

@dataclass
class VWAPTrade:
    timestamp: int
    price: float
    volume: int
    slippage: float
    side: str
    impact_analysis: Optional[MarketImpactAnalysis] = None
    is_large_order: bool = False

@dataclass
class VWAPResult:
    pnl_curve: List[Dict[str, Any]]
    trades: List[VWAPTrade]
    metrics: Dict[str, Any]
    impact_analysis: List[Dict[str, Any]]

class MarketImpactModel:
    def __init__(self, price_decimals: int = 2):
        self.price_decimals = price_decimals
        self.temp_impact_coeff = 0.1
        self.perm_impact_coeff = 0.05
        
    def simulate_order_book_depth(self, base_price: float, timestamp: int) -> Dict[str, float]:
        price_volatility = 0.002
        seed = int(timestamp / 1000) % 10000
        np.random.seed(seed)
        
        base_depth = 5000
        bid_depth = base_depth * (0.8 + 0.4 * np.random.random())
        ask_depth = base_depth * (0.8 + 0.4 * np.random.random())
        
        return {
            'bid_1_vol': bid_depth * 0.3,
            'bid_2_vol': bid_depth * 0.25,
            'bid_3_vol': bid_depth * 0.2,
            'bid_4_vol': bid_depth * 0.15,
            'bid_5_vol': bid_depth * 0.1,
            'ask_1_vol': ask_depth * 0.3,
            'ask_2_vol': ask_depth * 0.25,
            'ask_3_vol': ask_depth * 0.2,
            'ask_4_vol': ask_depth * 0.15,
            'ask_5_vol': ask_depth * 0.1,
            'total_bid': bid_depth,
            'total_ask': ask_depth
        }
    
    def calculate_impact(self, order_size: int, side: str, 
                        base_price: float, timestamp: int,
                        market_volume_24h: float = 1000000) -> MarketImpactAnalysis:
        depth = self.simulate_order_book_depth(base_price, timestamp)
        
        total_depth = depth['total_bid'] if side == 'buy' else depth['total_ask']
        top_level_depth = depth['bid_1_vol'] if side == 'buy' else depth['ask_1_vol']
        
        depth_ratio = order_size / max(top_level_depth, 1)
        market_ratio = order_size / max(market_volume_24h / 1440, 1)
        
        temp_impact_bps = self.temp_impact_coeff * np.sqrt(depth_ratio) * 100
        perm_impact_bps = self.perm_impact_coeff * market_ratio * 100
        
        if order_size > 1000:
            large_order_premium = (order_size / 1000 - 1) * 5
            temp_impact_bps += large_order_premium
            perm_impact_bps += large_order_premium * 0.3
        
        total_impact_bps = temp_impact_bps + perm_impact_bps
        total_impact_cost = base_price * (total_impact_bps / 10000) * order_size * 100
        
        return MarketImpactAnalysis(
            order_size=order_size,
            bid_depth=depth['total_bid'],
            ask_depth=depth['total_ask'],
            temp_impact_bps=temp_impact_bps,
            perm_impact_bps=perm_impact_bps,
            total_impact_cost=total_impact_cost,
            expected_slippage_bps=total_impact_bps
        )

class VWAPStrategy:
    def __init__(self, symbol: str, total_volume: int, participation_rate: float = 0.1,
                 min_order_size: int = 100, max_order_size: int = 5000):
        self.symbol = symbol
        self.total_volume = total_volume
        self.participation_rate = participation_rate
        self.min_order_size = min_order_size
        self.max_order_size = max_order_size
        
        self.remaining_volume = total_volume
        self.trades: List[VWAPTrade] = []
        self.pnl_curve: List[Dict[str, Any]] = []
        self.impact_analysis_history: List[Dict[str, Any]] = []
        self.cumulative_pnl = 0.0
        self.cumulative_impact_cost = 0.0
        
        self.df = replay_engine.get_symbol_data(symbol)
        self.market_vwap = self._calculate_market_vwap()
        self.impact_model = MarketImpactModel()
        
    def _calculate_market_vwap(self) -> float:
        if len(self.df) == 0:
            return 0.0
        total_amt = (self.df['price'] * self.df['volume']).sum()
        total_vol = self.df['volume'].sum()
        return total_amt / total_vol if total_vol > 0 else 0.0

    def run(self, progress_callback=None) -> VWAPResult:
        if len(self.df) == 0:
            return self._build_result()

        total_ticks = len(self.df)
        market_volume_cumsum = self.df['volume'].cumsum()
        total_market_volume = market_volume_cumsum.iloc[-1]
        
        target_volume_at_time = total_market_volume * self.participation_rate
        volume_per_tick = target_volume_at_time / total_ticks
        
        executed_volume = 0
        vwap_price = 0.0
        vwap_volume = 0
        
        for idx, (_, row) in enumerate(self.df.iterrows()):
            if self.remaining_volume <= 0:
                break
            
            if progress_callback and idx % 1000 == 0:
                progress_callback(idx / total_ticks)
            
            market_price = row['price']
            target_for_this_period = volume_per_tick * (idx + 1)
            volume_to_trade = int(max(
                self.min_order_size,
                min(self.max_order_size, target_for_this_period - executed_volume)
            ))
            volume_to_trade = min(volume_to_trade, self.remaining_volume)
            
            if volume_to_trade >= self.min_order_size:
                impact_analysis = self.impact_model.calculate_impact(
                    order_size=volume_to_trade,
                    side='buy',
                    base_price=market_price,
                    timestamp=int(row['timestamp']),
                    market_volume_24h=total_market_volume * 4
                )
                
                base_slippage = np.random.normal(2, 5) / 10000
                impact_slippage = impact_analysis.expected_slippage_bps / 10000
                total_slippage = base_slippage + impact_slippage
                total_slippage = max(-0.002, min(0.01, total_slippage))
                
                execution_price = market_price * (1 + total_slippage)
                
                is_large_order = volume_to_trade > 1000
                
                trade = VWAPTrade(
                    timestamp=int(row['timestamp']),
                    price=round(execution_price, 2),
                    volume=volume_to_trade,
                    slippage=total_slippage,
                    side='buy',
                    impact_analysis=impact_analysis,
                    is_large_order=is_large_order
                )
                self.trades.append(trade)
                
                self.cumulative_impact_cost += impact_analysis.total_impact_cost
                
                if is_large_order:
                    self.impact_analysis_history.append({
                        'timestamp': int(row['timestamp']),
                        'order_size': volume_to_trade,
                        'market_price': market_price,
                        'execution_price': round(execution_price, 2),
                        'bid_depth': impact_analysis.bid_depth,
                        'ask_depth': impact_analysis.ask_depth,
                        'temp_impact_bps': impact_analysis.temp_impact_bps,
                        'perm_impact_bps': impact_analysis.perm_impact_bps,
                        'total_impact_cost': impact_analysis.total_impact_cost,
                        'slippage_bps': total_slippage * 10000
                    })
                
                executed_volume += volume_to_trade
                self.remaining_volume -= volume_to_trade
                
                vwap_price = (vwap_price * vwap_volume + execution_price * volume_to_trade) / (vwap_volume + volume_to_trade)
                vwap_volume += volume_to_trade
                
                pnl = (market_price - execution_price) * volume_to_trade
                self.cumulative_pnl += pnl
                
                self.pnl_curve.append({
                    'timestamp': int(row['timestamp']),
                    'pnl': pnl,
                    'cumulative_pnl': self.cumulative_pnl,
                    'impact_cost': impact_analysis.total_impact_cost if is_large_order else 0
                })
        
        if progress_callback:
            progress_callback(1.0)
            
        return self._build_result()

    def _build_result(self) -> VWAPResult:
        if not self.trades:
            return VWAPResult(pnl_curve=[], trades=[], metrics={}, impact_analysis=[])
        
        total_commission = sum(t.price * t.volume * 0.0001 for t in self.trades)
        
        pnls = [p['pnl'] for p in self.pnl_curve]
        wins = len([p for p in pnls if p > 0])
        win_rate = wins / len(pnls) if pnls else 0
        
        slippages = [t.slippage for t in self.trades]
        avg_slippage = np.mean(slippages)
        max_slippage = np.max(slippages)
        
        large_order_trades = [t for t in self.trades if t.is_large_order]
        large_order_count = len(large_order_trades)
        
        if large_order_trades:
            large_order_slippages = [t.slippage for t in large_order_trades]
            avg_large_order_slippage = np.mean(large_order_slippages)
            max_large_order_slippage = np.max(large_order_slippages)
            total_large_order_volume = sum(t.volume for t in large_order_trades)
        else:
            avg_large_order_slippage = 0.0
            max_large_order_slippage = 0.0
            total_large_order_volume = 0
        
        cumulative = [p['cumulative_pnl'] for p in self.pnl_curve]
        if cumulative:
            running_max = np.maximum.accumulate(cumulative)
            drawdowns = (cumulative - running_max) / (running_max + 1e-8)
            max_drawdown = abs(np.min(drawdowns))
        else:
            max_drawdown = 0
        
        if len(pnls) > 1:
            sharpe_ratio = np.mean(pnls) / (np.std(pnls) + 1e-8) * np.sqrt(252 * 4 * 60)
        else:
            sharpe_ratio = 0.0
        
        metrics = {
            'total_pnl': self.cumulative_pnl - total_commission,
            'total_commission': total_commission,
            'avg_slippage': float(avg_slippage),
            'max_slippage': float(max_slippage),
            'win_rate': float(win_rate),
            'sharpe_ratio': float(sharpe_ratio),
            'max_drawdown': float(max_drawdown),
            'total_trades': len(self.trades),
            'total_impact_cost': float(self.cumulative_impact_cost),
            'large_order_count': large_order_count,
            'large_order_total_volume': total_large_order_volume,
            'avg_large_order_slippage_bps': float(avg_large_order_slippage * 10000),
            'max_large_order_slippage_bps': float(max_large_order_slippage * 10000)
        }
        
        return VWAPResult(
            pnl_curve=self.pnl_curve,
            trades=[{
                'timestamp': t.timestamp,
                'price': t.price,
                'volume': t.volume,
                'slippage': t.slippage,
                'side': t.side,
                'is_large_order': t.is_large_order,
                'impact_analysis': {
                    'order_size': t.impact_analysis.order_size,
                    'bid_depth': t.impact_analysis.bid_depth,
                    'ask_depth': t.impact_analysis.ask_depth,
                    'temp_impact_bps': t.impact_analysis.temp_impact_bps,
                    'perm_impact_bps': t.impact_analysis.perm_impact_bps,
                    'total_impact_cost': t.impact_analysis.total_impact_cost,
                    'expected_slippage_bps': t.impact_analysis.expected_slippage_bps
                } if t.impact_analysis else None
            } for t in self.trades],
            metrics=metrics,
            impact_analysis=self.impact_analysis_history
        )
