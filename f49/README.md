# Parquet 文件查看器

一个基于 Rust + WebAssembly + React + AG-Grid 的浏览器端 Parquet 文件查看工具。

## 技术栈

- **Rust**: 核心解析逻辑，使用 parquet 和 arrow crate
- **WebAssembly**: 将 Rust 代码编译为 WASM 在浏览器中运行
- **React + TypeScript**: 前端框架
- **AG-Grid**: 高性能数据表格渲染
- **Vite**: 构建工具

## 功能特性

- 支持在浏览器中直接解析本地 .parquet 文件
- 支持多种数据类型：
  - 整数类型: Int8, Int16, Int32, Int64, UInt8, UInt16, UInt32, UInt64
  - 浮点类型: Float32, Float64
  - 字符串类型: Utf8, LargeUtf8
  - 布尔类型: Boolean
- 使用 AG-Grid 高性能渲染，支持：
  - 分页显示（每页 100 行）
  - 列排序
  - 列过滤
  - 列宽调整
  - 区域选择
- 响应式界面设计

## 前置要求

- Node.js >= 16.0.0
- Rust >= 1.70.0
- wasm-pack (`cargo install wasm-pack`)

## 安装和运行

### 1. 编译 Rust WASM 模块

```bash
npm run build-wasm
```

或者直接使用 wasm-pack：

```bash
cd parquet-wasm
wasm-pack build --target web --out-dir ../src/wasm
```

### 2. 安装前端依赖

```bash
npm install
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

## 使用方法

1. 点击"选择 Parquet 文件"按钮
2. 选择本地的 .parquet 文件
3. 等待文件解析完成
4. 在表格中查看数据，可以进行排序、过滤、分页等操作

## 项目结构

```
.
├── parquet-wasm/          # Rust WASM 模块
│   ├── src/
│   │   └── lib.rs        # 核心解析逻辑
│   └── Cargo.toml        # Rust 依赖配置
├── src/                   # React 前端
│   ├── wasm/             # 编译后的 WASM 模块（自动生成）
│   ├── App.tsx           # 主组件
│   ├── App.css           # 样式
│   ├── main.tsx          # 入口文件
│   └── index.css         # 全局样式
├── index.html            # HTML 模板
├── package.json          # npm 配置
├── tsconfig.json         # TypeScript 配置
└── vite.config.ts        # Vite 配置
```

## 核心实现说明

### Rust WASM 端 (`parquet-wasm/src/lib.rs`)

- `init_panic_hook()`: 初始化 panic hook，便于在浏览器中调试
- `parse_parquet(data: &[u8]) -> Result<String, JsValue>`: 
  - 接收 Parquet 文件的字节数组
  - 使用 `ParquetRecordBatchReaderBuilder` 读取文件
  - 将 Arrow 格式的 RecordBatch 转换为 JSON
  - 返回包含列名和行数据的 JSON 字符串

### React 端 (`src/App.tsx`)

- 动态加载 WASM 模块
- 处理文件选择和读取
- 调用 WASM 的 `parse_parquet` 函数解析文件
- 将解析结果转换为 AG-Grid 需要的格式
- 使用 AG-Grid 渲染数据表格
