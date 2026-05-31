# 植物病害识别系统

## 项目结构

```
f26/
├── backend/          # Python Flask 后端
│   ├── app.py        # 主应用文件
│   ├── requirements.txt
│   └── plant_disease.tflite  # TensorFlow Lite 模型文件
└── frontend/         # Flutter 移动应用
    ├── lib/
    │   └── main.dart
    └── pubspec.yaml
```

## 后端部署

### 1. 安装依赖

```bash
cd backend
pip install -r requirements.txt
```

### 2. 准备模型文件

将训练好的 `plant_disease.tflite` 文件放到 `backend/` 目录下。

**模型热更新：** 可以随时替换 `plant_disease.tflite` 文件，后端会自动检测文件变化并重新加载，无需重启服务。

### 3. 启动服务

```bash
python app.py
```

服务将在 `http://0.0.0.0:5000` 启动。

### API 接口

- **POST /predict** - 上传图片进行推理
  - 参数: `image` (multipart/form-data)
  - 返回: `{"disease": "病害名称", "confidence": 0.95, "success": true}`

- **GET /health** - 健康检查

## 前端部署

### 1. 安装 Flutter

确保已安装 Flutter SDK: https://flutter.dev/docs/get-started/install

### 2. 获取依赖

```bash
cd frontend
flutter pub get
```

### 3. 配置后端地址

在 `frontend/lib/main.dart` 第79行修改后端地址：
- 模拟器使用: `http://10.0.2.2:5000`
- 真机使用: 电脑的局域网IP (如 `http://192.168.1.100:5000`)

### 4. 运行应用

```bash
# 连接设备或启动模拟器
flutter devices
flutter run
```

## 功能特性

### 后端
- ✅ TensorFlow Lite 模型推理
- ✅ 模型热更新（自动检测文件变化）
- ✅ 图片自动预处理（224x224）
- ✅ CORS 跨域支持

### 前端
- ✅ 调用手机摄像头拍照
- ✅ 从相册选择图片
- ✅ 图片预览显示
- ✅ 图片自动压缩到224x224
- ✅ 显示识别结果和置信度条
- ✅ 动态权限申请

## 病害类别

系统支持识别以下12种类别：

1. 番茄早疫病
2. 番茄晚疫病
3. 番茄叶霉病
4. 番茄斑枯病
5. 番茄溃疡病
6. 番茄黄萎病
7. 番茄花叶病毒病
8. 番茄健康
9. 苹果黑星病
10. 苹果白粉病
11. 苹果锈病
12. 苹果健康

可在 `backend/app.py` 的 `LABELS` 列表中根据实际模型修改类别。

## 注意事项

1. **模型文件**: 需要自行准备 `plant_disease.tflite` 模型文件
2. **网络配置**: 真机测试时需要确保手机和电脑在同一局域网
3. **权限**: 应用会自动请求相机和相册权限
4. **模型更新**: 替换模型文件后5秒内会自动重新加载
