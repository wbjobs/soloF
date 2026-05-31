# 无限体素地形系统 (Infinite Voxel Terrain System)

基于 Marching Cubes 算法的无限体素地形生成系统，使用 GPU 加速和 LOD 技术。

## 架构

```
┌─────────────────┐        gRPC        ┌─────────────────┐
│   Three.js 前端 │ ◄────────────────► │  C++ 后端服务   │
│  - Marching Cubes│   流式地形块数据   │  - 噪声生成器   │
│  - LOD 系统      │                    │  - 区块管理     │
│  - 相机控制      │                    │  - 流式传输     │
└─────────────────┘                    └─────────────────┘
```

## 特性

- **GPU 加速的 Marching Cubes**: 使用 WebGL 着色器在 GPU 上执行等值面提取
- **无限地形**: 基于相机位置动态加载和卸载地形块
- **LOD (细节层次)**: 根据距离动态调整网格密度
- **高性能 gRPC 后端**: C++ 实现，使用流式传输高效发送地形数据
- **Simplex 噪声**: 多层噪声生成自然的地形形态

## 快速开始

### 方式一：使用 Node.js 后端（推荐，最简单）

```bash
# 1. 启动 Node.js 后端
cd server-node
npm install
npm start

# 2. 在新终端中启动前端
cd frontend
npm install
npm run dev
```

### 方式二：使用 C++ gRPC 后端（高性能）

```bash
# 1. 构建并运行 C++ 后端
cd backend
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build .
./terrain_server

# 2. 在新终端中启动前端
cd frontend
npm install
npm run dev
```

### 方式三：仅运行前端（使用模拟数据）

前端内置了模拟的噪声生成器，无需后端即可运行：

```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173 查看效果。

## 详细文档

- [后端文档](backend/README.md)
- [前端文档](frontend/README.md)
