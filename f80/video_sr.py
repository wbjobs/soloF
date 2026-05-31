#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import argparse
import os
import sys
import subprocess
import numpy as np
from multiprocessing import Process, Queue, cpu_count, Value
from queue import Empty
import threading
import time
import tempfile
import shutil
from ctypes import c_int

import onnxruntime as ort
from tqdm import tqdm


def check_ffmpeg():
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        subprocess.run(['ffprobe', '-version'], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def get_video_info(input_path):
    import json
    cmd = [
        'ffprobe', '-v', 'quiet',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate,duration,nb_frames,pix_fmt',
        '-of', 'json', input_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    info = json.loads(result.stdout)
    stream = info['streams'][0]
    
    fps_parts = stream['r_frame_rate'].split('/')
    fps = float(fps_parts[0]) / float(fps_parts[1]) if len(fps_parts) > 1 else float(fps_parts[0])
    
    return {
        'width': int(stream['width']),
        'height': int(stream['height']),
        'fps': fps,
        'duration': float(stream.get('duration', 0)),
        'nb_frames': int(stream.get('nb_frames', 0)),
        'pix_fmt': stream.get('pix_fmt', 'yuv420p')
    }


def has_audio(input_path):
    import json
    cmd = [
        'ffprobe', '-v', 'quiet',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_type',
        '-of', 'json', input_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    info = json.loads(result.stdout)
    return len(info.get('streams', [])) > 0


def extract_audio(input_path, output_audio_path):
    cmd = [
        'ffmpeg', '-y', '-v', 'quiet',
        '-i', input_path,
        '-vn', '-acodec', 'copy',
        output_audio_path
    ]
    subprocess.run(cmd, check=True)


def merge_audio_video(video_path, audio_path, output_path, crf, preset):
    cmd = [
        'ffmpeg', '-y', '-v', 'quiet',
        '-i', video_path, '-i', audio_path,
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k',
        '-vsync', '1', '-async', '1',
        '-shortest',
        output_path
    ]
    subprocess.run(cmd, check=True)


def compute_frame_complexity(frame, prev_frame=None):
    if prev_frame is None:
        gray = np.mean(frame, axis=2).astype(np.float32)
        laplacian = np.abs(np.gradient(gray)[0]) + np.abs(np.gradient(gray)[1])
        texture_score = np.mean(laplacian)
        
        hist, _ = np.histogram(frame.flatten(), bins=32, range=(0, 256))
        hist = hist / hist.sum()
        entropy = -np.sum(hist * np.log2(hist + 1e-10))
        
        return (texture_score * 0.5 + entropy * 5.0) / 5.0
    
    diff = np.abs(frame.astype(np.float32) - prev_frame.astype(np.float32))
    motion_score = np.mean(diff) / 255.0 * 100.0
    
    gray = np.mean(frame, axis=2).astype(np.float32)
    laplacian = np.abs(np.gradient(gray)[0]) + np.abs(np.gradient(gray)[1])
    texture_score = np.mean(laplacian)
    
    hist, _ = np.histogram(frame.flatten(), bins=32, range=(0, 256))
    hist = hist / hist.sum()
    entropy = -np.sum(hist * np.log2(hist + 1e-10))
    
    complexity = (motion_score * 0.4 + texture_score * 0.3 + entropy * 2.0) / 3.0
    return complexity


class ESRGANInferencer:
    def __init__(self, model_path, use_gpu=True, device_id=0, patch_size=256, overlap=32):
        self.model_path = model_path
        self.use_gpu = use_gpu
        self.device_id = device_id
        self.session = None
        self.input_name = None
        self.output_name = None
        self.scale = 4
        self.patch_size = patch_size
        self.overlap = overlap

    def load_model(self):
        providers = []
        if self.use_gpu:
            providers.append(('CUDAExecutionProvider', {
                'device_id': self.device_id,
                'arena_extend_strategy': 'kNextPowerOfTwo',
                'gpu_mem_limit': 4 * 1024 * 1024 * 1024,
                'cudnn_conv_algo_search': 'DEFAULT',
                'do_copy_in_default_stream': True,
                'cudnn_conv_use_max_workspace': '0',
            }))
        providers.append('CPUExecutionProvider')

        sess_options = ort.SessionOptions()
        sess_options.log_severity_level = 3
        sess_options.enable_mem_pattern = True
        sess_options.enable_cpu_mem_arena = True

        self.session = ort.InferenceSession(
            self.model_path,
            providers=providers,
            sess_options=sess_options
        )
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name

    def preprocess(self, frame):
        frame = frame.astype(np.float32) / 255.0
        frame = np.transpose(frame, (2, 0, 1))
        frame = np.expand_dims(frame, axis=0)
        return frame

    def postprocess(self, output):
        output = np.squeeze(output, axis=0)
        output = np.transpose(output, (1, 2, 0))
        output = np.clip(output, 0, 1)
        output = (output * 255.0).astype(np.uint8)
        return output

    def _infer_patch(self, patch):
        preprocessed = self.preprocess(patch)
        output = self.session.run([self.output_name], {self.input_name: preprocessed})[0]
        return self.postprocess(output)

    def _extract_patches(self, frame):
        h, w, _ = frame.shape
        stride = self.patch_size - self.overlap
        patches = []
        coords = []

        for y in range(0, h, stride):
            for x in range(0, w, stride):
                y_end = min(y + self.patch_size, h)
                x_end = min(x + self.patch_size, w)
                y_start = y_end - self.patch_size if y_end - self.patch_size >= 0 else 0
                x_start = x_end - self.patch_size if x_end - self.patch_size >= 0 else 0
                
                patch = frame[y_start:y_start + self.patch_size, x_start:x_start + self.patch_size]
                patches.append(patch)
                coords.append((y_start, x_start, y_end - y_start, x_end - x_start))

        return patches, coords, h, w

    def _merge_patches(self, sr_patches, coords, h, w):
        scale = self.scale
        output_h, output_w = h * scale, w * scale
        output = np.zeros((output_h, output_w, 3), dtype=np.float32)
        weight = np.zeros((output_h, output_w, 3), dtype=np.float32)

        for (y, x, ph, pw), sr_patch in zip(coords, sr_patches):
            y_sr = y * scale
            x_sr = x * scale
            ph_sr = ph * scale
            pw_sr = pw * scale

            y1, y2 = y_sr, y_sr + ph_sr
            x1, x2 = x_sr, x_sr + pw_sr

            patch_h, patch_w, _ = sr_patch.shape
            if patch_h != ph_sr or patch_w != pw_sr:
                sr_patch = sr_patch[:ph_sr, :pw_sr]

            wy = np.ones((ph_sr, pw_sr, 1), dtype=np.float32)
            border = self.overlap * scale
            if border > 0:
                for i in range(min(border, ph_sr)):
                    wy[i, :] *= (i + 1) / (border + 1)
                    wy[-(i + 1), :] *= (i + 1) / (border + 1)
                for j in range(min(border, pw_sr)):
                    wx = (j + 1) / (border + 1)
                    wy[:, j] *= wx
                    wy[:, -(j + 1)] *= wx

            output[y1:y2, x1:x2] += sr_patch.astype(np.float32) * wy
            weight[y1:y2, x1:x2] += wy

        weight[weight == 0] = 1
        output = output / weight
        return np.clip(output, 0, 255).astype(np.uint8)

    def infer(self, frame):
        h, w, _ = frame.shape
        max_dim = max(h, w)
        
        if max_dim <= self.patch_size:
            return self._infer_patch(frame)

        patches, coords, h_orig, w_orig = self._extract_patches(frame)
        sr_patches = []
        for patch in patches:
            sr_patch = self._infer_patch(patch)
            sr_patches.append(sr_patch)

        return self._merge_patches(sr_patches, coords, h_orig, w_orig)


class DualModelInferencer:
    def __init__(self, hq_model_path, fast_model_path, use_gpu=True, device_id=0, 
                 patch_size=256, overlap=32, complexity_threshold=15.0):
        self.hq_model_path = hq_model_path
        self.fast_model_path = fast_model_path
        self.use_gpu = use_gpu
        self.device_id = device_id
        self.patch_size = patch_size
        self.overlap = overlap
        self.complexity_threshold = complexity_threshold
        
        self.hq_inferencer = None
        self.fast_inferencer = None
        self.use_dual_model = fast_model_path is not None and fast_model_path != hq_model_path

    def load_models(self):
        if self.use_dual_model:
            self.hq_inferencer = ESRGANInferencer(
                self.hq_model_path, self.use_gpu, self.device_id, 
                self.patch_size, self.overlap
            )
            self.hq_inferencer.load_model()
            
            self.fast_inferencer = ESRGANInferencer(
                self.fast_model_path, self.use_gpu, self.device_id,
                self.patch_size, self.overlap
            )
            self.fast_inferencer.load_model()
        else:
            self.hq_inferencer = ESRGANInferencer(
                self.hq_model_path, self.use_gpu, self.device_id,
                self.patch_size, self.overlap
            )
            self.hq_inferencer.load_model()

    def infer(self, frame, complexity=None):
        if self.use_dual_model and complexity is not None:
            if complexity >= self.complexity_threshold:
                return self.hq_inferencer.infer(frame), 'HQ'
            else:
                return self.fast_inferencer.infer(frame), 'FAST'
        else:
            return self.hq_inferencer.infer(frame), 'HQ'


def worker_process(input_queue, output_queue, hq_model_path, fast_model_path, 
                   use_gpu, device_id, patch_size, overlap, complexity_threshold):
    inferencer = DualModelInferencer(
        hq_model_path, fast_model_path, use_gpu, device_id,
        patch_size, overlap, complexity_threshold
    )
    inferencer.load_models()

    while True:
        item = input_queue.get()
        if item is None:
            input_queue.put(None)
            break
        frame_idx, frame, complexity = item
        try:
            sr_frame, model_type = inferencer.infer(frame, complexity)
            output_queue.put((frame_idx, sr_frame, model_type))
        except Exception as e:
            print(f"\n[ERROR] Frame {frame_idx}: {e}", file=sys.stderr)
            output_queue.put((frame_idx, None, 'ERROR'))


def ordered_writer_process(output_queue, output_path, output_width, output_height, 
                           fps, total_frames, crf, preset, hq_count, fast_count):
    cmd = [
        'ffmpeg', '-y', '-v', 'quiet',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24',
        '-s', f'{output_width}x{output_height}',
        '-r', str(fps), '-i', '-',
        '-c:v', 'libx264', '-crf', str(crf),
        '-preset', preset,
        '-pix_fmt', 'yuv420p',
        '-vsync', '1',
        output_path
    ]
    process = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=10**8
    )

    buffer = {}
    next_idx = 0
    written = 0
    error_occurred = False
    local_hq = 0
    local_fast = 0

    pbar = tqdm(total=total_frames, desc="Processing", unit="frame", position=0, leave=True,
                bar_format='{l_bar}{bar:30}{r_bar}{bar:-30b}')

    while True:
        try:
            item = output_queue.get(timeout=30)
            if item is None:
                break
            frame_idx, sr_frame, model_type = item

            if model_type == 'HQ':
                local_hq += 1
            elif model_type == 'FAST':
                local_fast += 1

            if sr_frame is None:
                next_idx += 1
                pbar.update(1)
                written += 1
                continue

            buffer[frame_idx] = (sr_frame, model_type)

            while next_idx in buffer:
                frame, mtype = buffer.pop(next_idx)
                try:
                    if not error_occurred:
                        process.stdin.write(frame.tobytes())
                    written += 1
                except BrokenPipeError:
                    if not error_occurred:
                        error_occurred = True
                        stderr_output = process.stderr.read().decode('utf-8', errors='ignore')
                        print(f"\n[ERROR] FFmpeg encoder error: {stderr_output[:500]}", file=sys.stderr)
                next_idx += 1
                pbar.update(1)

            total_done = local_hq + local_fast
            if total_done > 0:
                hq_pct = local_hq / total_done * 100
                fast_pct = local_fast / total_done * 100
                pbar.set_postfix_str(f"HQ:{local_hq}({hq_pct:.0f}%) FAST:{local_fast}({fast_pct:.0f}%)")

        except Empty:
            print("\n[WARNING] Output queue timeout, checking if workers are still alive...", file=sys.stderr)
            continue
        except Exception as e:
            print(f"\n[ERROR] Writer error: {e}", file=sys.stderr)
            break

    pbar.close()

    for idx in sorted(buffer.keys()):
        if idx >= next_idx:
            frame, _ = buffer[idx]
            try:
                if not error_occurred:
                    process.stdin.write(frame.tobytes())
                written += 1
            except BrokenPipeError:
                break

    try:
        process.stdin.close()
    except:
        pass

    try:
        retcode = process.wait(timeout=30)
        if retcode != 0 and not error_occurred:
            stderr_output = process.stderr.read().decode('utf-8', errors='ignore')
            print(f"\n[WARNING] FFmpeg exited with code {retcode}: {stderr_output[:300]}", file=sys.stderr)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()

    hq_count.value = local_hq
    fast_count.value = local_fast


def main():
    parser = argparse.ArgumentParser(
        description='Video Super-Resolution using ESRGAN and ONNX Runtime',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('-i', '--input', required=True, help='Input video file path')
    parser.add_argument('-o', '--output', required=True, help='Output video file path')
    parser.add_argument('-m', '--model', required=True, help='High-quality ESRGAN ONNX model path')
    parser.add_argument('--fast-model', type=str, default=None, 
                        help='Fast ESRGAN ONNX model path for low-complexity frames (enables dynamic switching)')
    parser.add_argument('--complexity-threshold', type=float, default=15.0,
                        help='Complexity threshold for model switching (default: 15.0, higher = more HQ frames)')
    parser.add_argument('--scale', type=int, default=4, choices=[2, 4, 8], help='Super resolution scale factor (default: 4)')
    parser.add_argument('--gpu', action='store_true', default=True, help='Use GPU for inference (default: True)')
    parser.add_argument('--no-gpu', action='store_false', dest='gpu', help='Disable GPU, use CPU only')
    parser.add_argument('--device-id', type=int, default=0, help='GPU device ID (default: 0)')
    parser.add_argument('--num-workers', type=int, default=None, help='Number of inference workers (default: auto)')
    parser.add_argument('--crf', type=int, default=18, help='Output video CRF quality (default: 18)')
    parser.add_argument('--preset', type=str, default='medium', 
                        choices=['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'],
                        help='Encoder preset (default: medium)')
    parser.add_argument('--max-queue-size', type=int, default=8, help='Maximum frame queue size (default: 8)')
    parser.add_argument('--patch-size', type=int, default=256, help='Patch size for tiled inference (default: 256)')
    parser.add_argument('--overlap', type=int, default=32, help='Overlap between patches (default: 32)')
    parser.add_argument('--skip-audio', action='store_true', help='Skip audio extraction and merging')
    parser.add_argument('--complexity-subsample', type=int, default=1,
                        help='Subsample rate for complexity calculation (1=every frame, 2=every other frame)')

    args = parser.parse_args()

    if not check_ffmpeg():
        print("Error: ffmpeg and ffprobe are required. Please install them first.", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.input):
        print(f"Error: Input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.model):
        print(f"Error: Model file not found: {args.model}", file=sys.stderr)
        sys.exit(1)

    if args.fast_model and not os.path.exists(args.fast_model):
        print(f"Error: Fast model file not found: {args.fast_model}", file=sys.stderr)
        sys.exit(1)

    print("=" * 60)
    print("Video Super-Resolution with ESRGAN")
    print("=" * 60)

    print(f"\n[INFO] Analyzing input video: {args.input}")
    video_info = get_video_info(args.input)
    print(f"  - Resolution: {video_info['width']}x{video_info['height']}")
    print(f"  - FPS: {video_info['fps']:.4f}")
    print(f"  - Duration: {video_info['duration']:.2f}s")
    if video_info['nb_frames'] > 0:
        print(f"  - Frames: {video_info['nb_frames']}")
    print(f"  - Pixel format: {video_info['pix_fmt']}")

    audio_present = has_audio(args.input) and not args.skip_audio
    if audio_present:
        print(f"  - Audio: detected")
    else:
        print(f"  - Audio: not present or skipped")

    output_width = video_info['width'] * args.scale
    output_height = video_info['height'] * args.scale
    print(f"\n[INFO] Output resolution: {output_width}x{output_height} ({args.scale}x)")
    print(f"[INFO] Patch size: {args.patch_size}x{args.patch_size}, overlap: {args.overlap}")

    input_pixels = video_info['width'] * video_info['height']
    patch_pixels = args.patch_size * args.patch_size
    patches_per_frame = max(1, int(np.ceil(input_pixels / patch_pixels)) * 4)
    print(f"[INFO] Estimated patches per frame: {patches_per_frame}")

    if args.fast_model:
        print(f"\n[INFO] Dynamic model switching enabled")
        print(f"  - HQ model: {os.path.basename(args.model)}")
        print(f"  - Fast model: {os.path.basename(args.fast_model)}")
        print(f"  - Complexity threshold: {args.complexity_threshold}")
    else:
        print(f"\n[INFO] Single model mode: {os.path.basename(args.model)}")

    if args.num_workers is None:
        if args.gpu:
            num_workers = 1
        else:
            num_workers = max(1, cpu_count() // 2)
    else:
        num_workers = args.num_workers

    if args.gpu and num_workers > 1:
        print(f"[WARNING] Multiple GPU workers may cause VRAM contention. Using {num_workers} workers.")
    print(f"[INFO] Using {num_workers} inference workers")

    if args.gpu:
        available_providers = ort.get_available_providers()
        if 'CUDAExecutionProvider' in available_providers:
            print(f"[INFO] GPU acceleration enabled (device {args.device_id})")
        else:
            print("[WARNING] CUDA provider not available, falling back to CPU")
            args.gpu = False
    else:
        print("[INFO] Using CPU for inference")

    input_queue = Queue(maxsize=args.max_queue_size)
    output_queue = Queue(maxsize=args.max_queue_size)

    total_frames = video_info['nb_frames'] if video_info['nb_frames'] > 0 else int(video_info['duration'] * video_info['fps'])

    hq_count = Value(c_int, 0)
    fast_count = Value(c_int, 0)

    temp_dir = tempfile.mkdtemp(prefix='video_sr_')
    temp_video_path = os.path.join(temp_dir, 'temp_video.mp4')
    temp_audio_path = os.path.join(temp_dir, 'temp_audio.aac')

    try:
        if audio_present:
            print(f"\n[INFO] Extracting audio track...")
            extract_audio(args.input, temp_audio_path)
            print(f"[INFO] Audio extracted to temporary file")

        print(f"\n[INFO] Starting processing...")
        start_time = time.time()

        decoder_process = subprocess.Popen(
            ['ffmpeg', '-v', 'quiet', '-i', args.input, 
             '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=10**8
        )

        def decode_thread():
            frame_idx = 0
            frame_size = video_info['width'] * video_info['height'] * 3
            prev_frame = None
            
            while True:
                raw_frame = decoder_process.stdout.read(frame_size)
                if not raw_frame:
                    break
                if len(raw_frame) != frame_size:
                    break
                frame = np.frombuffer(raw_frame, dtype=np.uint8).reshape((video_info['height'], video_info['width'], 3))
                
                if frame_idx % args.complexity_subsample == 0:
                    complexity = compute_frame_complexity(frame, prev_frame)
                else:
                    complexity = None
                
                try:
                    input_queue.put((frame_idx, frame, complexity), timeout=60)
                except:
                    print(f"\n[WARNING] Input queue full, dropping frame {frame_idx}", file=sys.stderr)
                
                prev_frame = frame
                frame_idx += 1
            
            for _ in range(num_workers):
                try:
                    input_queue.put(None, timeout=10)
                except:
                    pass

        decode_t = threading.Thread(target=decode_thread)
        decode_t.daemon = True
        decode_t.start()

        workers = []
        for i in range(num_workers):
            device_id = args.device_id if args.gpu else 0
            p = Process(
                target=worker_process,
                args=(input_queue, output_queue, args.model, args.fast_model,
                      args.gpu, device_id, args.patch_size, args.overlap, 
                      args.complexity_threshold)
            )
            p.daemon = True
            p.start()
            workers.append(p)

        writer_p = Process(
            target=ordered_writer_process,
            args=(output_queue, temp_video_path, output_width, output_height, 
                  video_info['fps'], total_frames, args.crf, args.preset,
                  hq_count, fast_count)
        )
        writer_p.start()

        writer_p.join()
        for p in workers:
            p.join(timeout=10)
            if p.is_alive():
                p.terminate()
                p.join()
        decoder_process.wait(timeout=10)

        elapsed = time.time() - start_time
        print(f"\n[INFO] Video processing completed in {elapsed:.2f}s")
        if total_frames > 0:
            print(f"[INFO] Average speed: {total_frames / elapsed:.2f} FPS")

        if args.fast_model:
            total = hq_count.value + fast_count.value
            if total > 0:
                hq_pct = hq_count.value / total * 100
                fast_pct = fast_count.value / total * 100
                print(f"[INFO] Model usage: HQ={hq_count.value}({hq_pct:.1f}%), FAST={fast_count.value}({fast_pct:.1f}%)")

        if audio_present and os.path.exists(temp_video_path):
            print(f"[INFO] Merging audio and video...")
            merge_audio_video(temp_video_path, temp_audio_path, args.output, args.crf, args.preset)
            print(f"[INFO] Audio merged successfully")
        elif os.path.exists(temp_video_path):
            shutil.copy2(temp_video_path, args.output)
            print(f"[INFO] Video saved without audio")
        else:
            print(f"[ERROR] Temporary video file not found: {temp_video_path}", file=sys.stderr)
            sys.exit(1)

        print(f"\n[INFO] Output saved to: {args.output}")
        file_size = os.path.getsize(args.output) / (1024 * 1024)
        print(f"[INFO] Output file size: {file_size:.2f} MB")

    finally:
        try:
            shutil.rmtree(temp_dir)
        except:
            print(f"\n[WARNING] Could not clean up temporary directory: {temp_dir}", file=sys.stderr)


if __name__ == '__main__':
    main()
