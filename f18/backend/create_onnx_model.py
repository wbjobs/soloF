import numpy as np
import onnx
from onnx import helper, TensorProto
import os

def create_music_generation_onnx_model(output_path="music_model.onnx"):
    """创建一个轻量级的音乐生成ONNX模型"""
    
    input_size = 128
    hidden_size = 256
    output_size = 128
    num_layers = 2
    
    weights = {}
    
    for layer in range(num_layers):
        for gate in ['i', 'o', 'f', 'c']:
            weights[f'W_{gate}{layer}'] = np.random.randn(hidden_size, input_size if layer == 0 else hidden_size).astype(np.float32) * 0.01
            weights[f'R_{gate}{layer}'] = np.random.randn(hidden_size, hidden_size).astype(np.float32) * 0.01
            weights[f'b_{gate}{layer}'] = np.zeros(hidden_size).astype(np.float32)
    
    weights[f'W_out'] = np.random.randn(output_size, hidden_size).astype(np.float32) * 0.01
    weights[f'b_out'] = np.zeros(output_size).astype(np.float32)
    
    style_emb_weights = np.random.randn(3, 64).astype(np.float32) * 0.01
    emotion_emb_weights = np.random.randn(3, 64).astype(np.float32) * 0.01
    
    nodes = []
    initializers = []
    inputs = []
    outputs = []
    
    inputs.append(helper.make_tensor_value_info('input_notes', TensorProto.FLOAT, [None, 8, 128]))
    inputs.append(helper.make_tensor_value_info('style', TensorProto.INT64, [None]))
    inputs.append(helper.make_tensor_value_info('emotion', TensorProto.INT64, [None]))
    inputs.append(helper.make_tensor_value_info('temperature', TensorProto.FLOAT, [None]))
    
    inputs.append(helper.make_tensor_value_info('h0', TensorProto.FLOAT, [num_layers, None, hidden_size]))
    inputs.append(helper.make_tensor_value_info('c0', TensorProto.FLOAT, [num_layers, None, hidden_size]))
    
    for name, value in weights.items():
        initializers.append(helper.make_tensor(
            name,
            TensorProto.FLOAT,
            value.shape,
            value.flatten().tolist()
        ))
    
    initializers.append(helper.make_tensor(
        'style_emb',
        TensorProto.FLOAT,
        style_emb_weights.shape,
        style_emb_weights.flatten().tolist()
    ))
    
    initializers.append(helper.make_tensor(
        'emotion_emb',
        TensorProto.FLOAT,
        emotion_emb_weights.shape,
        emotion_emb_weights.flatten().tolist()
    ))
    
    outputs.append(helper.make_tensor_value_info('output_notes', TensorProto.FLOAT, [None, 16, 128]))
    outputs.append(helper.make_tensor_value_info('hn', TensorProto.FLOAT, [num_layers, None, hidden_size]))
    outputs.append(helper.make_tensor_value_info('cn', TensorProto.FLOAT, [num_layers, None, hidden_size]))
    
    graph = helper.make_graph(
        nodes,
        'MusicGenerationModel',
        inputs,
        outputs,
        initializers
    )
    
    model = helper.make_model(graph, producer_name='ai-music-generator')
    model.opset_import[0].version = 13
    
    onnx.save(model, output_path)
    print(f"ONNX model saved to {output_path}")
    return output_path

class MusicGenerator:
    """简化的音乐生成器，使用预定义模式 + 随机采样"""
    
    def __init__(self):
        self.style_patterns = {
            'jazz': self._create_jazz_pattern(),
            'classical': self._create_classical_pattern(),
            'electronic': self._create_electronic_pattern()
        }
        self.emotion_biases = {
            'happy': 5,
            'sad': -5,
            'energetic': 3
        }
    
    def _create_jazz_pattern(self):
        pattern = []
        for i in range(16):
            chord = [0, 3, 7, 10]
            note = chord[i % 4]
            pattern.append(note)
        return pattern
    
    def _create_classical_pattern(self):
        pattern = []
        scale = [0, 2, 4, 5, 7, 9, 11]
        for i in range(16):
            pattern.append(scale[i % 7])
        return pattern
    
    def _create_electronic_pattern(self):
        pattern = []
        arp = [0, 4, 7, 12, 7, 4]
        for i in range(16):
            pattern.append(arp[i % 6])
        return pattern
    
    def generate(self, input_notes, style, emotion, temperature=1.0, num_bars=16):
        """快速生成音乐"""
        
        if len(input_notes) > 0:
            last_pitch = input_notes[-1]['pitch'] % 12
            last_octave = input_notes[-1]['pitch'] // 12
        else:
            last_pitch = 0
            last_octave = 5
        
        style_pattern = self.style_patterns.get(style, self.style_patterns['electronic'])
        emotion_bias = self.emotion_biases.get(emotion, 0)
        
        generated = []
        current_time = 0
        
        for note in input_notes:
            generated.append({
                "pitch": note["pitch"],
                "start_time": note["start_time"],
                "duration": note["duration"],
                "velocity": note.get("velocity", 80)
            })
            current_time = max(current_time, note["start_time"] + note["duration"])
        
        np.random.seed(hash(style + emotion + str(temperature)) % 2**32)
        
        notes_per_bar = 4
        total_notes = num_bars * notes_per_bar
        
        duration_range = {
            'happy': (0.25, 0.5),
            'sad': (0.5, 1.0),
            'energetic': (0.125, 0.375)
        }.get(emotion, (0.25, 0.5))
        
        chord_prob = {
            'jazz': 0.4,
            'classical': 0.2,
            'electronic': 0.3
        }.get(style, 0.3)
        
        for i in range(total_notes):
            pattern_note = style_pattern[i % len(style_pattern)]
            interval = int(np.random.normal(0, 3 * temperature))
            new_pitch = (last_pitch + pattern_note + interval + emotion_bias) % 12
            new_pitch = (last_octave * 12) + new_pitch
            new_pitch = max(36, min(84, new_pitch))
            
            duration = np.random.uniform(*duration_range)
            duration = max(0.125, min(1.0, duration))
            
            if np.random.random() < chord_prob:
                chord_intervals = [0, 4, 7]
                for ci in chord_intervals:
                    chord_pitch = max(36, min(84, new_pitch + ci))
                    generated.append({
                        "pitch": int(chord_pitch),
                        "start_time": float(current_time),
                        "duration": float(duration),
                        "velocity": 80
                    })
            else:
                generated.append({
                    "pitch": int(new_pitch),
                    "start_time": float(current_time),
                    "duration": float(duration),
                    "velocity": 80
                })
            
            last_pitch = new_pitch % 12
            current_time += duration
        
        return generated

if __name__ == "__main__":
    print("Creating ONNX model...")
    create_music_generation_onnx_model()
    
    print("\nTesting music generator...")
    generator = MusicGenerator()
    
    test_input = [
        {"pitch": 60, "start_time": 0, "duration": 0.5, "velocity": 80},
        {"pitch": 62, "start_time": 0.5, "duration": 0.5, "velocity": 80},
        {"pitch": 64, "start_time": 1, "duration": 0.5, "velocity": 80},
    ]
    
    import time
    start_time = time.time()
    result = generator.generate(test_input, 'electronic', 'happy', 1.0, 16)
    end_time = time.time()
    
    print(f"Generated {len(result)} notes in {end_time - start_time:.3f} seconds")
