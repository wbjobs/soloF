import numpy as np
import time
from typing import List, Dict, Tuple
import struct

INSTRUMENTS = {
    "piano": {
        "name": "钢琴",
        "midi_program": 0,
        "channel": 0,
        "velocity_range": (60, 100),
        "octave_range": (3, 6),
        "rhythm_pattern": "melody"
    },
    "guitar": {
        "name": "吉他",
        "midi_program": 24,
        "channel": 1,
        "velocity_range": (50, 90),
        "octave_range": (2, 5),
        "rhythm_pattern": "chord"
    },
    "bass": {
        "name": "贝斯",
        "midi_program": 32,
        "channel": 2,
        "velocity_range": (70, 110),
        "octave_range": (1, 3),
        "rhythm_pattern": "bass"
    },
    "drums": {
        "name": "鼓",
        "midi_program": 0,
        "channel": 9,
        "velocity_range": (80, 120),
        "octave_range": (0, 0),
        "rhythm_pattern": "drums"
    }
}

DRUM_NOTES = {
    "kick": 36,
    "snare": 38,
    "hihat_closed": 42,
    "hihat_open": 46,
    "tom_low": 41,
    "tom_mid": 45,
    "tom_high": 48,
    "crash": 49,
    "ride": 51
}

class MultiTrackGenerator:
    def __init__(self):
        self.style_patterns = {
            "electronic": {
                "piano": self._generate_synth_pattern,
                "guitar": self._generate_chord_rhythm,
                "bass": self._generate_bass_line,
                "drums": self._generate_edm_drums
            },
            "jazz": {
                "piano": self._generate_jazz_piano,
                "guitar": self._generate_jazz_guitar,
                "bass": self._generate_jazz_bass,
                "drums": self._generate_jazz_drums
            },
            "classical": {
                "piano": self._generate_classical_piano,
                "guitar": self._generate_strings,
                "bass": self._generate_classical_bass,
                "drums": self._generate_orchestral_percussion
            }
        }
        
        self.emotion_tempo = {
            "happy": 1.2,
            "sad": 0.7,
            "energetic": 1.4
        }
    
    def generate_multi_track(self, input_notes: List[Dict], style: str, 
                            emotion: str, temperature: float = 1.0, 
                            num_bars: int = 16) -> Dict[str, List[Dict]]:
        """生成多轨道音乐"""
        start_time = time.time()
        
        tempo_factor = self.emotion_tempo.get(emotion, 1.0)
        
        tracks = {}
        
        for instrument in INSTRUMENTS.keys():
            generator = self.style_patterns.get(style, self.style_patterns["electronic"]).get(instrument)
            if generator:
                track_notes = generator(input_notes, tempo_factor, temperature, num_bars)
                tracks[instrument] = track_notes
        
        elapsed = time.time() - start_time
        print(f"Multi-track generated in {elapsed*1000:.2f}ms")
        
        return tracks
    
    def _generate_synth_pattern(self, input_notes: List[Dict], tempo_factor: float, 
                                temperature: float, num_bars: int) -> List[Dict]:
        """合成器旋律模式"""
        notes = []
        base_pitch = self._get_base_pitch(input_notes)
        rng = np.random.default_rng(hash(f"piano{temperature}") % 2**32)
        
        melody_intervals = [0, 2, 4, 5, 7, 9, 11, 12]
        current_time = 0.0
        bar_duration = 4.0 / tempo_factor
        
        for bar in range(num_bars):
            bar_start = bar * bar_duration
            notes_per_bar = int(8 * tempo_factor)
            
            for i in range(notes_per_bar):
                interval_idx = rng.integers(0, len(melody_intervals))
                pitch = base_pitch + melody_intervals[interval_idx]
                pitch = max(48, min(84, pitch))
                
                duration = (0.5 / tempo_factor) * rng.uniform(0.5, 1.5)
                velocity = rng.integers(60, 90)
                
                note_time = bar_start + (i * bar_duration / notes_per_bar)
                
                notes.append({
                    "pitch": int(pitch),
                    "start_time": float(note_time),
                    "duration": float(duration),
                    "velocity": int(velocity),
                    "channel": INSTRUMENTS["piano"]["channel"]
                })
                
                if rng.random() < 0.3 * temperature:
                    harmony_pitch = pitch + 4 if rng.random() > 0.5 else pitch + 7
                    notes.append({
                        "pitch": int(harmony_pitch),
                        "start_time": float(note_time),
                        "duration": float(duration),
                        "velocity": int(velocity - 10),
                        "channel": INSTRUMENTS["piano"]["channel"]
                    })
        
        return notes
    
    def _generate_chord_rhythm(self, input_notes: List[Dict], tempo_factor: float,
                               temperature: float, num_bars: int) -> List[Dict]:
        """吉他和弦节奏"""
        notes = []
        base_pitch = self._get_base_pitch(input_notes) - 12
        rng = np.random.default_rng(hash(f"guitar{temperature}") % 2**32)
        
        chord_tones = [0, 4, 7, 10]
        current_time = 0.0
        bar_duration = 4.0 / tempo_factor
        
        for bar in range(num_bars):
            bar_start = bar * bar_duration
            chord_root = (bar * 2) % 7
            
            strum_times = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
            strum_times = [t / tempo_factor for t in strum_times]
            
            for i, strum_time in enumerate(strum_times):
                if rng.random() < 0.8 or i % 2 == 0:
                    for interval in chord_tones:
                        pitch = base_pitch + chord_root + interval
                        pitch = max(36, min(72, pitch))
                        
                        velocity = rng.integers(50, 80) if i % 2 == 0 else rng.integers(40, 60)
                        
                        notes.append({
                            "pitch": int(pitch),
                            "start_time": float(bar_start + strum_time),
                            "duration": float(0.4 / tempo_factor),
                            "velocity": int(velocity),
                            "channel": INSTRUMENTS["guitar"]["channel"]
                        })
        
        return notes
    
    def _generate_bass_line(self, input_notes: List[Dict], tempo_factor: float,
                           temperature: float, num_bars: int) -> List[Dict]:
        """贝斯线"""
        notes = []
        base_pitch = self._get_base_pitch(input_notes) - 24
        rng = np.random.default_rng(hash(f"bass{temperature}") % 2**32)
        
        bass_intervals = [0, 5, 7, 12]
        bar_duration = 4.0 / tempo_factor
        
        for bar in range(num_bars):
            bar_start = bar * bar_duration
            
            beat_times = [0, 1, 2, 3]
            beat_times = [t / tempo_factor for t in beat_times]
            
            for i, beat_time in enumerate(beat_times):
                if rng.random() < 0.9 or i == 0:
                    interval_idx = rng.integers(0, len(bass_intervals))
                    pitch = base_pitch + bass_intervals[interval_idx]
                    pitch = max(24, min(48, pitch))
                    
                    duration = 0.8 / tempo_factor if i == 0 else 0.4 / tempo_factor
                    velocity = rng.integers(70, 100)
                    
                    notes.append({
                        "pitch": int(pitch),
                        "start_time": float(bar_start + beat_time),
                        "duration": float(duration),
                        "velocity": int(velocity),
                        "channel": INSTRUMENTS["bass"]["channel"]
                    })
        
        return notes
    
    def _generate_edm_drums(self, input_notes: List[Dict], tempo_factor: float,
                           temperature: float, num_bars: int) -> List[Dict]:
        """EDM鼓组"""
        notes = []
        rng = np.random.default_rng(hash(f"drums{temperature}") % 2**32)
        
        bar_duration = 4.0 / tempo_factor
        
        for bar in range(num_bars):
            bar_start = bar * bar_duration
            
            for beat in range(4):
                kick_time = bar_start + (beat / tempo_factor)
                notes.append({
                    "pitch": DRUM_NOTES["kick"],
                    "start_time": float(kick_time),
                    "duration": 0.1,
                    "velocity": 100 + rng.integers(-10, 10),
                    "channel": 9
                })
                
                if beat % 2 == 1:
                    snare_time = bar_start + (beat / tempo_factor)
                    notes.append({
                        "pitch": DRUM_NOTES["snare"],
                        "start_time": float(snare_time),
                        "duration": 0.1,
                        "velocity": 90 + rng.integers(-10, 10),
                        "channel": 9
                    })
            
            hihat_times = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
            for ht in hihat_times:
                hihat_time = bar_start + (ht / tempo_factor)
                is_open = rng.random() < 0.2 * temperature
                notes.append({
                    "pitch": DRUM_NOTES["hihat_open"] if is_open else DRUM_NOTES["hihat_closed"],
                    "start_time": float(hihat_time),
                    "duration": 0.05,
                    "velocity": 70 + rng.integers(-10, 15),
                    "channel": 9
                })
        
        return notes
    
    def _generate_jazz_piano(self, input_notes: List[Dict], tempo_factor: float,
                            temperature: float, num_bars: int) -> List[Dict]:
        """爵士钢琴"""
        notes = []
        base_pitch = self._get_base_pitch(input_notes)
        rng = np.random.default_rng(hash(f"jazz_piano{temperature}") % 2**32)
        
        chord_extensions = [0, 3, 7, 9, 10]
        bar_duration = 4.0 / tempo_factor
        
        for bar in range(num_bars):
            bar_start = bar * bar_duration
            chord_root = (bar * 3) % 12
            
            chord_pitches = [base_pitch + chord_root + i for i in chord_extensions]
            
            for pitch in chord_pitches:
                if 48 <= pitch <= 84:
                    notes.append({
                        "pitch": int(pitch),
                        "start_time": float(bar_start),
                        "duration": float(1.5 / tempo_factor),
                        "velocity": int(65 + rng.integers(-10, 10)),
                        "channel": INSTRUMENTS["piano"]["channel"]
                    })
            
            melody_times = rng.uniform(0, 4, int(6 * tempo_factor))
            for mt in melody_times:
                interval = rng.integers(-7, 12)
                pitch = base_pitch + 12 + interval
                if 60 <= pitch <= 84:
                    notes.append({
                        "pitch": int(pitch),
                        "start_time": float(bar_start + mt / tempo_factor),
                        "duration": float(rng.uniform(0.2, 0.8) / tempo_factor),
                        "velocity": int(75 + rng.integers(-15, 10)),
                        "channel": INSTRUMENTS["piano"]["channel"]
                    })
        
        return notes
    
    def _generate_jazz_guitar(self, input_notes: List[Dict], tempo_factor: float,
                             temperature: float, num_bars: int) -> List[Dict]:
        """爵士吉他"""
        notes = []
        base_pitch = self._get_base_pitch(input_notes) - 12
        rng = np.random.default_rng(hash(f"jazz_guitar{temperature}") % 2**32)
        
        chord_tones = [0, 7, 10, 15]
        bar_duration = 4.0 / tempo_factor
        
        for bar in range(num_bars):
            bar_start = bar * bar_duration
            chord_root = (bar * 2) % 12
            
            comping_times = [0, 0.75, 1.5, 2.25, 3, 3.5]
            for ct in comping_times:
                if rng.random() < 0.7:
                    for interval in chord_tones:
                        pitch = base_pitch + chord_root + interval
                        if 40 <= pitch <= 72:
                            notes.append({
                                "pitch": int(pitch),
                                "start_time": float(bar_start + ct / tempo_factor),
                                "duration": float(rng.uniform(0.3, 0.6) / tempo_factor),
                                "velocity": int(55 + rng.integers(-10, 15)),
                                "channel": INSTRUMENTS["guitar"]["channel"]
                            })
        
        return notes
    
    def _generate_jazz_bass(self, input_notes: List[Dict], tempo_factor: float,
                           temperature: float, num_bars: int) -> List[Dict]:
        """爵士贝斯"""
        notes = []
        base_pitch = self._get_base_pitch(input_notes) - 24
        rng = np.random.default_rng(hash(f"jazz_bass{temperature}") % 2**32)
        
        walking_intervals = [0, 2, 4, 5, 7, 9, 11, 12]
        bar_duration = 4.0 / tempo_factor
        
        for bar in range(num_bars):
            bar_start = bar * bar_duration
            
            for beat in range(4):
                interval_idx = (bar * 4 + beat) % len(walking_intervals)
                pitch = base_pitch + walking_intervals[interval_idx]
                pitch = max(28, min(48, pitch))
                
                velocity = 80 if beat == 0 else 65
                duration = 0.9 / tempo_factor
                
                notes.append({
                    "pitch": int(pitch),
                    "start_time": float(bar_start + beat / tempo_factor),
                    "duration": float(duration),
                    "velocity": int(velocity + rng.integers(-8, 8)),
                    "channel": INSTRUMENTS["bass"]["channel"]
                })
        
        return notes
    
    def _generate_jazz_drums(self, input_notes: List[Dict], tempo_factor: float,
                            temperature: float, num_bars: int) -> List[Dict]:
        """爵士鼓"""
        notes = []
        rng = np.random.default_rng(hash(f"jazz_drums{temperature}") % 2**32)
        
        bar_duration = 4.0 / tempo_factor
        
        for bar in range(num_bars):
            bar_start = bar * bar_duration
            
            for beat in range(4):
                if beat % 2 == 1:
                    notes.append({
                        "pitch": DRUM_NOTES["ride"],
                        "start_time": float(bar_start + beat / tempo_factor),
                        "duration": 0.1,
                        "velocity": 75 + rng.integers(-10, 10),
                        "channel": 9
                    })
                
                if beat == 0 or beat == 2:
                    notes.append({
                        "pitch": DRUM_NOTES["hihat_closed"],
                        "start_time": float(bar_start + beat / tempo_factor + 0.02),
                        "duration": 0.05,
                        "velocity": 60 + rng.integers(-10, 10),
                        "channel": 9
                    })
            
            hihat_times = [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75]
            for ht in hihat_times:
                notes.append({
                    "pitch": DRUM_NOTES["hihat_closed"],
                    "start_time": float(bar_start + ht / tempo_factor),
                    "duration": 0.05,
                    "velocity": 50 + rng.integers(-5, 15),
                    "channel": 9
                })
            
            if rng.random() < 0.4 * temperature:
                snare_time = bar_start + rng.uniform(1.5, 3.5) / tempo_factor
                notes.append({
                    "pitch": DRUM_NOTES["snare"],
                    "start_time": float(snare_time),
                    "duration": 0.1,
                    "velocity": 65 + rng.integers(-10, 15),
                    "channel": 9
                })
        
        return notes
    
    def _generate_classical_piano(self, input_notes: List[Dict], tempo_factor: float,
                                  temperature: float, num_bars: int) -> List[Dict]:
        """古典钢琴"""
        notes = []
        base_pitch = self._get_base_pitch(input_notes)
        rng = np.random.default_rng(hash(f"classical_piano{temperature}") % 2**32)
        
        scale = [0, 2, 4, 5, 7, 9, 11]
        bar_duration = 4.0 / tempo_factor
        
        for bar in range(num_bars):
            bar_start = bar * bar_duration
            phrase_length = int(8 * tempo_factor)
            
            for i in range(phrase_length):
                interval_idx = (bar * phrase_length + i) % len(scale)
                pitch = base_pitch + 12 + scale[interval_idx]
                
                if i % 4 == 0:
                    chord_pitches = [pitch - 12, pitch - 8, pitch - 5]
                    for cp in chord_pitches:
                        if 36 <= cp <= 72:
                            notes.append({
                                "pitch": int(cp),
                                "start_time": float(bar_start + i / tempo_factor / 2),
                                "duration": float(2.0 / tempo_factor),
                                "velocity": int(60 + rng.integers(-10, 10)),
                                "channel": INSTRUMENTS["piano"]["channel"]
                            })
                
                if 54 <= pitch <= 84:
                    notes.append({
                        "pitch": int(pitch),
                        "start_time": float(bar_start + i / tempo_factor / 2),
                        "duration": float(rng.uniform(0.3, 0.8) / tempo_factor),
                        "velocity": int(70 + rng.integers(-15, 10)),
                        "channel": INSTRUMENTS["piano"]["channel"]
                    })
        
        return notes
    
    def _generate_strings(self, input_notes: List[Dict], tempo_factor: float,
                         temperature: float, num_bars: int) -> List[Dict]:
        """弦乐/吉他"""
        notes = []
        base_pitch = self._get_base_pitch(input_notes) - 12
        rng = np.random.default_rng(hash(f"strings{temperature}") % 2**32)
        
        chord_intervals = [0, 4, 7, 12]
        bar_duration = 4.0 / tempo_factor
        
        for bar in range(0, num_bars, 2):
            bar_start = bar * bar_duration
            chord_root = (bar // 2 * 5) % 12
            
            for interval in chord_intervals:
                pitch = base_pitch + chord_root + interval
                if 36 <= pitch <= 72:
                    notes.append({
                        "pitch": int(pitch),
                        "start_time": float(bar_start),
                        "duration": float(7.5 / tempo_factor),
                        "velocity": int(55 + rng.integers(-10, 15)),
                        "channel": INSTRUMENTS["guitar"]["channel"]
                    })
        
        return notes
    
    def _generate_classical_bass(self, input_notes: List[Dict], tempo_factor: float,
                                temperature: float, num_bars: int) -> List[Dict]:
        """古典贝斯"""
        notes = []
        base_pitch = self._get_base_pitch(input_notes) - 24
        rng = np.random.default_rng(hash(f"classical_bass{temperature}") % 2**32)
        
        bar_duration = 4.0 / tempo_factor
        
        for bar in range(num_bars):
            bar_start = bar * bar_duration
            chord_root = (bar * 4) % 12
            
            pitch = base_pitch + chord_root
            pitch = max(24, min(40, pitch))
            
            notes.append({
                "pitch": int(pitch),
                "start_time": float(bar_start),
                "duration": float(3.8 / tempo_factor),
                "velocity": int(65 + rng.integers(-10, 10)),
                "channel": INSTRUMENTS["bass"]["channel"]
            })
        
        return notes
    
    def _generate_orchestral_percussion(self, input_notes: List[Dict], tempo_factor: float,
                                        temperature: float, num_bars: int) -> List[Dict]:
        """管弦乐打击乐"""
        notes = []
        rng = np.random.default_rng(hash(f"percussion{temperature}") % 2**32)
        
        bar_duration = 4.0 / tempo_factor
        
        for bar in range(num_bars):
            bar_start = bar * bar_duration
            
            if bar % 4 == 0:
                notes.append({
                    "pitch": DRUM_NOTES["crash"],
                    "start_time": float(bar_start),
                    "duration": 0.5,
                    "velocity": 100,
                    "channel": 9
                })
            
            if bar % 2 == 0:
                notes.append({
                    "pitch": DRUM_NOTES["tom_low"],
                    "start_time": float(bar_start + 3.5 / tempo_factor),
                    "duration": 0.2,
                    "velocity": 75 + rng.integers(-10, 10),
                    "channel": 9
                })
        
        return notes
    
    def _get_base_pitch(self, input_notes: List[Dict]) -> int:
        if input_notes:
            return int(np.mean([n["pitch"] for n in input_notes]))
        return 60


def create_multi_track_midi(tracks: Dict[str, List[Dict]], 
                            track_volumes: Dict[str, int] = None,
                            muted_tracks: List[str] = None) -> bytes:
    """创建多轨MIDI文件"""
    if track_volumes is None:
        track_volumes = {k: 100 for k in tracks.keys()}
    
    if muted_tracks is None:
        muted_tracks = []
    
    midi_data = bytearray()
    
    midi_data.extend(b'MThd')
    midi_data.extend(struct.pack('>I', 6))
    midi_data.extend(struct.pack('>HHH', 1, len(tracks) + 1, 480))
    
    tempo_track = bytearray()
    tempo_track.extend([0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20])
    tempo_track.extend([0xFF, 0x58, 0x04, 0x04, 0x04, 0x18, 0x08])
    tempo_track.extend([0x00, 0xFF, 0x2F, 0x00])
    
    midi_data.extend(b'MTrk')
    midi_data.extend(struct.pack('>I', len(tempo_track)))
    midi_data.extend(tempo_track)
    
    for instrument, notes in tracks.items():
        if instrument in muted_tracks:
            continue
        
        track_data = bytearray()
        
        program = INSTRUMENTS[instrument]["midi_program"]
        channel = INSTRUMENTS[instrument]["channel"]
        
        track_data.extend([0x00, 0xC0 | channel, program])
        
        volume = track_volumes.get(instrument, 100)
        track_data.extend([0x00, 0xB0 | channel, 7, volume])
        
        note_events = []
        for note in notes:
            start_tick = int(note["start_time"] * 480)
            end_tick = int((note["start_time"] + note["duration"]) * 480)
            pitch = note["pitch"]
            velocity = note.get("velocity", 80)
            note_channel = note.get("channel", channel)
            
            note_events.append((start_tick, 0x90 | note_channel, pitch, velocity))
            note_events.append((end_tick, 0x80 | note_channel, pitch, 0))
        
        note_events.sort(key=lambda x: x[0])
        
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


multi_track_generator = MultiTrackGenerator()
