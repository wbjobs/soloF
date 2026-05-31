# VST3 Plugin Host

一个轻量级的 VST3 插件宿主，使用 Rust (egui) + C++ (JUCE) 开发。

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                    Rust (GUI Layer)                     │
│  ┌──────────────┐     ┌──────────────────────────────┐  │
│  │   egui UI    │────▶│       FFI Bindings           │  │
│  └──────────────┘     └──────────────────────────────┘  │
│                                 ▲                        │
└─────────────────────────────────┼────────────────────────┘
                                  │ FFI (C ABI)
┌─────────────────────────────────▼────────────────────────┐
│                   C++ (Audio Engine)                     │
│  ┌────────────────┐    ┌──────────────────────────────┐  │
│  │  FFI Bridge    │───▶│     PluginHost (JUCE)        │  │
│  └────────────────┘    └──────────────────────────────┘  │
│                                 ▲                        │
│                                 │ VST3 SDK               │
│                                 ▼                        │
│                    ┌─────────────────────┐               │
│                    │   VST3 Plugin       │               │
│                    └─────────────────────┘               │
└──────────────────────────────────────────────────────────┘
```

## 功能特性

- ✅ 加载单个 VST3 插件
- ✅ 显示插件参数列表（滑块控制）
- ✅ 实时音频流通过
- ✅ 参数值实时更新
- ✅ 支持 Windows / macOS / Linux

## 前置要求

### 通用
- Rust 1.70+
- CMake 3.15+
- C++17 编译器

### JUCE
下载 JUCE 框架: https://juce.com/get-juce

设置环境变量:
```bash
export JUCE_DIR=/path/to/JUCE
```

### 平台特定

**Linux:**
```bash
sudo apt-get install build-essential libasound2-dev libfreetype6-dev \
    libx11-dev libxext-dev libxinerama-dev libxcursor-dev libxrandr-dev
```

**macOS:**
- Xcode Command Line Tools
- CoreAudio, AudioToolbox frameworks

**Windows:**
- Visual Studio 2019+ (with C++ desktop development)
- Windows 10 SDK

## 构建

```bash
# 设置 JUCE 路径
export JUCE_DIR=/path/to/JUCE  # Linux/macOS
# 或者
set JUCE_DIR=C:\path\to\JUCE   # Windows

# 构建
cargo build --release

# 运行
cargo run --release
```

## 使用

1. 启动程序
2. 在左侧面板的 "Plugin Path" 输入框中输入 VST3 插件路径，或点击 "Browse..." 手动输入
3. 点击 "Load" 加载插件
4. 在中央面板调整参数滑块
5. 音频会实时通过插件处理

## 项目结构

```
f56/
├── Cargo.toml              # Rust 项目配置
├── build.rs                # 构建脚本（编译 C++ 部分）
├── src/
│   ├── main.rs             # Rust 主程序 (egui 界面)
│   └── ffi.rs              # FFI 绑定
├── cpp/
│   ├── CMakeLists.txt      # C++ 构建配置
│   ├── PluginHost.h        # 插件宿主类头文件
│   ├── PluginHost.cpp      # 插件宿主实现
│   ├── ffi_bridge.h        # FFI 桥接头文件
│   └── ffi_bridge.cpp      # FFI 桥接实现
└── README.md
```

## 核心模块说明

### C++ 部分 (`cpp/`)

**PluginHost** - 插件宿主核心类：
- `initializeAudioDevice()`: 初始化音频设备（ALSA/CoreAudio/WASAPI）
- `loadPlugin()`: 加载 VST3 插件
- `getParameters()`: 获取插件参数列表
- `setParameterValue()`: 设置参数值
- `audioDeviceIOCallbackWithContext()`: 音频回调，处理实时音频流

**FFI Bridge** - 提供 C 风格接口供 Rust 调用

### Rust 部分 (`src/`)

**ffi.rs** - FFI 绑定，提供类型安全的 Rust 接口

**main.rs** - egui 界面：
- 左侧面板：插件加载控制
- 中央面板：参数滑块列表
- 状态栏：音频和插件状态显示

## 开发说明

### 添加新功能

1. 在 `PluginHost` 中添加 C++ 实现
2. 在 `ffi_bridge` 中暴露 C 接口
3. 在 `src/ffi.rs` 中添加 Rust 绑定
4. 在 `src/main.rs` 中添加 UI 交互

### 注意事项

- 所有跨线程访问都使用 `std::mutex` 保护
- FFI 字符串内存管理需要特别注意
- 音频回调是实时线程，避免阻塞操作

## 许可证

MIT License
