# 3D矩阵变换可视化工具

基于 WebAssembly + Rust + Three.js 的 3D 矩阵变换可视化工具，使用 Vue3 + TypeScript 前端和 Fastify 后端。

## 功能特性

- ✅ **4×4 矩阵实时编辑** - 手动输入矩阵值，实时观察立方体变换
- ✅ **预设变换** - 单位矩阵、平移、旋转、缩放一键应用
- ✅ **矩阵运算** - 矩阵乘法、求逆、特征分解
- ✅ **3D 可视化** - 使用 Three.js 实时渲染立方体变换效果
- ✅ **历史记录** - 记录每次计算，支持查看和清空历史
- ✅ **WebAssembly 加速** - Rust 编译的 WASM 模块提供高性能矩阵计算

## 技术栈

### 前端
- Vue 3 + TypeScript
- Three.js (3D 渲染)
- Vite (构建工具)

### 后端
- Fastify (Node.js Web 框架)
- Rust + WebAssembly (矩阵计算)
- wasm-bindgen (WASM 绑定)
- nalgebra (Rust 线性代数库)

## 项目结构

```
f11/
├── src/                    # 前端源代码
│   ├── components/
│   │   └── ThreeScene.vue # Three.js 3D 场景组件
│   ├── types/
│   │   └── index.ts        # TypeScript 类型定义
│   ├── App.vue             # 主应用组件
│   ├── main.ts             # 应用入口
│   └── style.css           # 全局样式
├── server/
│   └── index.ts            # Fastify 后端服务
├── wasm/
│   ├── src/
│   │   └── lib.rs          # Rust WASM 矩阵计算模块
│   └── Cargo.toml          # Rust 项目配置
├── index.html              # HTML 入口
├── vite.config.ts          # Vite 配置
├── tsconfig.json           # TypeScript 配置
└── package.json            # Node.js 依赖配置
```

## 安装与运行

### 前置要求

1. **Node.js** (v18+)
2. **Rust** (最新稳定版)
   - Windows: 从 https://rustup.rs/ 安装 rustup
   - Linux/macOS: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
3. **wasm-pack**
   - `cargo install wasm-pack`

### 安装依赖

```bash
npm install
```

### 开发模式运行

#### 方式一：同时启动所有服务（推荐）

```bash
npm run dev
```

这将同时启动：
- 后端 API 服务 (端口 8080)
- 前端开发服务器 (端口 3000)
- WASM 模块监听编译

#### 方式二：分别启动

1. **启动后端服务** (新终端):
```bash
npm run dev:server
```

2. **启动前端开发服务** (新终端):
```bash
npm run dev:client
```

3. **编译 WASM 模块** (新终端):
```bash
npm run dev:wasm
```

### 生产构建

```bash
npm run build
```

## 使用说明

### 1. 预设变换

点击侧边栏的预设按钮快速应用常见变换：
- **单位矩阵** - 重置立方体到初始状态
- **平移变换** - 将立方体沿 XYZ 轴平移
- **旋转变换** - 将立方体绕 Z 轴旋转 45°
- **缩放变换** - 对立方体进行非均匀缩放

### 2. 手动编辑矩阵

直接在 4×4 矩阵输入框中修改数值，立方体将实时应用变换。

### 3. 矩阵运算

- **矩阵乘法** - 输入矩阵 B，点击 "A × B" 将结果应用到变换矩阵
- **求逆矩阵** - 计算当前矩阵的逆矩阵（显示在结果区域）
- **特征分解** - 计算矩阵的特征值

### 4. 3D 场景控制

- **鼠标左键拖动** - 旋转视角
- **鼠标右键拖动** - 平移视角
- **滚轮** - 缩放视角

### 5. 历史记录

所有矩阵运算都会记录在历史列表中，可点击"清空历史"清除。

## API 接口

### POST /api/matrix/multiply
矩阵乘法运算

**请求体:**
```json
{
  "matrixA": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
  "matrixB": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
}
```

**响应:**
```json
{
  "success": true,
  "data": [...]
}
```

### POST /api/matrix/inverse
矩阵求逆运算

### POST /api/matrix/eigen
矩阵特征分解

### GET /api/history
获取计算历史记录

### DELETE /api/history
清空计算历史

## WASM 模块功能

Rust WASM 模块提供以下函数：

- `matrix_multiply(a, b)` - 4×4 矩阵乘法
- `matrix_inverse(matrix)` - 矩阵求逆
- `matrix_eigen(matrix)` - 特征值分解
- `identity_matrix()` - 生成单位矩阵
- `translation_matrix(x, y, z)` - 生成平移矩阵
- `rotation_matrix(angle, axis_x, axis_y, axis_z)` - 生成旋转矩阵
- `scale_matrix(x, y, z)` - 生成缩放矩阵
- `transform_point(matrix, x, y, z)` - 变换三维点

## 注意事项

1. 首次运行需要安装 Rust 和 wasm-pack
2. WASM 模块编译可能需要较长时间（首次编译）
3. 确保端口 3000 和 8080 未被占用
4. 如果 Rust 环境不可用，后端会使用纯 JavaScript 实现的矩阵计算

## 故障排除

### 问题：WASM 编译失败
**解决：** 确保已安装 Rust 和 wasm-pack，运行 `rustup update` 更新工具链。

### 问题：后端 API 请求失败
**解决：** 检查后端服务是否正常运行在 8080 端口，查看控制台日志。

### 问题：3D 场景不显示
**解决：** 检查浏览器是否支持 WebGL，尝试刷新页面。

## 许可证

MIT License
