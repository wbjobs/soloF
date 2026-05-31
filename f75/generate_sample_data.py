#!/usr/bin/env python3
"""
生成示例测试数据
"""

import os
import json
from PIL import Image, ImageDraw, ImageFont


def create_test_images(output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    
    images = []
    
    img1 = Image.new('RGB', (400, 300), color='red')
    d1 = ImageDraw.Draw(img1)
    try:
        font = ImageFont.truetype("arial.ttf", 40)
    except:
        font = ImageFont.load_default()
    d1.text((120, 130), "RED", fill='white', font=font)
    path1 = os.path.join(output_dir, 'red_square.jpg')
    img1.save(path1)
    images.append(('red_square.jpg', '一张纯红色的正方形图片，中间有白色的 RED 文字'))
    
    img2 = Image.new('RGB', (400, 300), color='blue')
    d2 = ImageDraw.Draw(img2)
    d2.rectangle([50, 50, 350, 250], outline='white', width=5)
    d2.text((100, 130), "BLUE", fill='white', font=font)
    path2 = os.path.join(output_dir, 'blue_rectangle.jpg')
    img2.save(path2)
    images.append(('blue_rectangle.jpg', '一张蓝色背景的图片，中间有一个白色边框的矩形和 BLUE 文字'))
    
    img3 = Image.new('RGB', (400, 400), color='green')
    d3 = ImageDraw.Draw(img3)
    d3.ellipse((100, 100, 300, 300), fill='yellow', outline='white', width=3)
    path3 = os.path.join(output_dir, 'green_circle.png')
    img3.save(path3)
    images.append(('green_circle.png', '一张绿色背景的图片，中间有一个黄色的圆形'))
    
    img4 = Image.new('RGB', (500, 300), color='purple')
    d4 = ImageDraw.Draw(img4)
    d4.polygon([(250, 50), (450, 250), (50, 250)], fill='white', outline='black', width=2)
    path4 = os.path.join(output_dir, 'purple_triangle.jpg')
    img4.save(path4)
    images.append(('purple_triangle.jpg', '一张紫色背景的图片，中间有一个白色的三角形'))
    
    return images


def create_expected_json(images, output_path: str):
    data = []
    for filename, description in images:
        data.append({
            "image": filename,
            "description": description
        })
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"✅ 已生成预期描述文件: {output_path}")
    print(f"📋 包含 {len(data)} 条测试数据")


if __name__ == '__main__':
    base_dir = os.path.dirname(os.path.abspath(__file__))
    test_images_dir = os.path.join(base_dir, 'test_images')
    expected_json_path = os.path.join(base_dir, 'expected_descriptions.json')
    
    print("🖼️  正在生成示例测试图片...")
    images = create_test_images(test_images_dir)
    
    print("📄 正在生成预期描述 JSON...")
    create_expected_json(images, expected_json_path)
    
    print("\n🎉 示例数据生成完成！")
    print(f"📁 图片目录: {test_images_dir}")
    print(f"📄 JSON 文件: {expected_json_path}")
