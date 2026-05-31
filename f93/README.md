# WebGPU 3D 路径追踪预览器

一个结合 WebGPU 前端渲染和 FastAPI 后端路径追踪计算的 3D 场景预览应用。

## 功能特性

- **WebGPU 3D 渲染**: 使用 WebGPU 实时渲染 3D 场景（球体、平面、点光源）
- **交互式相机控制**: 鼠标拖拽旋转视角，滚轮缩放
- **材质参数调节**: 可调节球体和平面的反射率、粗糙度
- **路径追踪热力图**: 后端计算蒙特卡洛路径追踪亮度分布，前端叠加显示
- **结果缓存**: 相同场景参数直接返回缓存结果

## 项目结构

```
f93/
├── src/                     # 前端 TypeScript 代码
│   ├── main.ts             # 入口文件
│   ├── renderer.ts         # WebGPU 渲染器
│   ├── camera.ts           # 轨道相机控制
│   ├── types.ts            # 类型定义
│   └── style.css           # 样式文件
├── backend/                 # 后端 Python 代码
│   └── main.py             # FastAPI 服务和路径追踪
├── index.html               # HTML 入口
├── package.json             # 前端依赖
├── tsconfig.json            # TypeScript 配置
├── vite.config.ts           # Vite 配置
└── requirements.txt         # Python 依赖
```

## 运行方式

### 1. 启动后端服务

```bash
cd backend
python main.py
```

后端服务将运行在 `http://localhost:8000`

### 2. 启动前端开发服务器

```bash
npm run dev
```

前端服务将运行在 `http://localhost:5173`

### 3. 使用说明

1. 打开浏览器访问 `http://localhost:5173`
2. 使用鼠标拖拽旋转 3D 场景，滚轮缩放
3. 在右侧控制面板调节材质参数
4. 点击「计算路径追踪」按钮触发后端计算
5. 热力图将叠加显示在 3D 模型上（蓝→青→黄→红表示亮度递增）

## API 接口

- `POST /api/path-trace`: 提交场景描述，返回热力图数据
- `GET /api/cache/size`: 获取缓存大小
- `DELETE /api/cache`: 清空缓存

## 技术栈

**前端**:
- TypeScript
- WebGPU
- Vite
- gl-matrix

**后端**:
- Python 3.11+
- FastAPI
- NumPy
- Uvicorn
