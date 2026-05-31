from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import time
from typing import List, Optional, Dict

from cache_manager import cache_manager
from music_generator_optimized import music_generator, create_midi_from_notes_fast
from multi_track_generator import multi_track_generator, create_multi_track_midi, INSTRUMENTS

app = FastAPI(title="AI Music Generator API (Optimized)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class MusicGenerationRequest(BaseModel):
    style: str
    emotion: str
    input_notes: List[dict]
    temperature: float = 1.0

class MultiTrackRequest(BaseModel):
    style: str
    emotion: str
    input_notes: List[dict]
    temperature: float = 1.0
    num_bars: int = 16
    track_volumes: Optional[Dict[str, int]] = None
    muted_tracks: Optional[List[str]] = None
    track_timbres: Optional[Dict[str, int]] = None

class Note(BaseModel):
    pitch: int
    start_time: float
    duration: float
    velocity: int = 80

@app.get("/")
async def root():
    return {
        "message": "AI Music Generator API (Optimized)",
        "version": "2.0",
        "features": ["ONNX Ready", "Redis Cache", "Vectorized Generation"]
    }

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "cache": cache_manager.stats()
    }

@app.get("/api/cache/stats")
async def get_cache_stats():
    return cache_manager.stats()

@app.post("/api/cache/clear")
async def clear_cache():
    cache_manager.clear()
    return {"status": "cache cleared"}

@app.get("/api/instruments")
async def get_available_instruments():
    """获取可用乐器列表"""
    instruments = []
    for key, info in INSTRUMENTS.items():
        instruments.append({
            "id": key,
            "name": info["name"],
            "midi_program": info["midi_program"],
            "channel": info["channel"]
        })
    return {
        "instruments": instruments,
        "total": len(instruments)
    }

@app.post("/api/generate/multitrack")
async def generate_multi_track(request: MultiTrackRequest):
    """生成多轨道音乐"""
    start_total = time.time()
    
    try:
        request_dict = {
            "style": request.style,
            "emotion": request.emotion,
            "input_notes": request.input_notes,
            "temperature": round(request.temperature, 2),
            "num_bars": request.num_bars
        }
        
        cached_result = cache_manager.get(request_dict)
        if cached_result:
            elapsed = time.time() - start_total
            cached_result["from_cache"] = True
            cached_result["processing_time_ms"] = round(elapsed * 1000, 2)
            print(f"Multi-track cache hit! Total time: {elapsed*1000:.2f}ms")
            return cached_result
        
        tracks = multi_track_generator.generate_multi_track(
            request.input_notes,
            request.style,
            request.emotion,
            request.temperature,
            request.num_bars
        )
        
        track_info = {}
        total_notes = 0
        for instrument, notes in tracks.items():
            track_info[instrument] = {
                "note_count": len(notes),
                "channel": INSTRUMENTS[instrument]["channel"],
                "program": INSTRUMENTS[instrument]["midi_program"]
            }
            total_notes += len(notes)
        
        midi_data = create_multi_track_midi(
            tracks,
            request.track_volumes,
            request.muted_tracks
        )
        midi_base64 = base64.b64encode(midi_data).decode('utf-8')
        
        result = {
            "success": True,
            "tracks": tracks,
            "track_info": track_info,
            "total_notes": total_notes,
            "midi_base64": midi_base64,
            "from_cache": False,
            "processing_time_ms": round((time.time() - start_total) * 1000, 2)
        }
        
        cache_manager.set(request_dict, result)
        
        elapsed = time.time() - start_total
        print(f"Multi-track generated in {elapsed*1000:.2f}ms, total notes: {total_notes}")
        
        return result
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/export/multitrack")
async def export_multi_track(request: MultiTrackRequest):
    """导出多轨道MIDI，支持音量和静音设置"""
    try:
        tracks = multi_track_generator.generate_multi_track(
            request.input_notes,
            request.style,
            request.emotion,
            request.temperature,
            request.num_bars
        )
        
        midi_data = create_multi_track_midi(
            tracks,
            request.track_volumes,
            request.muted_tracks
        )
        midi_base64 = base64.b64encode(midi_data).decode('utf-8')
        
        return {
            "success": True,
            "midi_base64": midi_base64
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate")
async def generate_music(request: MusicGenerationRequest):
    start_total = time.time()
    
    try:
        request_dict = {
            "style": request.style,
            "emotion": request.emotion,
            "input_notes": request.input_notes,
            "temperature": round(request.temperature, 2)
        }
        
        cached_result = cache_manager.get(request_dict)
        if cached_result:
            elapsed = time.time() - start_total
            cached_result["from_cache"] = True
            cached_result["processing_time_ms"] = round(elapsed * 1000, 2)
            print(f"Cache hit! Total time: {elapsed*1000:.2f}ms")
            return cached_result
        
        start_gen = time.time()
        generated_notes = music_generator.generate_fast(
            request.input_notes,
            request.style,
            request.emotion,
            request.temperature,
            num_bars=16
        )
        gen_time = time.time() - start_gen
        
        start_midi = time.time()
        midi_data = create_midi_from_notes_fast(generated_notes)
        midi_base64 = base64.b64encode(midi_data).decode('utf-8')
        midi_time = time.time() - start_midi
        
        result = {
            "success": True,
            "notes": generated_notes,
            "midi_base64": midi_base64,
            "from_cache": False,
            "generation_time_ms": round(gen_time * 1000, 2),
            "midi_time_ms": round(midi_time * 1000, 2),
            "processing_time_ms": round((time.time() - start_total) * 1000, 2)
        }
        
        cache_manager.set(request_dict, result)
        
        elapsed = time.time() - start_total
        print(f"Generated in {elapsed*1000:.2f}ms (gen: {gen_time*1000:.2f}ms, midi: {midi_time*1000:.2f}ms)")
        
        return result
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app, 
        host="127.0.0.1", 
        port=8000,
        loop="uvloop" if __import__("platform").system() != "Windows" else "asyncio",
        http="h11",
        limit_concurrency=1000,
        timeout_keep_alive=5
    )
