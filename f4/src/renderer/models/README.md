# AI 模型文件夹

## 模型说明

此文件夹用于存放 ONNX 格式的医学影像分割模型。

## 支持的模型格式

- 文件格式: `.onnx`
- 推理引擎: ONNX Runtime Web
- 支持 WebGL 和 WASM 后端

## 模型要求

### 输入要求
- 输入尺寸: 256 x 256 (可在 ai-model-manager.js 中修改)
- 输入通道: 1 (单通道灰度图像)
- 数据类型: float32
- 像素值范围: 标准化后的 HU 值

### 输出要求
- 输出尺寸: 256 x 256
- 输出通道: 1 (分割概率图)
- 像素值范围: 0-1 (概率值)

## 放置模型文件

1. 将训练好的 `.onnx` 模型文件重命名为 `liver_segmentation.onnx`
2. 将文件放置在此文件夹中
3. 重启应用程序

## 模型加载模式

### 真实模型模式
当检测到有效的 `liver_segmentation.onnx` 文件时：
- AI 功能使用真实的神经网络进行推理
- 状态栏显示 "模型已就绪"
- 分割结果基于深度学习算法

### 模拟模式 (默认)
当未检测到模型文件时：
- AI 功能使用模拟分割算法
- 状态栏显示 "模拟模式（无模型文件）"
- 生成演示用的圆形/椭圆形轮廓
- 用于测试 UI 和工作流程

## 模型训练建议

### 数据预处理
1. 使用窗宽 400，窗位 40 (软组织窗)
2. 归一化到 [0, 1] 范围
3. 图像尺寸调整到 256x256

### 网络架构推荐
- U-Net / 3D U-Net
- ResNet-50 骨干
- Attention U-Net
- VNet (用于体数据)

### 训练数据集
- 公共数据集: LiTS, KiTS, BraTS
- 包含多种模态: CT, MRI
- 专家标注的病灶/器官轮廓

## 模型导出

使用 PyTorch 导出示例:

```python
import torch
import torch.onnx

# 加载训练好的模型
model = YourSegmentationModel()
model.load_state_dict(torch.load('trained_model.pth'))
model.eval()

# 创建示例输入
dummy_input = torch.randn(1, 1, 256, 256)

# 导出为 ONNX
torch.onnx.export(
    model,
    dummy_input,
    'liver_segmentation.onnx',
    export_params=True,
    opset_version=12,
    do_constant_folding=True,
    input_names=['input'],
    output_names=['output'],
    dynamic_axes={
        'input': {0: 'batch_size'},
        'output': {0: 'batch_size'}
    }
)
```

## 性能优化

1. **算子融合**: 启用 constant folding 优化
2. **量化**: 使用 INT8 量化减小模型大小
3. **剪枝**: 移除冗余权重
4. **WebGL 加速**: 启用 GPU 推理

## 故障排除

### 模型加载失败
- 检查文件路径是否正确
- 确认 ONNX opset 版本兼容 (建议 12+)
- 查看浏览器控制台错误信息

### 推理速度慢
- 确保启用 WebGL 后端
- 尝试减小输入尺寸
- 使用量化后的模型

### 分割效果差
- 检查窗宽窗位设置是否正确
- 验证预处理步骤与训练时一致
- 考虑重新训练或微调模型

## 更新模型

1. 备份旧模型文件
2. 替换 `liver_segmentation.onnx`
3. 刷新应用页面
4. 点击 "重新加载" 按钮验证加载状态

---

**注意**: 本应用包含模拟模式，即使没有真实模型文件也可测试完整的 AI 辅助勾画工作流程。真实模型文件只需放置在此文件夹即可自动启用。
