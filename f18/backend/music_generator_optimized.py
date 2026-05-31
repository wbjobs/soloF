import numpy as np
import time
from typing import List, Dict
import struct

class OptimizedMusicGenerator:
    """优化的音乐生成器，使用预计算模式和向量化操作"""
    
    def __init__(self):
        self.style_patterns = {
            'jazz': np.array([0, 3, 7, 10], dtype=np.int32),
            'classical': np.array([0, 2, 4, 5, 7, 9, 11], dtype=np.int32),
            'electronic': np.array([0, 4, 7, 12, 7, 4], dtype=np.int32)
        }
        
        self.emotion_biases = {
            'happy': 5,
            'sad': -5,
            'energetic': 3
        }
        
        self.duration_ranges = {
            'happy': (0.25, 0.5),
            'sad': (0.5, 1.0),
            'energetic': (0.125, 0.375)
        }
        
        self.chord_probs = {
            'jazz': 0.4,
            'classical': 0.2,
            'electronic': 0.3
        }
    
    def _notes_to_array(self, notes: List[Dict]) -> np.ndarray:
        """将音符列表转换为numpy数组以进行快速处理"""
        if not notes:
            return np.array([[60, 0, 0.5, 80]], dtype=np.float32)
        
        arr = np.zeros((len(notes), 4), dtype=np.float32)
        for i, note in enumerate(notes):
            arr[i] = [
                note.get('pitch', 60),
                note.get('start_time', 0),
                note.get('duration', 0.5),
                note.get('velocity', 80)
            ]
        return arr
    
    def generate_fast(self, input_notes: List[Dict], style: str, emotion: str, 
                      temperature: float = 1.0, num_bars: int = 16) -> List[Dict]:
        """使用向量化操作快速生成音乐"""
        start_time = time.time()
        
        input_array = self._notes_to_array(input_notes)
        
        if len(input_array) > 0:
            last_pitch = int(input_array[-1, 0]) % 12
            last_octave = int(input_array[-1, 0]) // 12
            current_time = float(np.max(input_array[:, 1] + input_array[:, 2]))
        else:
            last_pitch = 0
            last_octave = 5
            current_time = 0.0
        
        style_pattern = self.style_patterns.get(style, self.style_patterns['electronic'])
        emotion_bias = self.emotion_biases.get(emotion, 0)
        duration_range = self.duration_ranges.get(emotion, (0.25, 0.5))
        chord_prob = self.chord_probs.get(style, 0.3)
        
        seed = hash(style + emotion + f"{temperature:.2f}") % 2**32
        rng = np.random.default_rng(seed)
        
        notes_per_bar = 4
        total_notes = num_bars * notes_per_bar
        
        pattern_indices = rng.integers(0, len(style_pattern), size=total_notes)
        pattern_notes = style_pattern[pattern_indices]
        
        intervals = rng.normal(0, 3 * temperature, size=total_notes).astype(np.int32)
        
        durations = rng.uniform(duration_range[0], duration_range[1], size=total_notes)
        durations = np.clip(durations, 0.125, 1.0)
        
        chord_masks = rng.random(size=total_notes) < chord_prob
        
        generated = []
        
        for note in input_notes:
            generated.append({
                "pitch": note["pitch"],
                "start_time": note["start_time"],
                "duration": note["duration"],
                "velocity": note.get("velocity", 80)
            })
        
        for i in range(total_notes):
            new_pitch = (last_pitch + pattern_notes[i] + intervals[i] + emotion_bias) % 12
            new_pitch = (last_octave * 12) + new_pitch
            new_pitch = max(36, min(84, new_pitch))
            
            duration = float(durations[i])
            
            if chord_masks[i]:
                for ci in [0, 4, 7]:
                    chord_pitch = max(36, min(84, new_pitch + ci))
                    generated.append({
                        "pitch": int(chord_pitch),
                        "start_time": float(current_time),
                        "duration": duration,
                        "velocity": 80
                    })
            else:
                generated.append({
                    "pitch": int(new_pitch),
                    "start_time": float(current_time),
                    "duration": duration,
                    "velocity": 80
                })
            
            last_pitch = new_pitch % 12
            current_time += duration
        
        elapsed = time.time() - start_time
        print(f"Generated {len(generated)} notes in {elapsed:.4f} seconds")
        
        return generated

def create_midi_from_notes_fast(notes: List[Dict]) -> bytes:
    """优化的MIDI文件生成函数"""
    note_events = []
    
    for note in notes:
        start_tick = int(note['start_time'] * 480)
        end_tick = int((note['start_time'] + note['duration']) * 480)
        
        note_events.append((start_tick, 0x90, note['pitch'], note['velocity']))
        note_events.append((end_tick, 0x80, note['pitch'], 0x40))
    
    note_events.sort(key=lambda x: x[0])
    
    midi_data = bytearray()
    midi_data.extend(b'MThd')
    midi_data.extend(struct.pack('>I', 6))
    midi_data.extend(struct.pack('>HHH', 0, 1, 480))
    
    track_data = bytearray()
    track_data.extend([0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20])
    track_data.extend([0xFF, 0x58, 0x04, 0x04, 0x04, 0x18, 0x08])
    
    prev_tick = 0
    for tick, event_type, pitch, velocity in note_events:
        delta = tick - prev_tick
        
        if delta == 0:
            track_data.append(0x00)
        else:
            delta_bytes = []
            temp = delta
            while temp > 0:
                byte = temp & 0x7F
                temp >>= 7
                if temp > 0:
                    byte |= 0x80
                delta_bytes.insert(0, byte)
            track_data.extend(delta_bytes)
        
        track_data.extend([event_type, pitch, velocity])
        prev_tick = tick
    
    track_data.extend([0x00, 0xFF, 0x2F, 0x00])
    
    midi_data.extend(b'MTrk')
    midi_data.extend(struct.pack('>I', len(track_data)))
    midi_data.extend(track_data)
    
    return bytes(midi_data)

music_generator = OptimizedMusicGenerator()
