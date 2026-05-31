from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import asyncio
import uuid
from typing import List, Dict, Any, Optional
import time
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engines.replay import replay_engine
from engines.vwap import VWAPStrategy

app = FastAPI(title="Level-2 行情回放API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

backtest_tasks: Dict[str, Dict[str, Any]] = {}
backtest_results: Dict[str, Any] = {}

class VWAPParams(BaseModel):
    symbol: str
    total_volume: int
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    participation_rate: float = 0.1
    min_order_size: int = 100
    max_order_size: int = 5000

@app.get("/api/replay/symbols")
async def get_symbols():
    return replay_engine.get_symbols()

@app.post("/api/replay/upload")
async def upload_csv(file: UploadFile = File(...)):
    import os
    os.makedirs("../data", exist_ok=True)
    file_path = f"../data/{file.filename}"
    with open(file_path, "wb") as f:
        f.write(await file.read())
    
    replay_engine.data_path = file_path
    replay_engine._load_data()
    
    return {
        "success": True,
        "symbols": replay_engine.get_symbols(),
        "total_ticks": len(replay_engine.df) if replay_engine.df is not None else 0
    }

class OrderedReplayEngine:
    def __init__(self, replay_engine):
        self.replay_engine = replay_engine
        self.symbol_data_cache = {}
        
    def get_sorted_ticks(self, symbol: str):
        if symbol not in self.symbol_data_cache:
            df = self.replay_engine.get_symbol_data(symbol)
            if len(df) > 0:
                self.symbol_data_cache[symbol] = df.sort_values('timestamp').to_dict('records')
            else:
                self.symbol_data_cache[symbol] = []
        return self.symbol_data_cache[symbol]
    
    def get_tick_by_index(self, symbol: str, index: int):
        ticks = self.get_sorted_ticks(symbol)
        if 0 <= index < len(ticks):
            return ticks[index]
        return None
    
    def get_index_by_timestamp(self, symbol: str, timestamp: int):
        ticks = self.get_sorted_ticks(symbol)
        if not ticks:
            return 0
        for i, tick in enumerate(ticks):
            if tick['timestamp'] >= timestamp:
                return i
        return len(ticks) - 1
    
    def get_total_ticks(self, symbol: str):
        return len(self.get_sorted_ticks(symbol))

ordered_replay = OrderedReplayEngine(replay_engine)

@app.websocket("/api/replay/ws")
async def websocket_endpoint(websocket: WebSocket, symbol: str):
    await websocket.accept()
    
    if symbol not in replay_engine.get_symbols():
        await websocket.close(code=4000, reason="Invalid symbol")
        return
    
    start_time, end_time = replay_engine.get_time_range(symbol)
    total_ticks = ordered_replay.get_total_ticks(symbol)
    
    await websocket.send_json({
        "type": "init",
        "data": {
            "start_time": start_time,
            "end_time": end_time,
            "symbol": symbol,
            "total_ticks": total_ticks
        }
    })
    
    current_index = 0
    is_playing = False
    speed = 1.0
    
    send_lock = asyncio.Lock()
    control_queue = asyncio.Queue()
    
    async def control_listener():
        nonlocal is_playing, speed, current_index
        while True:
            try:
                data = await websocket.receive_text()
                message = json.loads(data)
                await control_queue.put(message)
            except WebSocketDisconnect:
                await control_queue.put({"action": "disconnect"})
                break
            except Exception as e:
                print(f"Control listener error: {e}")
                continue
    
    control_task = asyncio.create_task(control_listener())
    
    try:
        while True:
            try:
                message = await asyncio.wait_for(control_queue.get(), timeout=0.001)
                action = message.get("action")
                
                if action == "disconnect":
                    break
                elif action == "play":
                    is_playing = True
                elif action == "pause":
                    is_playing = False
                elif action == "seek":
                    target_timestamp = message.get("payload", {}).get("timestamp", start_time)
                    current_index = ordered_replay.get_index_by_timestamp(symbol, target_timestamp)
                    
                    async with send_lock:
                        tick = ordered_replay.get_tick_by_index(symbol, current_index)
                        if tick:
                            tick_obj = type('Tick', (), tick)()
                            await websocket.send_json({
                                "type": "tick",
                                "data": {
                                    "timestamp": tick['timestamp'],
                                    "symbol": tick['symbol'],
                                    "price": tick['price'],
                                    "volume": tick['volume'],
                                    "amount": tick['amount'],
                                    "bs_flag": tick['bs_flag']
                                }
                            })
                            
                            order_book = replay_engine.get_order_book(symbol, tick['timestamp'], tick_obj)
                            await websocket.send_json({
                                "type": "orderbook",
                                "data": {
                                    "timestamp": tick['timestamp'],
                                    "symbol": symbol,
                                    "asks": order_book.asks,
                                    "bids": order_book.bids
                                }
                            })
                elif action == "speed":
                    speed = float(message.get("payload", {}).get("speed", 1.0))
                    
            except asyncio.TimeoutError:
                pass
            
            if is_playing:
                batch_size = max(1, int(speed))
                
                async with send_lock:
                    batch_ticks = []
                    batch_orderbooks = []
                    
                    for i in range(batch_size):
                        if current_index >= total_ticks:
                            current_index = 0
                            break
                        
                        tick = ordered_replay.get_tick_by_index(symbol, current_index)
                        if tick:
                            batch_ticks.append(tick)
                            
                            if i == batch_size - 1 or speed < 10:
                                tick_obj = type('Tick', (), tick)()
                                order_book = replay_engine.get_order_book(symbol, tick['timestamp'], tick_obj)
                                batch_orderbooks.append(order_book)
                        
                        current_index += 1
                    
                    if speed < 20:
                        for tick in batch_ticks:
                            await websocket.send_json({
                                "type": "tick",
                                "data": {
                                    "timestamp": tick['timestamp'],
                                    "symbol": tick['symbol'],
                                    "price": tick['price'],
                                    "volume": tick['volume'],
                                    "amount": tick['amount'],
                                    "bs_flag": tick['bs_flag']
                                }
                            })
                        
                        if batch_orderbooks:
                            last_ob = batch_orderbooks[-1]
                            await websocket.send_json({
                                "type": "orderbook",
                                "data": {
                                    "timestamp": last_ob.timestamp,
                                    "symbol": symbol,
                                    "asks": last_ob.asks,
                                    "bids": last_ob.bids
                                }
                            })
                    else:
                        if batch_ticks:
                            await websocket.send_json({
                                "type": "tick_batch",
                                "data": [{
                                    "timestamp": t['timestamp'],
                                    "symbol": t['symbol'],
                                    "price": t['price'],
                                    "volume": t['volume'],
                                    "amount": t['amount'],
                                    "bs_flag": t['bs_flag']
                                } for t in batch_ticks]
                            })
                        
                        if batch_orderbooks:
                            last_ob = batch_orderbooks[-1]
                            await websocket.send_json({
                                "type": "orderbook",
                                "data": {
                                    "timestamp": last_ob.timestamp,
                                    "symbol": symbol,
                                    "asks": last_ob.asks,
                                    "bids": last_ob.bids
                                }
                            })
                    
                    if current_index % 100 == 0 and batch_ticks:
                        last_tick = batch_ticks[-1]
                        await websocket.send_json({
                            "type": "progress",
                            "data": {
                                "current_index": current_index,
                                "current_time": last_tick['timestamp'],
                                "total_ticks": total_ticks
                            }
                        })
                
                sleep_time = max(0.005, 0.05 / max(1, speed / 10))
                await asyncio.sleep(sleep_time)
                
    except WebSocketDisconnect:
        print(f"Client disconnected from {symbol}")
    finally:
        control_task.cancel()
        try:
            await control_task
        except asyncio.CancelledError:
            pass

@app.post("/api/strategy/vwap")
async def submit_vwap_backtest(params: VWAPParams):
    task_id = str(uuid.uuid4())
    
    backtest_tasks[task_id] = {
        "task_id": task_id,
        "status": "running",
        "strategy": "VWAP",
        "params": params.dict(),
        "progress": 0.0,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")
    }
    
    async def run_backtest():
        def progress_callback(progress: float):
            backtest_tasks[task_id]["progress"] = progress
        
        try:
            strategy = VWAPStrategy(
                symbol=params.symbol,
                total_volume=params.total_volume,
                participation_rate=params.participation_rate,
                min_order_size=params.min_order_size,
                max_order_size=params.max_order_size
            )
            
            result = strategy.run(progress_callback)
            
            backtest_results[task_id] = {
                "task_id": task_id,
                "pnl_curve": result.pnl_curve,
                "trades": result.trades,
                "metrics": result.metrics,
                "impact_analysis": result.impact_analysis
            }
            
            backtest_tasks[task_id]["status"] = "completed"
            backtest_tasks[task_id]["progress"] = 1.0
            backtest_tasks[task_id]["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            
        except Exception as e:
            backtest_tasks[task_id]["status"] = "failed"
            backtest_tasks[task_id]["error_message"] = str(e)
    
    asyncio.create_task(run_backtest())
    
    return backtest_tasks[task_id]

@app.get("/api/backtest/list")
async def get_backtest_list():
    return list(backtest_tasks.values())

@app.get("/api/backtest/{task_id}/status")
async def get_backtest_status(task_id: str):
    if task_id not in backtest_tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    task = backtest_tasks[task_id]
    return {
        "status": task["status"],
        "progress": task["progress"]
    }

@app.get("/api/backtest/{task_id}")
async def get_backtest_result(task_id: str):
    if task_id not in backtest_results:
        if task_id in backtest_tasks:
            return {"status": backtest_tasks[task_id]["status"], "progress": backtest_tasks[task_id]["progress"]}
        raise HTTPException(status_code=404, detail="Result not found")
    
    return backtest_results[task_id]

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "symbols": replay_engine.get_symbols()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
