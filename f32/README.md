# 卫星遥感 NDVI 分析工具

基于 Rust + WASM + React 的高性能卫星遥感影像处理工具，用于计算归一化植被指数 (NDVI)。

## 技术架构

- **核心算法**: Rust 编写的 NDVI 计算库，编译为 WASM
- **前端框架**: React + TypeScript
- **影像解析**: geotiff.js
- **可视化**: HTML5 Canvas 伪彩色渲染

## 项目结构

```
f32/
├── ndvi-wasm/                 # Rust WASM 模块
│   ├── src/
│   │   └── lib.rs            # NDVI 核心算法（批量处理 + 取消标志）
│   ├── Cargo.toml            # Rust 项目配置
│   └── package.json          # npm 包封装
├── src/
│   ├── workers/              # Web Worker
│   │   └── ndvi.worker.ts    # NDVI 计算 Worker
│   ├── components/           # React 组件
│   │   ├── FileUpload.tsx
│   │   ├── BandCanvas.tsx
│   │   ├── NDVICanvas.tsx
│   │   └── NDVIStats.tsx
│   ├── services/             # 服务层
│   │   ├── geotiffService.ts # GeoTIFF 解析
│   │   └── ndviService.ts    # NDVI 计算服务（Worker 封装）
│   ├── types/                # 类型定义
│   │   └── ndvi-wasm.d.ts    # WASM 模块类型
│   ├── types.ts              # 应用类型定义
│   ├── App.tsx               # 主应用组件（进度条 + 取消功能）
│   ├── main.tsx              # 入口文件
│   └── index.css             # 样式文件
├── package.json
├── tsconfig.json
├── vite.config.ts
└── index.html
```

## 前置要求

1. **安装 Rust**: https://www.rust-lang.org/tools/install
2. **安装 wasm-pack**: 
   ```bash
   cargo install wasm-pack
   ```
3. **安装 Node.js**: https://nodejs.org/

## 构建和运行

### 1. 安装 npm 依赖

```bash
npm install
```

### 2. 编译 Rust WASM 模块

```bash
npm run build-wasm
```

或者手动进入目录编译：

```bash
cd ndvi-wasm
wasm-pack build --target web
cd ..
```

### 3. 启动开发服务器

```bash
npm run dev
```

应用将在 http://localhost:3000 启动

### 4. 构建生产版本

```bash
npm run build
```

## 使用说明

1. 上传 GeoTIFF 格式的卫星遥感影像文件（.tif 或 .tiff）
2. 选择红波段 (Red) 和近红外波段 (NIR)
3. 点击"计算 NDVI (WASM)"按钮
4. 查看 NDVI 伪彩色图和统计信息

## NDVI 计算原理

归一化植被指数 (NDVI) 计算公式：

```
NDVI = (NIR - Red) / (NIR + Red)
```

取值范围：[-1, 1]
- 负值：水体、云、雪等
- 接近 0：岩石、裸土等
- 正值：植被覆盖（值越高植被越茂密）

## 颜色映射

- 红色 (-1.0 ~ 0.0)：低植被覆盖或非植被
- 黄色 (0.0 ~ 0.5)：中等植被覆盖
- 绿色 (0.5 ~ 1.0)：高植被覆盖
