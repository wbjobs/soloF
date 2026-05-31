# 地形服务后端 (Terrain Server Backend)

高性能 C++ gRPC 服务，负责生成和流式传输无限体素地形数据。

## 功能特性

- **Simplex 噪声生成**: 使用 3D Simplex 噪声和分形布朗运动 (FBM) 生成自然的地形
- **gRPC 流式传输**: 基于相机位置高效流式传输地形块数据
- **LOD 支持**: 根据距离自动计算 LOD 级别
- **高性能**: C++ 实现，支持多线程

## 依赖

- CMake >= 3.15
- C++17 编译器
- gRPC
- Protocol Buffers

## 构建

### Windows

```powershell
# 使用 vcpkg 安装依赖
vcpkg install grpc:x64-windows protobuf:x64-windows

# 构建
mkdir build
cd build
cmake .. -DCMAKE_TOOLCHAIN_FILE=[path to vcpkg]/scripts/buildsystems/vcpkg.cmake
cmake --build . --config Release
```

### Linux

```bash
# 安装依赖
sudo apt-get install build-essential cmake libgrpc++-dev protobuf-compiler-grpc libprotobuf-dev

# 构建
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build .
```

### macOS

```bash
# 安装依赖
brew install grpc protobuf cmake

# 构建
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build .
```

## 运行

```bash
# 默认端口 50051，种子 1337
./terrain_server

# 指定种子和端口
./terrain_server 42 "0.0.0.0:8080"
```

## API

### GetChunk

获取单个地形块数据。

```protobuf
rpc GetChunk(ChunkRequest) returns (ChunkData);
```

### StreamChunks

基于相机位置流式传输视野内的所有地形块（按距离排序）。

```protobuf
rpc StreamChunks(CameraRequest) returns (stream ChunkData);
```

## 噪声参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| seed | 1337 | 噪声种子 |
| frequency | 0.02 | 基础频率 |
| amplitude | 1.0 | 基础振幅 |
| octaves | 6 | FBM 层数 |
| persistence | 0.5 | 振幅衰减系数 |
| lacunarity | 2.0 | 频率倍增系数 |
