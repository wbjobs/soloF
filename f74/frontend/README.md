# 体素地形前端 (Voxel Terrain Frontend)

基于 Three.js 的无限体素地形前端，使用 Marching Cubes 算法和 LOD 技术。

## 功能特性

- **GPU 友好的 Marching Cubes**: 高效的等值面提取算法
- **无限地形**: 基于相机位置动态加载和卸载地形块
- **LOD 系统**: 根据距离动态调整网格密度（4 个 LOD 级别）
- **第一人称控制**: WASD 移动，鼠标视角
- **实时统计**: FPS、位置、地形块数量、三角形数量等

## 技术栈

- **Three.js**: 3D 渲染引擎
- **Vite**: 构建工具
- **JavaScript (ES6+)**: 编程语言

## 安装和运行

```bash
# 安装依赖
npm install

# 开发模式运行
npm run dev

# 构建生产版本
npm run build

# 预览生产版本
npm run preview
```

## 配置

在 `src/main.js` 中可以配置以下参数：

```javascript
// 是否使用模拟服务（不需要后端）
this.useMockService = true;

// 地形块大小
chunkSize: 32

// 视距（地形块数量）
viewDistance: 6

// LOD 距离阈值
lodDistances: [2, 4, 6, 8]

// 移动速度
this.controls.moveSpeed = 80
```

## 控制说明

| 按键 | 功能 |
|------|------|
| W | 向前移动 |
| S | 向后移动 |
| A | 向左移动 |
| D | 向右移动 |
| Space | 向上移动 |
| Shift | 向下移动 |
| 鼠标移动 | 旋转视角 |
| 鼠标左键 | 锁定/解锁鼠标 |
| ESC | 解锁鼠标 |

## 架构

```
src/
├── main.js                 # 应用入口
├── controls/
│   └── FirstPersonControls.js  # 第一人称控制器
├── services/
│   ├── TerrainService.js       # gRPC 服务客户端
│   └── MockTerrainService.js   # 模拟服务（无后端运行）
└── terrain/
    ├── Chunk.js                # 单个地形块
    ├── ChunkManager.js         # 地形块管理器
    ├── MarchingCubes.js        # Marching Cubes 算法
    ├── edgeTable.js            # 边表
    └── triTable.js             # 三角形表
```

## Marching Cubes 算法

Marching Cubes 是一种从 3D 标量场（密度场）提取等值面的经典算法：

1. **体素遍历**: 遍历密度场中的每个立方体
2. **立方体索引**: 根据 8 个顶点的密度值生成 8 位索引
3. **边表查找**: 使用索引查找哪些边与等值面相交
4. **顶点插值**: 在相交边上计算交点位置
5. **三角形表查找**: 使用索引查找三角形顶点配置
6. **网格构建**: 根据三角形配置生成最终的三角形网格

## LOD 系统

LOD（细节层次）系统根据地形块与相机的距离调整网格密度：

| LOD 级别 | 距离 | 网格密度 |
|---------|------|----------|
| 0 | < 2 块 | 最高 |
| 1 | 2-4 块 | 高 |
| 2 | 4-6 块 | 中 |
| 3 | > 6 块 | 低 |

## 性能优化

- **动态加载/卸载**: 只加载视野内的地形块
- **距离排序**: 优先加载离相机近的地形块
- **并发控制**: 限制同时加载的地形块数量
- **几何体复用**: 重用 BufferGeometry
- **LOD 切换**: 平滑过渡不同 LOD 级别

## 连接到后端

要连接到 C++ gRPC 后端：

1. 在 `src/main.js` 中设置 `this.useMockService = false`
2. 确保后端服务正在运行（默认端口 50051）
3. 配置正确的服务地址

注意：浏览器无法直接使用 gRPC，需要使用 gRPC-Web 或 Envoy 代理。
