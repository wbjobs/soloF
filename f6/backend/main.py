from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import numpy as np
import librosa
import io
import os
import json
import asyncio
from typing import List, Dict, Optional
import uuid
from datetime import datetime
import mido
from mido import Message, MidiFile, MidiTrack

app = FastAPI(title="MusicAI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
MIDI_DIR = "generated_midi"
os.makedirs(MIDI_DIR, exist_ok=True)

MUSIC_STYLES = {
    "jazz": {
        "name": "爵士",
        "chord_types": {
            "major": ["maj7", "maj9", "maj13", "6/9"],
            "minor": ["m7", "m9", "m13", "m7b5"],
            "dominant": ["7", "9", "13", "7b9", "7#9", "7alt"],
        },
        "inversion_probs": [0.2, 0.4, 0.3, 0.1],
        "rhythm_patterns": ["four-to-the-floor", "Charleston", "syncopated"],
        "swing_ratio": 0.67,
    },
    "electronic": {
        "name": "电子",
        "chord_types": {
            "major": ["maj", "maj7", "sus2", "sus4"],
            "minor": ["m", "m7", "msus4"],
            "dominant": ["7", "7sus4"],
        },
        "inversion_probs": [0.7, 0.2, 0.1, 0.0],
        "rhythm_patterns": ["four-to-the-floor", "offbeat", "arpeggio"],
        "swing_ratio": 0.5,
    },
    "classical": {
        "name": "古典",
        "chord_types": {
            "major": ["maj", "maj7"],
            "minor": ["m", "m7"],
            "dominant": ["7"],
        },
        "inversion_probs": [0.4, 0.4, 0.2, 0.0],
        "rhythm_patterns": ["alberti", "block", "broken"],
        "swing_ratio": 0.5,
    },
    "rock": {
        "name": "摇滚",
        "chord_types": {
            "major": ["maj", "5", "sus2", "sus4"],
            "minor": ["m", "m5"],
            "dominant": ["7", "5"],
        },
        "inversion_probs": [0.9, 0.1, 0.0, 0.0],
        "rhythm_patterns": ["eighth-note", "power-chord", "palm-mute"],
        "swing_ratio": 0.5,
    },
    "latin": {
        "name": "拉丁",
        "chord_types": {
            "major": ["maj7", "6", "6/9"],
            "minor": ["m7", "m9"],
            "dominant": ["7", "9", "13"],
        },
        "inversion_probs": [0.3, 0.5, 0.2, 0.0],
        "rhythm_patterns": ["montuno", "bossa-nova", "clave"],
        "swing_ratio": 0.55,
    }
}

CHORD_FORMULAS = {
    "maj": [0, 4, 7],
    "maj7": [0, 4, 7, 11],
    "maj9": [0, 4, 7, 11, 14],
    "maj13": [0, 4, 7, 11, 14, 21],
    "m": [0, 3, 7],
    "m7": [0, 3, 7, 10],
    "m9": [0, 3, 7, 10, 14],
    "m13": [0, 3, 7, 10, 14, 21],
    "m7b5": [0, 3, 6, 10],
    "7": [0, 4, 7, 10],
    "9": [0, 4, 7, 10, 14],
    "13": [0, 4, 7, 10, 14, 21],
    "7b9": [0, 4, 7, 10, 13],
    "7#9": [0, 4, 7, 10, 15],
    "7alt": [0, 4, 6, 10, 13],
    "6": [0, 4, 7, 9],
    "6/9": [0, 4, 7, 9, 14],
    "sus2": [0, 2, 7],
    "sus4": [0, 5, 7],
    "7sus4": [0, 5, 7, 10],
    "dim": [0, 3, 6],
    "dim7": [0, 3, 6, 9],
    "aug": [0, 4, 8],
    "7#5": [0, 4, 8, 10],
    "5": [0, 7],
    "m5": [0, 3, 7],
}


class SimpleMusicVAE:
    def __init__(self):
        self.chord_progressions = [
            ["C", "Am", "F", "G"],
            ["G", "D", "Em", "C"],
            ["D", "A", "Bm", "G"],
            ["A", "E", "F#m", "D"],
            ["E", "B", "C#m", "A"],
            ["F", "C", "Dm", "Bb"],
            ["Bb", "F", "Gm", "Eb"],
            ["Eb", "Bb", "Cm", "Ab"],
        ]
        self.drum_patterns = [
            {"kick": [1, 0, 0, 0, 1, 0, 0, 0], "snare": [0, 0, 1, 0, 0, 0, 1, 0], "hihat": [1, 1, 1, 1, 1, 1, 1, 1]},
            {"kick": [1, 0, 1, 0, 1, 0, 1, 0], "snare": [0, 0, 1, 0, 0, 0, 1, 0], "hihat": [1, 0, 1, 0, 1, 0, 1, 0]},
            {"kick": [1, 0, 0, 1, 0, 0, 1, 0], "snare": [0, 0, 1, 0, 0, 1, 0, 0], "hihat": [1, 1, 0, 1, 1, 0, 1, 1]},
        ]
        self.note_names = {
            "C": 60, "C#": 61, "D": 62, "D#": 63, "E": 64, "F": 65,
            "F#": 66, "G": 67, "G#": 68, "A": 69, "A#": 70, "B": 71,
            "Cm": 60, "C#m": 61, "Dm": 62, "D#m": 63, "Em": 64, "Fm": 65,
            "F#m": 66, "Gm": 67, "G#m": 68, "Am": 69, "A#m": 70, "Bm": 71,
        }

    def generate_chords(self, num_bars: int = 4, temperature: float = 0.5):
        progression_idx = np.random.randint(0, len(self.chord_progressions))
        base_progression = self.chord_progressions[progression_idx]
        
        result = []
        for i in range(num_bars):
            chord = base_progression[i % len(base_progression)]
            if np.random.random() < temperature * 0.3:
                chord = np.random.choice(base_progression)
            result.append({
                "chord": chord,
                "root_note": self.note_names.get(chord, 60),
                "bar": i + 1
            })
        return result

    def generate_drums(self, num_bars: int = 4, pattern_idx: int = None):
        if pattern_idx is None:
            pattern_idx = np.random.randint(0, len(self.drum_patterns))
        pattern = self.drum_patterns[pattern_idx]
        
        result = []
        for bar in range(num_bars):
            for step in range(8):
                time = bar * 8 + step
                if pattern["kick"][step]:
                    result.append({"type": "kick", "time": time, "note": 36})
                if pattern["snare"][step]:
                    result.append({"type": "snare", "time": time, "note": 38})
                if pattern["hihat"][step]:
                    result.append({"type": "hihat", "time": time, "note": 42})
        return result

    def create_midi_file(self, chords, drums, bpm: int = 120, filename: str = None):
        if filename is None:
            filename = f"generated_{uuid.uuid4().hex[:8]}.mid"
        
        mid = MidiFile()
        tempo = mido.bpm2tempo(bpm)
        
        chord_track = MidiTrack()
        mid.tracks.append(chord_track)
        chord_track.append(mido.MetaMessage('set_tempo', tempo=tempo))
        chord_track.append(mido.MetaMessage('track_name', name='Chords'))
        
        for chord_info in chords:
            root = chord_info["root_note"]
            third = root + 3 if "m" in chord_info["chord"] else root + 4
            fifth = root + 7
            chord_track.append(Message('note_on', note=root, velocity=64, time=0))
            chord_track.append(Message('note_on', note=third, velocity=64, time=0))
            chord_track.append(Message('note_on', note=fifth, velocity=64, time=0))
            chord_track.append(Message('note_off', note=root, velocity=64, time=480))
            chord_track.append(Message('note_off', note=third, velocity=64, time=0))
            chord_track.append(Message('note_off', note=fifth, velocity=64, time=0))
        
        drum_track = MidiTrack()
        mid.tracks.append(drum_track)
        drum_track.append(mido.MetaMessage('track_name', name='Drums'))
        drum_track.append(mido.Message('program_change', program=0, channel=9))
        
        last_time = 0
        for drum in sorted(drums, key=lambda x: x["time"]):
            delta = (drum["time"] * 60) - last_time
            drum_track.append(Message('note_on', note=drum["note"], velocity=80, time=delta, channel=9))
            drum_track.append(Message('note_off', note=drum["note"], velocity=64, time=30, channel=9))
            last_time = drum["time"] * 60 + 30
        
        filepath = os.path.join(MIDI_DIR, filename)
        mid.save(filepath)
        return filepath, filename


music_vae = SimpleMusicVAE()


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def send_personal_message(self, message: Dict, websocket: WebSocket):
        await websocket.send_json(message)

    async def broadcast(self, message: Dict):
        for connection in self.active_connections:
            await connection.send_json(message)


manager = ConnectionManager()


def detect_bpm(audio_data, sr: int = 22050):
    try:
        tempo, beat_frames = librosa.beat.beat_track(y=audio_data, sr=sr)
        onset_env = librosa.onset.onset_strength(y=audio_data, sr=sr)
        tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)
        return float(tempo), len(beats)
    except Exception as e:
        return 120.0, 0


@app.get("/")
async def root():
    return {"message": "MusicAI Backend API"}


@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}


@app.post("/api/upload/audio")
async def upload_audio(file: UploadFile = File(...)):
    try:
        file_id = str(uuid.uuid4())
        ext = os.path.splitext(file.filename)[1]
        save_path = os.path.join(UPLOAD_DIR, f"{file_id}{ext}")
        
        contents = await file.read()
        
        with open(save_path, "wb") as f:
            f.write(contents)
        
        audio_data, sr = librosa.load(io.BytesIO(contents), sr=22050)
        duration = len(audio_data) / sr
        
        bpm, beat_count = detect_bpm(audio_data, sr)
        
        return JSONResponse({
            "success": True,
            "file_id": file_id,
            "filename": file.filename,
            "duration": round(duration, 2),
            "bpm": round(bpm, 1),
            "beat_count": beat_count,
            "file_size": len(contents)
        })
    
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)


@app.post("/api/generate/chords")
async def generate_chords(num_bars: int = 4, temperature: float = 0.5, bpm: int = 120):
    try:
        chords = music_vae.generate_chords(num_bars=num_bars, temperature=temperature)
        drums = music_vae.generate_drums(num_bars=num_bars)
        
        midi_path, midi_filename = music_vae.create_midi_file(chords, drums, bpm=bpm)
        
        return JSONResponse({
            "success": True,
            "chords": chords,
            "drums_count": len(drums),
            "bpm": bpm,
            "midi_file": midi_filename,
            "num_bars": num_bars
        })
    
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)


@app.post("/api/generate/drums")
async def generate_drums(num_bars: int = 4, pattern_idx: int = None, bpm: int = 120):
    try:
        drums = music_vae.generate_drums(num_bars=num_bars, pattern_idx=pattern_idx)
        chords = music_vae.generate_chords(num_bars=num_bars)
        
        midi_path, midi_filename = music_vae.create_midi_file(chords, drums, bpm=bpm)
        
        return JSONResponse({
            "success": True,
            "drums": drums,
            "midi_file": midi_filename,
            "num_bars": num_bars
        })
    
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)


@app.post("/api/detect/bpm")
async def detect_bpm_endpoint(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        audio_data, sr = librosa.load(io.BytesIO(contents), sr=22050)
        
        bpm, beat_count = detect_bpm(audio_data, sr)
        
        return JSONResponse({
            "success": True,
            "bpm": round(bpm, 1),
            "beat_count": beat_count,
            "filename": file.filename
        })
    
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)


@app.websocket("/ws/midi")
async def websocket_midi(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "generate":
                num_bars = data.get("num_bars", 4)
                bpm = data.get("bpm", 120)
                temperature = data.get("temperature", 0.5)
                
                chords = music_vae.generate_chords(num_bars=num_bars, temperature=temperature)
                drums = music_vae.generate_drums(num_bars=num_bars)
                midi_path, midi_filename = music_vae.create_midi_file(chords, drums, bpm=bpm)
                
                for i, chord in enumerate(chords):
                    await asyncio.sleep(0.1)
                    await manager.send_personal_message({
                        "type": "chord_event",
                        "chord": chord["chord"],
                        "bar": i + 1,
                        "timestamp": datetime.now().isoformat()
                    }, websocket)
                
                for drum in drums[:32]:
                    await asyncio.sleep(0.05)
                    await manager.send_personal_message({
                        "type": "drum_event",
                        "drum_type": drum["type"],
                        "time": drum["time"],
                        "timestamp": datetime.now().isoformat()
                    }, websocket)
                
                await manager.send_personal_message({
                    "type": "generation_complete",
                    "chords": chords,
                    "drums_count": len(drums),
                    "midi_file": midi_filename,
                    "bpm": bpm
                }, websocket)
            
            elif data.get("type") == "stream_midi":
                bpm = data.get("bpm", 120)
                duration = data.get("duration", 10)
                
                interval = 60.0 / bpm / 4
                for tick in range(int(duration * bpm / 60 * 4)):
                    await asyncio.sleep(interval)
                    await manager.send_personal_message({
                        "type": "midi_tick",
                        "tick": tick,
                        "bpm": bpm,
                        "beat": tick // 4 + 1,
                        "timestamp": datetime.now().isoformat()
                    }, websocket)
                
                await manager.send_personal_message({
                    "type": "stream_complete"
                }, websocket)
            
            elif data.get("type") == "ping":
                await manager.send_personal_message({
                    "type": "pong",
                    "timestamp": datetime.now().isoformat()
                }, websocket)
    
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        await manager.send_personal_message({
            "type": "error",
            "message": str(e)
        }, websocket)
        manager.disconnect(websocket)


@app.get("/api/midi/list")
async def list_midi_files():
    try:
        files = []
        for filename in os.listdir(MIDI_DIR):
            if filename.endswith(".mid"):
                filepath = os.path.join(MIDI_DIR, filename)
                stats = os.stat(filepath)
                files.append({
                    "filename": filename,
                    "size": stats.st_size,
                    "created": datetime.fromtimestamp(stats.st_ctime).isoformat()
                })
        return JSONResponse({
            "success": True,
            "files": sorted(files, key=lambda x: x["created"], reverse=True)
        })
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)


def get_chord_quality(chord_name):
    if 'm' in chord_name and 'maj' not in chord_name:
        return 'minor'
    if 'dim' in chord_name:
        return 'diminished'
    if 'aug' in chord_name:
        return 'augmented'
    if '7' in chord_name and 'maj' not in chord_name:
        return 'dominant'
    return 'major'


def select_chord_type_for_style(style, chord_name):
    style_config = MUSIC_STYLES.get(style, MUSIC_STYLES['jazz'])
    quality = get_chord_quality(chord_name)
    available_types = style_config['chord_types'].get(quality, ['maj'])
    
    if not available_types:
        return 'm' if quality == 'minor' else 'maj'
    
    return available_types[int(np.random.randint(0, len(available_types)))]


def apply_inversion(notes, inversion_level):
    result = notes.copy()
    for i in range(min(inversion_level, len(result))):
        result[i] += 12
    return sorted(result)


def stylize_chord(chord_name, style, octave=4):
    root_note = chord_name.replace('m', '').replace('maj', '').replace('dim', '').replace('aug', '').replace('7', '').replace('9', '').replace('13', '').replace('sus', '').replace('2', '').replace('4', '').replace('#', '').replace('b', '')
    
    note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    if root_note not in note_names:
        root_note = 'C'
    
    root_midi = 60 + note_names.index(root_note) + (octave - 4) * 12
    
    chord_type = select_chord_type_for_style(style, chord_name)
    formula = CHORD_FORMULAS.get(chord_type, CHORD_FORMULAS['maj'])
    
    notes = [root_midi + interval for interval in formula]
    
    style_config = MUSIC_STYLES.get(style, MUSIC_STYLES['jazz'])
    inv_probs = style_config['inversion_probs']
    inv_level = np.random.choice([0, 1, 2, 3], p=inv_probs)
    notes = apply_inversion(notes, inv_level)
    
    return {
        'root': root_note,
        'type': chord_type,
        'quality': get_chord_quality(chord_name),
        'notes': notes,
        'inversion': inv_level,
        'style': style
    }


@app.get("/api/styles/list")
async def list_styles():
    try:
        styles_list = []
        for key, config in MUSIC_STYLES.items():
            styles_list.append({
                'id': key,
                'name': config['name'],
                'chord_types': config['chord_types'],
                'rhythm_patterns': config['rhythm_patterns'],
                'swing_ratio': config['swing_ratio']
            })
        return JSONResponse({
            "success": True,
            "styles": styles_list
        })
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)


@app.post("/api/style/convert")
async def convert_style(
    chords: List[Dict] = Body(...),
    target_style: str = Body(...),
    bpm: Optional[int] = Body(120),
    num_bars: Optional[int] = Body(4)
):
    try:
        if target_style not in MUSIC_STYLES:
            return JSONResponse({
                "success": False,
                "error": f"Invalid style: {target_style}. Available styles: {list(MUSIC_STYLES.keys())}"
            }, status_code=400)
        
        stylized_chords = []
        for chord_info in chords:
            chord_name = chord_info.get('chord', chord_info.get('root', 'C'))
            bar = chord_info.get('bar', len(stylized_chords) + 1)
            stylized = stylize_chord(chord_name, target_style)
            stylized['bar'] = bar
            stylized_chords.append(stylized)
        
        drums = music_vae.generate_drums(num_bars=num_bars)
        
        style_config = MUSIC_STYLES[target_style]
        
        mid = MidiFile()
        tempo = mido.bpm2tempo(bpm)
        
        chord_track = MidiTrack()
        mid.tracks.append(chord_track)
        chord_track.append(mido.MetaMessage('set_tempo', tempo=tempo))
        chord_track.append(mido.MetaMessage('track_name', name=f'{style_config["name"]} Chords'))
        
        for i, chord in enumerate(stylized_chords):
            notes = chord['notes']
            for note in notes:
                chord_track.append(Message('note_on', note=note, velocity=64, time=0))
            chord_track.append(Message('note_off', note=notes[0], velocity=64, time=480))
            for note in notes[1:]:
                chord_track.append(Message('note_off', note=note, velocity=64, time=0))
        
        drum_track = MidiTrack()
        mid.tracks.append(drum_track)
        drum_track.append(mido.MetaMessage('track_name', name=f'{style_config["name"]} Drums'))
        drum_track.append(mido.Message('program_change', program=0, channel=9))
        
        last_time = 0
        for drum in sorted(drums, key=lambda x: x["time"]):
            delta = (drum["time"] * 60) - last_time
            drum_track.append(Message('note_on', note=drum["note"], velocity=80, time=delta, channel=9))
            drum_track.append(Message('note_off', note=drum["note"], velocity=64, time=30, channel=9))
            last_time = drum["time"] * 60 + 30
        
        filename = f'stylized_{target_style}_{uuid.uuid4().hex[:8]}.mid'
        filepath = os.path.join(MIDI_DIR, filename)
        mid.save(filepath)
        
        return JSONResponse({
            "success": True,
            "original_chords": chords,
            "stylized_chords": stylized_chords,
            "drums": drums,
            "target_style": target_style,
            "style_name": style_config['name'],
            "bpm": bpm,
            "swing_ratio": style_config['swing_ratio'],
            "midi_file": filename
        })
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)


@app.post("/api/generate/stylized")
async def generate_stylized(
    style: str = Body(...),
    num_bars: int = Body(4),
    temperature: float = Body(0.5),
    bpm: int = Body(120)
):
    try:
        if style not in MUSIC_STYLES:
            return JSONResponse({
                "success": False,
                "error": f"Invalid style: {style}. Available styles: {list(MUSIC_STYLES.keys())}"
            }, status_code=400)
        
        base_chords = music_vae.generate_chords(num_bars=num_bars, temperature=temperature)
        
        stylized_chords = []
        for chord_info in base_chords:
            stylized = stylize_chord(chord_info['chord'], style)
            stylized['bar'] = chord_info['bar']
            stylized_chords.append(stylized)
        
        drums = music_vae.generate_drums(num_bars=num_bars)
        
        style_config = MUSIC_STYLES[style]
        
        mid = MidiFile()
        tempo = mido.bpm2tempo(bpm)
        
        chord_track = MidiTrack()
        mid.tracks.append(chord_track)
        chord_track.append(mido.MetaMessage('set_tempo', tempo=tempo))
        chord_track.append(mido.MetaMessage('track_name', name=f'{style_config["name"]} Chords'))
        
        for chord in stylized_chords:
            notes = chord['notes']
            for note in notes:
                chord_track.append(Message('note_on', note=note, velocity=64, time=0))
            chord_track.append(Message('note_off', note=notes[0], velocity=64, time=480))
            for note in notes[1:]:
                chord_track.append(Message('note_off', note=note, velocity=64, time=0))
        
        drum_track = MidiTrack()
        mid.tracks.append(drum_track)
        drum_track.append(mido.MetaMessage('track_name', name=f'{style_config["name"]} Drums'))
        drum_track.append(mido.Message('program_change', program=0, channel=9))
        
        last_time = 0
        for drum in sorted(drums, key=lambda x: x["time"]):
            delta = (drum["time"] * 60) - last_time
            drum_track.append(Message('note_on', note=drum["note"], velocity=80, time=delta, channel=9))
            drum_track.append(Message('note_off', note=drum["note"], velocity=64, time=30, channel=9))
            last_time = drum["time"] * 60 + 30
        
        filename = f'{style}_{uuid.uuid4().hex[:8]}.mid'
        filepath = os.path.join(MIDI_DIR, filename)
        mid.save(filepath)
        
        return JSONResponse({
            "success": True,
            "chords": stylized_chords,
            "base_chords": base_chords,
            "drums": drums,
            "style": style,
            "style_name": style_config['name'],
            "bpm": bpm,
            "swing_ratio": style_config['swing_ratio'],
            "midi_file": filename
        })
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
