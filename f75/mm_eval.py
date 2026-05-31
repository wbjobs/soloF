#!/usr/bin/env python3
"""
多模态大模型评估 CLI 工具
用于测试 GPT-4V、LLaVA 等多模态模型的图片描述能力
"""

import os
import json
import base64
import time
import io
import random
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple, Union

import click
from dotenv import load_dotenv
from openai import OpenAI, APIError, APIConnectionError, RateLimitError, Timeout
from PIL import Image, ImageDraw
import numpy as np
from tqdm import tqdm
from nltk.translate.bleu_score import sentence_bleu, SmoothingFunction
from rouge_score import rouge_scorer
from jinja2 import Environment, FileSystemLoader, select_autoescape

load_dotenv()


def encode_image(image_path: str) -> str:
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')


def encode_image_pil(image: Image.Image, format: str = "JPEG") -> str:
    buffer = io.BytesIO()
    image.save(buffer, format=format)
    return base64.b64encode(buffer.getvalue()).decode('utf-8')


def compress_image(
    image_path: str,
    max_size: int = 2048,
    max_bytes: int = 5 * 1024 * 1024,
    quality: int = 85
) -> Tuple[str, int, Tuple[int, int]]:
    img = Image.open(image_path)
    
    original_size = os.path.getsize(image_path)
    original_dimensions = img.size
    
    if img.mode in ('RGBA', 'P'):
        img = img.convert('RGB')
    
    width, height = img.size
    if max(width, height) > max_size:
        scale = max_size / max(width, height)
        new_width = int(width * scale)
        new_height = int(height * scale)
        img = img.resize((new_width, new_height), Image.LANCZOS)
    
    current_quality = quality
    while current_quality > 10:
        buffer = io.BytesIO()
        img.save(buffer, format='JPEG', quality=current_quality, optimize=True)
        size = buffer.tell()
        if size <= max_bytes:
            break
        current_quality -= 10
    
    base64_image = base64.b64encode(buffer.getvalue()).decode('utf-8')
    compressed_size = buffer.tell()
    compressed_dimensions = img.size
    
    return base64_image, compressed_size, compressed_dimensions


def add_gaussian_noise(
    image: Image.Image, mean: float = 0, std: float = 25) -> Image.Image:
    img_array = np.array(image).astype(np.float32)
    
    if len(img_array.shape) == 2:
        noise = np.random.normal(mean, std, img_array.shape)
    else:
        noise = np.random.normal(mean, std, img_array.shape)
    
    noisy_array = img_array + noise
    noisy_array = np.clip(noisy_array, 0, 255).astype(np.uint8)
    
    return Image.fromarray(noisy_array)


def add_occlusion(
    image: Image.Image,
    occlusion_ratio: float = 0.2,
    num_blocks: int = 1,
    color: Tuple[int, int, int] = (0, 0, 0)
) -> Image.Image:
    img = image.copy()
    width, height = img.size
    
    draw = ImageDraw.Draw(img)
    
    block_area = width * height * occlusion_ratio / num_blocks
    block_size = int(np.sqrt(block_area))
    
    for _ in range(num_blocks):
        max_x = max(0, width - block_size)
        max_y = max(0, height - block_size)
        
        if max_x > 0 and max_y > 0:
            x = random.randint(0, max_x)
            y = random.randint(0, max_y)
            
            draw.rectangle([x, y, x + block_size, y + block_size], fill=color)
    
    return img


def apply_adversarial_attack(
    image_path: str,
    attack_type: str,
    **kwargs
) -> Image.Image:
    img = Image.open(image_path)
    
    if img.mode in ('RGBA', 'P'):
        img = img.convert('RGB')
    
    if attack_type == 'gaussian_noise':
        mean = kwargs.get('noise_mean', 0)
        std = kwargs.get('noise_std', 25)
        return add_gaussian_noise(img, mean=mean, std=std)
    
    elif attack_type == 'occlusion':
        ratio = kwargs.get('occlusion_ratio', 0.2)
        num_blocks = kwargs.get('num_occlusion_blocks', 1)
        color = kwargs.get('occlusion_color', (0, 0, 0))
        return add_occlusion(
            img,
            occlusion_ratio=ratio,
            num_blocks=num_blocks,
            color=color
        )
    
    else:
        raise ValueError(f"未知的对抗性攻击类型: {attack_type}")


def compress_image_from_pil(
    image: Image.Image,
    max_size: int = 2048,
    max_bytes: int = 5 * 1024 * 1024,
    quality: int = 85
) -> Tuple[str, int, Tuple[int, int]]:
    img = image.copy()
    
    width, height = img.size
    if max(width, height) > max_size:
        scale = max_size / max(width, height)
        new_width = int(width * scale)
        new_height = int(height * scale)
        img = img.resize((new_width, new_height), Image.LANCZOS)
    
    current_quality = quality
    while current_quality > 10:
        buffer = io.BytesIO()
        img.save(buffer, format='JPEG', quality=current_quality, optimize=True)
        size = buffer.tell()
        if size <= max_bytes:
            break
        current_quality -= 10
    
    base64_image = base64.b64encode(buffer.getvalue()).decode('utf-8')
    compressed_size = buffer.tell()
    compressed_dimensions = img.size
    
    return base64_image, compressed_size, compressed_dimensions


def load_expected_descriptions(json_path: str) -> Dict[str, str]:
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    if isinstance(data, list):
        result = {}
        for item in data:
            if 'image' in item and 'description' in item:
                result[item['image']] = item['description']
        return result
    elif isinstance(data, dict):
        return data
    else:
        raise ValueError("JSON 格式不正确，应为列表或字典")


def get_image_files(image_dir: str) -> List[str]:
    supported_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'}
    image_files = []
    for f in os.listdir(image_dir):
        ext = os.path.splitext(f)[1].lower()
        if ext in supported_extensions:
            image_files.append(f)
    return sorted(image_files)


def call_openai_api(
    client: OpenAI,
    image_source: Union[str, Image.Image],
    prompt: str,
    model: str = "gpt-4-vision-preview",
    max_tokens: int = 300,
    detail: str = "auto",
    max_retries: int = 3,
    initial_delay: float = 2.0,
    max_size: int = 2048,
    max_bytes: int = 5 * 1024 * 1024,
    quality: int = 85,
    attack_type: Optional[str] = None,
    attack_params: Optional[Dict[str, Any]] = None
) -> Tuple[str, Dict[str, Any]]:
    attack_params = attack_params or {}
    
    if isinstance(image_source, str):
        if attack_type:
            processed_image = apply_adversarial_attack(
                image_source, attack_type, **attack_params
            )
            base64_image, compressed_size, compressed_dimensions = compress_image_from_pil(
                processed_image, max_size=max_size, max_bytes=max_bytes, quality=quality
            )
        else:
            base64_image, compressed_size, compressed_dimensions = compress_image(
                image_source, max_size=max_size, max_bytes=max_bytes, quality=quality
            )
    elif isinstance(image_source, Image.Image):
        base64_image, compressed_size, compressed_dimensions = compress_image_from_pil(
            image_source, max_size=max_size, max_bytes=max_bytes, quality=quality
        )
    else:
        raise ValueError("image_source 必须是文件路径或 PIL Image 对象")
    
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{base64_image}",
                        "detail": detail
                    }
                }
            ]
        }
    ]
    
    metadata = {
        "compressed_size": compressed_size,
        "compressed_dimensions": compressed_dimensions,
        "retries": 0,
        "attack_type": attack_type,
        "attack_params": attack_params if attack_type else None
    }
    
    last_exception = None
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                timeout=120
            )
            metadata["retries"] = attempt
            return response.choices[0].message.content.strip(), metadata
            
        except (Timeout, APIConnectionError, RateLimitError, APIError) as e:
            last_exception = e
            metadata["retries"] = attempt + 1
            
            if attempt < max_retries - 1:
                delay = initial_delay * (2 ** attempt)
                click.echo(f"  ⚠️  第 {attempt + 1} 次尝试失败: {type(e).__name__}，{delay:.1f}s 后重试...")
                time.sleep(delay)
            continue
            
        except Exception as e:
            raise e
    
    raise last_exception


def tokenize(text: str) -> List[str]:
    has_chinese = any('\u4e00' <= char <= '\u9fff' for char in text)
    if has_chinese:
        return [char for char in text if not char.isspace()]
    else:
        return text.lower().split()


def calculate_bleu(reference: str, hypothesis: str) -> Dict[str, float]:
    reference_tokens = [tokenize(reference)]
    hypothesis_tokens = tokenize(hypothesis)
    
    smoothie = SmoothingFunction().method4
    
    if len(hypothesis_tokens) == 0 or len(reference_tokens[0]) == 0:
        return {"bleu1": 0.0, "bleu2": 0.0, "bleu3": 0.0, "bleu4": 0.0}
    
    bleu1 = sentence_bleu(reference_tokens, hypothesis_tokens, weights=(1, 0, 0, 0), smoothing_function=smoothie)
    bleu2 = sentence_bleu(reference_tokens, hypothesis_tokens, weights=(0.5, 0.5, 0, 0), smoothing_function=smoothie)
    bleu3 = sentence_bleu(reference_tokens, hypothesis_tokens, weights=(0.33, 0.33, 0.33, 0), smoothing_function=smoothie)
    bleu4 = sentence_bleu(reference_tokens, hypothesis_tokens, weights=(0.25, 0.25, 0.25, 0.25), smoothing_function=smoothie)
    
    return {
        "bleu1": round(max(0.0, bleu1), 4),
        "bleu2": round(max(0.0, bleu2), 4),
        "bleu3": round(max(0.0, bleu3), 4),
        "bleu4": round(max(0.0, bleu4), 4)
    }


def get_ngrams(tokens: List[str], n: int) -> List[tuple]:
    ngrams = []
    for i in range(len(tokens) - n + 1):
        ngrams.append(tuple(tokens[i:i + n]))
    return ngrams


def calculate_precision_recall_f1(reference_tokens: List[str], hypothesis_tokens: List[str], n: int = 1) -> Dict[str, float]:
    if not hypothesis_tokens or not reference_tokens:
        return {"precision": 0.0, "recall": 0.0, "fmeasure": 0.0}
    
    ref_ngrams = get_ngrams(reference_tokens, n)
    hyp_ngrams = get_ngrams(hypothesis_tokens, n)
    
    ref_counts = {}
    for gram in ref_ngrams:
        ref_counts[gram] = ref_counts.get(gram, 0) + 1
    
    hyp_counts = {}
    for gram in hyp_ngrams:
        hyp_counts[gram] = hyp_counts.get(gram, 0) + 1
    
    overlap = 0
    for gram, count in hyp_counts.items():
        if gram in ref_counts:
            overlap += min(count, ref_counts[gram])
    
    precision = overlap / len(hyp_ngrams) if hyp_ngrams else 0.0
    recall = overlap / len(ref_ngrams) if ref_ngrams else 0.0
    fmeasure = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    
    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "fmeasure": round(fmeasure, 4)
    }


def lcs_length(a: List[str], b: List[str]) -> int:
    m, n = len(a), len(b)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    
    return dp[m][n]


def calculate_rouge_l(reference_tokens: List[str], hypothesis_tokens: List[str]) -> Dict[str, float]:
    if not hypothesis_tokens or not reference_tokens:
        return {"precision": 0.0, "recall": 0.0, "fmeasure": 0.0}
    
    lcs_len = lcs_length(reference_tokens, hypothesis_tokens)
    
    precision = lcs_len / len(hypothesis_tokens) if hypothesis_tokens else 0.0
    recall = lcs_len / len(reference_tokens) if reference_tokens else 0.0
    fmeasure = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    
    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "fmeasure": round(fmeasure, 4)
    }


def calculate_rouge(reference: str, hypothesis: str) -> Dict[str, Dict[str, float]]:
    ref_tokens = tokenize(reference)
    hyp_tokens = tokenize(hypothesis)
    
    if not ref_tokens or not hyp_tokens:
        return {
            "rouge1": {"precision": 0.0, "recall": 0.0, "fmeasure": 0.0},
            "rouge2": {"precision": 0.0, "recall": 0.0, "fmeasure": 0.0},
            "rougeL": {"precision": 0.0, "recall": 0.0, "fmeasure": 0.0}
        }
    
    rouge1 = calculate_precision_recall_f1(ref_tokens, hyp_tokens, n=1)
    rouge2 = calculate_precision_recall_f1(ref_tokens, hyp_tokens, n=2)
    rougeL = calculate_rouge_l(ref_tokens, hyp_tokens)
    
    return {
        "rouge1": rouge1,
        "rouge2": rouge2,
        "rougeL": rougeL
    }


def generate_html_report(
    results: List[Dict[str, Any]],
    output_path: str,
    model: str,
    overall_scores: Dict[str, float]
) -> None:
    template_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'templates')
    env = Environment(
        loader=FileSystemLoader(template_dir),
        autoescape=select_autoescape(['html', 'xml'])
    )
    
    template = env.get_template('report.html')
    
    html_content = template.render(
        results=results,
        model=model,
        overall_scores=overall_scores,
        generated_at=time.strftime("%Y-%m-%d %H:%M:%S")
    )
    
    with open(output_path, 'w', encoding='utf-8-sig') as f:
        f.write(html_content)


def generate_json_report(
    results: List[Dict[str, Any]],
    output_path: str,
    model: str,
    overall_scores: Dict[str, float]
) -> None:
    report = {
        "model": model,
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_samples": len(results),
        "successful_samples": sum(1 for r in results if r.get("success")),
        "overall_scores": overall_scores,
        "results": results
    }
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)


def save_adversarial_image(
    image_path: str,
    attack_type: str,
    output_dir: str,
    attack_params: Dict[str, Any]
) -> str:
    os.makedirs(output_dir, exist_ok=True)
    
    processed_image = apply_adversarial_attack(image_path, attack_type, **attack_params)
    
    base_name = os.path.splitext(os.path.basename(image_path))[0]
    output_path = os.path.join(output_dir, f"{base_name}_{attack_type}.jpg")
    
    processed_image.save(output_path, format='JPEG', quality=90)
    
    return output_path


def calculate_robustness_metrics(
    clean_result: Dict[str, Any],
    adv_result: Dict[str, Any]
) -> Dict[str, Any]:
    metrics = {}
    
    if clean_result.get("success") and adv_result.get("success"):
        clean_bleu = clean_result["bleu_scores"]
        adv_bleu = adv_result["bleu_scores"]
        clean_rouge = clean_result["rouge_scores"]
        adv_rouge = adv_result["rouge_scores"]
        
        for key in clean_bleu:
            metrics[f"bleu_{key}_drop"] = round(clean_bleu[key] - adv_bleu[key], 4)
            metrics[f"bleu_{key}_drop_pct"] = round(
                (clean_bleu[key] - adv_bleu[key]) / clean_bleu[key] * 100 if clean_bleu[key] > 0 else 0, 2
            )
        
        for rouge_type in clean_rouge:
            for metric in clean_rouge[rouge_type]:
                key = f"{rouge_type}_{metric}"
                diff = clean_rouge[rouge_type][metric] - adv_rouge[rouge_type][metric]
                metrics[f"{key}_drop"] = round(diff, 4)
                metrics[f"{key}_drop_pct"] = round(
                    diff / clean_rouge[rouge_type][metric] * 100 if clean_rouge[rouge_type][metric] > 0 else 0, 2
                )
    
    return metrics


def calculate_overall_scores(results: List[Dict[str, Any]]) -> Dict[str, float]:
    if not results:
        return {}
    
    metrics = ["bleu1", "bleu2", "bleu3", "bleu4"]
    rouge_types = ["rouge1", "rouge2", "rougeL"]
    rouge_metrics = ["precision", "recall", "fmeasure"]
    
    overall = {}
    
    for metric in metrics:
        values = [r["bleu_scores"][metric] for r in results if r.get("bleu_scores")]
        if values:
            overall[metric] = round(sum(values) / len(values), 4)
    
    for rouge_type in rouge_types:
        for metric in rouge_metrics:
            key = f"{rouge_type}_{metric}"
            values = [r["rouge_scores"][rouge_type][metric] for r in results if r.get("rouge_scores")]
            if values:
                overall[key] = round(sum(values) / len(values), 4)
    
    return overall


@click.command()
@click.option('--image-dir', '-i', required=True, type=click.Path(exists=True, file_okay=False),
              help='包含测试图片的目录路径')
@click.option('--expected-json', '-e', required=True, type=click.Path(exists=True, dir_okay=False),
              help='包含预期描述的 JSON 文件路径')
@click.option('--output', '-o', default='report.html', type=click.Path(dir_okay=False),
              help='输出 HTML 报告的路径 (默认: report.html)')
@click.option('--json-output', default=None, type=click.Path(dir_okay=False),
              help='输出 JSON 格式报告的路径 (可选)')
@click.option('--model', '-m', default='gpt-4-vision-preview',
              help='OpenAI 模型名称 (默认: gpt-4-vision-preview)')
@click.option('--prompt', '-p', default='请用中文详细描述这张图片的内容。',
              help='发送给模型的提示词 (默认: 请用中文详细描述这张图片的内容。)')
@click.option('--max-tokens', default=300, type=int,
              help='最大生成 token 数 (默认: 300)')
@click.option('--detail', default='auto', type=click.Choice(['low', 'high', 'auto']),
              help='图片细节级别 (默认: auto)')
@click.option('--api-key', envvar='OPENAI_API_KEY',
              help='OpenAI API Key (也可通过环境变量 OPENAI_API_KEY 设置)')
@click.option('--base-url', envvar='OPENAI_BASE_URL', default=None,
              help='OpenAI API Base URL (用于兼容其他 API，如 LLaVA)')
@click.option('--delay', default=0, type=float,
              help='每次 API 调用之间的延迟秒数 (默认: 0)')
@click.option('--max-retries', default=3, type=int,
              help='API 调用最大重试次数 (默认: 3)')
@click.option('--initial-delay', default=2.0, type=float,
              help='重试初始延迟秒数，指数退避 (默认: 2.0)')
@click.option('--max-image-size', default=2048, type=int,
              help='图片最大边长像素 (默认: 2048)')
@click.option('--max-image-bytes', default=5, type=int,
              help='图片最大大小 MB (默认: 5)')
@click.option('--image-quality', default=85, type=int,
              help='JPEG 压缩质量 1-100 (默认: 85)')
@click.option('--adv-attack', type=click.Choice(['none', 'gaussian_noise', 'occlusion', 'both']),
              default='none', help='对抗性攻击模式 (默认: none)')
@click.option('--noise-std', default=25, type=float,
              help='高斯噪声标准差 (默认: 25)')
@click.option('--noise-mean', default=0, type=float,
              help='高斯噪声均值 (默认: 0)')
@click.option('--occlusion-ratio', default=0.2, type=float,
              help='遮挡面积比例 0-1 (默认: 0.2)')
@click.option('--num-occlusion-blocks', default=1, type=int,
              help='遮挡块数量 (默认: 1)')
@click.option('--adv-output-dir', default='adversarial_images',
              type=click.Path(file_okay=False),
              help='对抗性攻击图片输出目录 (默认: adversarial_images)')
def main(image_dir: str, expected_json: str, output: str, json_output: Optional[str],
         model: str, prompt: str, max_tokens: int, detail: str,
         api_key: Optional[str], base_url: Optional[str], delay: float,
         max_retries: int, initial_delay: float, max_image_size: int,
         max_image_bytes: int, image_quality: int,
         adv_attack: str, noise_std: float, noise_mean: float,
         occlusion_ratio: float, num_occlusion_blocks: int,
         adv_output_dir: str):
    """
    多模态大模型评估工具 - 测试图片描述能力和鲁棒性
    """
    
    if not api_key:
        click.echo("错误: 请提供 OPENAI_API_KEY，可以通过 --api-key 参数或环境变量设置。", err=True)
        return
    
    click.echo(f"📁 图片目录: {image_dir}")
    click.echo(f"📄 预期描述文件: {expected_json}")
    click.echo(f"🤖 使用模型: {model}")
    click.echo(f"🔄 最大重试次数: {max_retries}")
    click.echo(f"📐 图片最大边长: {max_image_size}px")
    
    attack_configs = []
    if adv_attack == 'none':
        attack_configs = [{'type': None, 'name': 'clean', 'params': {}}]
    elif adv_attack == 'gaussian_noise':
        attack_configs = [
            {'type': None, 'name': 'clean', 'params': {}},
            {'type': 'gaussian_noise', 'name': 'gaussian_noise', 'params': {
                'noise_mean': noise_mean, 'noise_std': noise_std
            }}
        ]
    elif adv_attack == 'occlusion':
        attack_configs = [
            {'type': None, 'name': 'clean', 'params': {}},
            {'type': 'occlusion', 'name': 'occlusion', 'params': {
                'occlusion_ratio': occlusion_ratio,
                'num_occlusion_blocks': num_occlusion_blocks,
                'occlusion_color': (0, 0, 0)
            }}
        ]
    elif adv_attack == 'both':
        attack_configs = [
            {'type': None, 'name': 'clean', 'params': {}},
            {'type': 'gaussian_noise', 'name': 'gaussian_noise', 'params': {
                'noise_mean': noise_mean, 'noise_std': noise_std
            }},
            {'type': 'occlusion', 'name': 'occlusion', 'params': {
                'occlusion_ratio': occlusion_ratio,
                'num_occlusion_blocks': num_occlusion_blocks,
                'occlusion_color': (0, 0, 0)
            }}
        ]
    
    if adv_attack != 'none':
        click.echo(f"⚔️  对抗性攻击模式: {adv_attack}")
        if 'gaussian_noise' in adv_attack or adv_attack == 'both':
            click.echo(f"  📊 高斯噪声: mean={noise_mean}, std={noise_std}")
        if 'occlusion' in adv_attack or adv_attack == 'both':
            click.echo(f"  🧱 遮挡: 比例={occlusion_ratio}, 块数={num_occlusion_blocks}")
    
    click.echo("=" * 60)
    
    client_kwargs = {"api_key": api_key}
    if base_url:
        client_kwargs["base_url"] = base_url
    client = OpenAI(**client_kwargs)
    
    expected_descriptions = load_expected_descriptions(expected_json)
    click.echo(f"✅ 加载了 {len(expected_descriptions)} 条预期描述")
    
    image_files = get_image_files(image_dir)
    click.echo(f"🖼️  找到 {len(image_files)} 张图片")
    
    matched_files = [f for f in image_files if f in expected_descriptions]
    click.echo(f"🔍 匹配到 {len(matched_files)} 张图片有对应的预期描述")
    
    if not matched_files:
        click.echo("错误: 没有找到匹配的图片和预期描述对。", err=True)
        return
    
    results = []
    adv_output_abs = os.path.join(os.path.dirname(os.path.abspath(output)), adv_output_dir)
    
    total_tasks = len(matched_files) * len(attack_configs)
    
    with tqdm(total=total_tasks, desc="评估中", unit="次") as pbar:
        for image_file in matched_files:
            image_path = os.path.join(image_dir, image_file)
            expected = expected_descriptions[image_file]
            
            image_results = {}
            
            for attack_config in attack_configs:
                pbar.set_postfix_str(f"{image_file} ({attack_config['name']})")
                
                attack_type = attack_config['type']
                attack_params = attack_config['params']
                attack_name = attack_config['name']
                
                adv_image_path = None
                if attack_type:
                    try:
                        adv_image_path = save_adversarial_image(
                            image_path, attack_type, adv_output_abs, attack_params
                        )
                    except Exception as e:
                        click.echo(f"  ⚠️  生成对抗性图片失败: {e}")
                
                try:
                    start_time = time.time()
                    model_response, api_metadata = call_openai_api(
                        client=client,
                        image_source=image_path,
                        prompt=prompt,
                        model=model,
                        max_tokens=max_tokens,
                        detail=detail,
                        max_retries=max_retries,
                        initial_delay=initial_delay,
                        max_size=max_image_size,
                        max_bytes=max_image_bytes * 1024 * 1024,
                        quality=image_quality,
                        attack_type=attack_type,
                        attack_params=attack_params
                    )
                    latency = round(time.time() - start_time, 2)
                    
                    bleu_scores = calculate_bleu(expected, model_response)
                    rouge_scores = calculate_rouge(expected, model_response)
                    
                    result = {
                        "image_file": image_file,
                        "image_path": adv_image_path if adv_image_path else image_path,
                        "original_image_path": image_path,
                        "attack_type": attack_name,
                        "expected": expected,
                        "response": model_response,
                        "bleu_scores": bleu_scores,
                        "rouge_scores": rouge_scores,
                        "latency": latency,
                        "success": True,
                        "api_metadata": api_metadata
                    }
                    
                except Exception as e:
                    result = {
                        "image_file": image_file,
                        "image_path": adv_image_path if adv_image_path else image_path,
                        "original_image_path": image_path,
                        "attack_type": attack_name,
                        "expected": expected,
                        "response": f"错误: {str(e)}",
                        "bleu_scores": None,
                        "rouge_scores": None,
                        "latency": 0,
                        "success": False,
                        "error": str(e)
                    }
                
                image_results[attack_name] = result
                pbar.update(1)
                
                if delay > 0:
                    time.sleep(delay)
            
            if adv_attack != 'none' and 'clean' in image_results:
                for attack_name, result in image_results.items():
                    if attack_name != 'clean' and result.get("success") and image_results['clean'].get("success"):
                        robustness = calculate_robustness_metrics(image_results['clean'], result)
                        result["robustness_metrics"] = robustness
            
            results.extend(image_results.values())
    
    click.echo("=" * 60)
    click.echo("✅ 评估完成，正在生成报告...")
    
    overall_scores = calculate_overall_scores(results)
    
    if adv_attack != 'none':
        clean_results = [r for r in results if r.get("attack_type") == "clean"]
        overall_clean = calculate_overall_scores(clean_results)
        
        for attack_name in set(r.get("attack_type") for r in results if r.get("attack_type") != "clean"):
            adv_results = [r for r in results if r.get("attack_type") == attack_name]
            overall_adv = calculate_overall_scores(adv_results)
            
            robustness_summary = {}
            if overall_clean and overall_adv:
                for key in overall_clean:
                    if key in overall_adv:
                        drop = overall_clean[key] - overall_adv[key]
                        drop_pct = drop / overall_clean[key] * 100 if overall_clean[key] > 0 else 0
                        robustness_summary[f"{key}_drop"] = round(drop, 4)
                        robustness_summary[f"{key}_drop_pct"] = round(drop_pct, 2)
            
            overall_scores[f"robustness_{attack_name}"] = robustness_summary
    
    generate_html_report(results, output, model, overall_scores)
    click.echo(f"📊 HTML 报告已生成: {os.path.abspath(output)}")
    
    if json_output:
        generate_json_report(results, json_output, model, overall_scores)
        click.echo(f"📋 JSON 报告已生成: {os.path.abspath(json_output)}")
    
    click.echo("=" * 60)
    
    if overall_scores:
        click.echo("📈 总体得分:")
        for key, value in overall_scores.items():
            if not key.startswith("robustness_"):
                click.echo(f"  {key}: {value:.4f}")
        
        if adv_attack != 'none':
            click.echo("\n📉 鲁棒性分析:")
            for key, value in overall_scores.items():
                if key.startswith("robustness_"):
                    attack_name = key.replace("robustness_", "")
                    click.echo(f"\n  {attack_name}:")
                    for metric, drop in value.items():
                        if metric.endswith("_drop_pct"):
                            click.echo(f"    {metric}: {drop:.1f}%")


if __name__ == '__main__':
    main()
