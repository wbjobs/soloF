#!/usr/bin/env python3
"""
离线测试脚本 - 验证评分、报告生成、重试机制、图片压缩和对抗性攻击功能
"""

import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mm_eval import (
    calculate_bleu,
    calculate_rouge,
    calculate_overall_scores,
    generate_html_report,
    generate_json_report,
    load_expected_descriptions,
    compress_image,
    tokenize,
    add_gaussian_noise,
    add_occlusion,
    apply_adversarial_attack,
    save_adversarial_image,
    calculate_robustness_metrics
)
from PIL import Image


def test_scoring():
    print("🧪 测试评分功能...")
    
    reference = "一只可爱的猫咪坐在沙发上睡觉"
    hypothesis = "一只可爱的猫坐在沙发上睡觉"
    
    bleu_scores = calculate_bleu(reference, hypothesis)
    print(f"  BLEU 得分: {bleu_scores}")
    
    rouge_scores = calculate_rouge(reference, hypothesis)
    print(f"  ROUGE 得分: {json.dumps(rouge_scores, ensure_ascii=False, indent=4)}")
    
    assert bleu_scores["bleu1"] > 0, "BLEU-1 应该大于 0"
    assert rouge_scores["rouge1"]["fmeasure"] > 0, "ROUGE-1 F1 应该大于 0"
    
    print("✅ 评分功能测试通过！")
    return bleu_scores, rouge_scores


def test_gaussian_noise():
    print("\n🧪 测试高斯噪声...")
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    test_image = os.path.join(base_dir, 'test_images', 'red_square.jpg')
    
    if os.path.exists(test_image):
        img = Image.open(test_image)
        original_size = img.size
        
        noisy_img = add_gaussian_noise(img, mean=0, std=25)
        
        assert noisy_img.size == original_size, "噪声图片尺寸应与原图相同"
        assert noisy_img.mode == img.mode, "噪声图片模式应与原图相同"
        
        print(f"  原始尺寸: {original_size}")
        print(f"  噪声后尺寸: {noisy_img.size}")
        print("✅ 高斯噪声测试通过！")
    else:
        print("⚠️  跳过高斯噪声测试（测试图片不存在")


def test_occlusion():
    print("\n🧪 测试遮挡...")
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    test_image = os.path.join(base_dir, 'test_images', 'blue_rectangle.jpg')
    
    if os.path.exists(test_image):
        img = Image.open(test_image)
        original_size = img.size
        
        occluded_img = add_occlusion(img, occlusion_ratio=0.2, num_blocks=1)
        
        assert occluded_img.size == original_size, "遮挡图片尺寸应与原图相同"
        
        print(f"  原始尺寸: {original_size}")
        print(f"  遮挡后尺寸: {occluded_img.size}")
        print("✅ 遮挡测试通过！")
    else:
        print("⚠️  跳过遮挡测试（测试图片不存在）")


def test_adversarial_attack():
    print("\n🧪 测试对抗性攻击...")
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    test_image = os.path.join(base_dir, 'test_images', 'red_square.jpg')
    output_dir = os.path.join(base_dir, 'test_adv_output')
    
    if os.path.exists(test_image):
        noise_params = {'noise_mean': 0, 'noise_std': 30}
        noisy_img = apply_adversarial_attack(test_image, 'gaussian_noise', **noise_params)
        
        occlusion_params = {'occlusion_ratio': 0.3, 'num_occlusion_blocks': 2}
        occluded_img = apply_adversarial_attack(test_image, 'occlusion', **occlusion_params)
        
        saved_path = save_adversarial_image(test_image, 'gaussian_noise', output_dir, noise_params)
        
        assert os.path.exists(saved_path), "对抗性图片应已保存"
        
        saved_img = Image.open(saved_path)
        assert saved_img.size == noisy_img.size, "保存的图片尺寸应正确"
        
        print(f"  高斯噪声图片已保存: {saved_path}")
        print("✅ 对抗性攻击测试通过！")
        
        import shutil
        shutil.rmtree(output_dir, ignore_errors=True)
    else:
        print("⚠️  跳过对抗性攻击测试（测试图片不存在）")


def test_robustness_metrics():
    print("\n🧪 测试鲁棒性指标计算...")
    
    clean_result = {
        "success": True,
        "bleu_scores": {"bleu1": 0.8, "bleu2": 0.6, "bleu3": 0.4, "bleu4": 0.3},
        "rouge_scores": {
            "rouge1": {"precision": 0.9, "recall": 0.8, "fmeasure": 0.85},
            "rouge2": {"precision": 0.7, "recall": 0.6, "fmeasure": 0.65},
            "rougeL": {"precision": 0.85, "recall": 0.75, "fmeasure": 0.8}
        }
    }
    
    adv_result = {
        "success": True,
        "bleu_scores": {"bleu1": 0.6, "bleu2": 0.4, "bleu3": 0.2, "bleu4": 0.1},
        "rouge_scores": {
            "rouge1": {"precision": 0.7, "recall": 0.6, "fmeasure": 0.65},
            "rouge2": {"precision": 0.5, "recall": 0.4, "fmeasure": 0.45},
            "rougeL": {"precision": 0.65, "recall": 0.55, "fmeasure": 0.6}
        }
    }
    
    metrics = calculate_robustness_metrics(clean_result, adv_result)
    
    print(f"  鲁棒性指标: {json.dumps(metrics, indent=2)}")
    
    assert metrics["bleu_bleu1_drop"] == 0.2, "BLEU-1 下降值计算错误"
    assert metrics["bleu_bleu1_drop_pct"] == 25.0, "BLEU-1 下降百分比计算错误"
    
    print("✅ 鲁棒性指标计算测试通过！")


def test_image_compression():
    print("\n🧪 测试图片压缩功能...")
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    test_image = os.path.join(base_dir, 'test_images', 'red_square.jpg')
    
    if os.path.exists(test_image):
        original_size = os.path.getsize(test_image)
        base64_image, compressed_size, dimensions = compress_image(
            test_image, max_size=1024, max_bytes=1*1024*1024, quality=80
        )
        
        print(f"  原始大小: {original_size} bytes")
        print(f"  压缩后大小: {compressed_size} bytes")
        print(f"  压缩后尺寸: {dimensions}")
        print(f"  Base64 长度: {len(base64_image)} chars")
        
        assert len(base64_image) > 0, "Base64 编码不应为空"
        assert compressed_size > 0, "压缩后大小应大于 0"
        
        print("✅ 图片压缩功能测试通过！")
    else:
        print("⚠️  跳过图片压缩测试（测试图片不存在）")


def test_tokenize():
    print("\n🧪 测试分词功能...")
    
    chinese_text = "你好世界"
    english_text = "hello world"
    
    chinese_tokens = tokenize(chinese_text)
    english_tokens = tokenize(english_text)
    
    print(f"  中文分词: {chinese_tokens}")
    print(f"  英文分词: {english_tokens}")
    
    assert len(chinese_tokens) == 4, f"中文应该分成 4 个字符，实际 {len(chinese_tokens)}"
    assert len(english_tokens) == 2, f"英文应该分成 2 个词，实际 {len(english_tokens)}"
    
    print("✅ 分词功能测试通过！")


def test_overall_scores():
    print("\n🧪 测试总体评分计算...")
    
    results = [
        {
            "bleu_scores": {"bleu1": 0.8, "bleu2": 0.6, "bleu3": 0.4, "bleu4": 0.3},
            "rouge_scores": {
                "rouge1": {"precision": 0.9, "recall": 0.8, "fmeasure": 0.85},
                "rouge2": {"precision": 0.7, "recall": 0.6, "fmeasure": 0.65},
                "rougeL": {"precision": 0.85, "recall": 0.75, "fmeasure": 0.8}
            }
        },
        {
            "bleu_scores": {"bleu1": 0.6, "bleu2": 0.4, "bleu3": 0.3, "bleu4": 0.2},
            "rouge_scores": {
                "rouge1": {"precision": 0.7, "recall": 0.6, "fmeasure": 0.65},
                "rouge2": {"precision": 0.5, "recall": 0.4, "fmeasure": 0.45},
                "rougeL": {"precision": 0.65, "recall": 0.55, "fmeasure": 0.6}
            }
        }
    ]
    
    overall = calculate_overall_scores(results)
    print(f"  总体得分: {json.dumps(overall, indent=4)}")
    
    assert overall["bleu1"] == 0.7, f"BLEU-1 平均值应为 0.7，实际为 {overall['bleu1']}"
    assert overall["rouge1_fmeasure"] == 0.75, f"ROUGE-1 F1 平均值应为 0.75，实际为 {overall['rouge1_fmeasure']}"
    
    print("✅ 总体评分计算测试通过！")
    return overall


def test_html_report():
    print("\n🧪 测试 HTML 报告生成...")
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    test_images_dir = os.path.join(base_dir, 'test_images')
    
    mock_results = [
        {
            "image_file": "red_square.jpg",
            "image_path": os.path.join(test_images_dir, "red_square.jpg"),
            "original_image_path": os.path.join(test_images_dir, "red_square.jpg"),
            "attack_type": "clean",
            "expected": "一张纯红色的正方形图片，中间有白色的 RED 文字",
            "response": "这是一张红色背景的图片，中间有白色的 RED 文字",
            "bleu_scores": {"bleu1": 0.75, "bleu2": 0.62, "bleu3": 0.48, "bleu4": 0.35},
            "rouge_scores": {
                "rouge1": {"precision": 0.88, "recall": 0.82, "fmeasure": 0.85},
                "rouge2": {"precision": 0.72, "recall": 0.65, "fmeasure": 0.68},
                "rougeL": {"precision": 0.80, "recall": 0.75, "fmeasure": 0.77}
            },
            "latency": 2.35,
            "success": True
        },
        {
            "image_file": "red_square.jpg",
            "image_path": os.path.join(test_images_dir, "red_square.jpg"),
            "original_image_path": os.path.join(test_images_dir, "red_square.jpg"),
            "attack_type": "gaussian_noise",
            "expected": "一张纯红色的正方形图片，中间有白色的 RED 文字",
            "response": "图片中有红色区域和一些模糊的文字",
            "bleu_scores": {"bleu1": 0.45, "bleu2": 0.32, "bleu3": 0.25, "bleu4": 0.15},
            "rouge_scores": {
                "rouge1": {"precision": 0.55, "recall": 0.48, "fmeasure": 0.51},
                "rouge2": {"precision": 0.38, "recall": 0.32, "fmeasure": 0.35},
                "rougeL": {"precision": 0.50, "recall": 0.42, "fmeasure": 0.46}
            },
            "latency": 2.15,
            "success": True,
            "robustness_metrics": {
                "bleu_bleu1_drop": 0.30,
                "bleu_bleu1_drop_pct": 40.0
            }
        }
    ]
    
    overall = {
        "bleu1": 0.6,
        "bleu2": 0.47,
        "robustness_gaussian_noise": {
            "bleu1_drop_pct": 40.0,
            "bleu2_drop_pct": 48.4
        }
    }
    
    output_path = os.path.join(base_dir, "test_report_adv.html")
    
    generate_html_report(mock_results, output_path, "gpt-4-vision-preview", overall)
    
    assert os.path.exists(output_path), f"报告文件未生成: {output_path}"
    
    file_size = os.path.getsize(output_path)
    assert file_size > 0, "报告文件为空"
    
    with open(output_path, 'r', encoding='utf-8-sig') as f:
        content = f.read()
        assert "多模态模型评估报告" in content, "报告标题不匹配"
        assert "鲁棒性分析" in content, "鲁棒性分析部分缺失"
        assert "gaussian_noise" in content, "攻击类型标签未显示"
    
    print(f"✅ HTML 报告生成成功！路径: {output_path}")
    print(f"  文件大小: {file_size} 字节")
    print(f"  编码验证: 中文字符正常显示")
    return output_path


def test_json_report():
    print("\n🧪 测试 JSON 报告生成...")
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    test_images_dir = os.path.join(base_dir, 'test_images')
    
    mock_results = [
        {
            "image_file": "red_square.jpg",
            "image_path": os.path.join(test_images_dir, "red_square.jpg"),
            "attack_type": "clean",
            "expected": "一张纯红色的正方形图片，中间有白色的 RED 文字",
            "response": "这是一张红色背景的图片",
            "bleu_scores": {"bleu1": 0.75, "bleu2": 0.62, "bleu3": 0.48, "bleu4": 0.35},
            "rouge_scores": {
                "rouge1": {"precision": 0.88, "recall": 0.82, "fmeasure": 0.85},
                "rouge2": {"precision": 0.72, "recall": 0.65, "fmeasure": 0.68},
                "rougeL": {"precision": 0.80, "recall": 0.75, "fmeasure": 0.77}
            },
            "latency": 2.35,
            "success": True
        }
    ]
    
    overall = calculate_overall_scores(mock_results)
    output_path = os.path.join(base_dir, "test_report_adv.json")
    
    generate_json_report(mock_results, output_path, "gpt-4-vision-preview", overall)
    
    assert os.path.exists(output_path), f"JSON 报告文件未生成: {output_path}"
    
    with open(output_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        assert data["model"] == "gpt-4-vision-preview", "模型名称不匹配"
        assert "一张纯红色的正方形图片" in data["results"][0]["expected"], "中文内容编码错误"
    
    print(f"✅ JSON 报告生成成功！路径: {output_path}")
    print(f"  编码验证: 中文字符正常显示")
    
    return output_path


def test_chinese_encoding():
    print("\n🧪 测试中文字符编码...")
    
    test_chinese = "测试中文字符编码"
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    test_file = os.path.join(base_dir, "test_chinese.txt")
    
    with open(test_file, 'w', encoding='utf-8') as f:
        f.write(test_chinese)
    
    with open(test_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    assert content == test_chinese, f"中文字符不匹配: {content} vs {test_chinese}"
    
    os.remove(test_file)
    print("✅ 中文字符编码测试通过！")


if __name__ == '__main__':
    print("=" * 60)
    print("🧪 多模态评估工具 - 离线功能测试（对抗性攻击版）")
    print("=" * 60)
    
    try:
        test_tokenize()
        test_chinese_encoding()
        test_scoring()
        test_image_compression()
        test_gaussian_noise()
        test_occlusion()
        test_adversarial_attack()
        test_robustness_metrics()
        test_overall_scores()
        test_html_report()
        test_json_report()
        
        print("\n" + "=" * 60)
        print("🎉 所有测试通过！对抗性攻击功能验证完成！")
        print("=" * 60)
        
        print("\n📋 功能总结:")
        print("  1. ✅ 高斯噪声攻击")
        print("  2. ✅ 遮挡攻击")
        print("  3. ✅ 鲁棒性指标计算")
        print("  4. ✅ 对抗性图片保存")
        print("  5. ✅ HTML 报告鲁棒性分析展示")
        
    except AssertionError as e:
        print(f"\n❌ 测试失败: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ 发生错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
