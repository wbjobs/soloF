# 蛋白质分子3D可视化系统

一个基于Three.js和Node.js的蛋白质分子3D可视化应用，支持PDB文件上传、解析和交互式3D渲染。

## 功能特性

### 后端
- Node.js + Koa 服务器
- PDB文件解析，提取ATOM记录
- MinIO对象存储集成
- RESTful API接口
  - `POST /api/upload` - 上传PDB文件
  - `GET /api/molecule/:id` - 获取分子数据

### 前端
- Three.js 3D渲染
- WebGL渲染器（高性能）
- 元素类型颜色映射（C/N/O/S等元素不同颜色）
- 鼠标交互
  - 左键拖动：旋转模型
  - 滚轮：缩放
  - 右键拖动：平移
  - 点击原子：显示详细信息
- 原子信息面板（元素类型、坐标、残基名称等）

## 项目结构

```
f23/
├── backend/
│   ├── src/
│   │   ├── server.js          # Koa服务器入口
│   │   ├── routes/
│   │   │   └── index.js       # API路由
│   │   ├── utils/
│   │   │   └── pdbParser.js   # PDB文件解析器
│   │   └── config/
│   │       └── minio.js       # MinIO配置
│   └── package.json
└── frontend/
    ├── src/
    │   └── main.js            # Three.js可视化核心
    ├── index.html             # 前端入口页面
    ├── vite.config.js         # Vite配置
    └── package.json
```

## 环境要求

- Node.js >= 16.0.0
- MinIO 对象存储服务

## 安装和运行

### 1. 启动MinIO服务

使用Docker启动MinIO：
```bash
docker run -p 9000:9000 -p 9001:9001 \
  --name minio \
  -e "MINIO_ROOT_USER=minioadmin" \
  -e "MINIO_ROOT_PASSWORD=minioadmin" \
  minio/minio server /data --console-address ":9001"
```

或使用本地安装的MinIO：
```bash
minio server ./data
```

### 2. 启动后端服务

```bash
cd backend
npm install
npm start
```

后端服务将在 http://localhost:3000 启动

### 3. 启动前端服务

```bash
cd frontend
npm install
npm run dev
```

前端服务将在 http://localhost:5173 启动

## 使用说明

1. 打开浏览器访问 http://localhost:5173
2. 点击"选择文件"按钮，选择一个PDB格式的蛋白质文件
3. 点击"上传并渲染"按钮
4. 使用鼠标与3D模型交互：
   - 左键拖动旋转
   - 滚轮缩放
   - 右键拖动平移
   - 点击任意原子查看详细信息

## 元素颜色映射

| 元素 | 颜色 |
|------|------|
| C (碳) | 灰色 |
| N (氮) | 蓝色 |
| O (氧) | 红色 |
| H (氢) | 白色 |
| S (硫) | 黄色 |
| P (磷) | 橙色 |
| F/Cl (氟/氯) | 绿色 |
| Br (溴) | 深红 |
| I (碘) | 紫色 |
| Fe/CA/Mg/Zn (金属) | 灰色 |

## API文档

### 上传PDB文件

```
POST /api/upload
Content-Type: multipart/form-data

参数:
  - file: PDB文件

响应:
{
  "success": true,
  "moleculeId": "uuid-string",
  "fileName": "original-filename.pdb"
}
```

### 获取分子数据

```
GET /api/molecule/:id

响应:
{
  "success": true,
  "moleculeId": "uuid-string",
  "atoms": [
    {
      "id": 1,
      "name": "N",
      "element": "N",
      "x": 12.345,
      "y": 67.890,
      "z": 12.345,
      "resName": "ALA",
      "chainID": "A",
      "resSeq": 1,
      "occupancy": 1.0,
      "tempFactor": 0.0
    }
  ]
}
```

## 技术栈

**后端:**
- Node.js
- Koa 2
- koa-body (文件上传)
- MinIO SDK (对象存储)
- uuid (生成唯一ID)

**前端:**
- Three.js (3D渲染)
- Vite (构建工具)
- OrbitControls (交互控制)

## 注意事项

1. 确保MinIO服务正常运行
2. PDB文件大小限制为50MB
3. 浏览器需要支持WebGL（现代浏览器均支持）
4. 建议使用Chrome或Firefox浏览器以获得最佳体验

## 更新日志

### v1.2.0
- **新增**: 原子距离测量功能
  - 测量模式切换
  - 点击两个原子计算欧氏距离
  - 3D场景中显示测量线和距离标签（Å 埃单位）
  - 测量结果历史记录显示
  - 清除所有测量功能
  
- **新增**: 后端API原子过滤功能
  - 按残基名称过滤（resName，支持多个逗号分隔）
  - 按元素类型过滤（element）
  - 按记录类型过滤（recordType: ATOM/HETATM）
  - 按链ID过滤（chainID）
  - 新增 `/api/molecule/:id/metadata` 端点获取分子元数据

- **新增**: 前端过滤UI
  - 残基名称过滤输入框
  - 元素类型过滤输入框
  - 记录类型下拉选择
  - 应用过滤和清除过滤按钮

### v1.1.0
- **修复**: WebGL渲染器兼容性问题
  - 添加WebGL2检测和自动回退到WebGL机制
  - 增强Firefox浏览器兼容性
  - 添加高性能GPU偏好设置
  
- **修复**: PDB解析器HETATM记录支持
  - 完整解析HETATM（非标准残基）记录
  - 添加安全的字符串和数值解析函数
  - 增强解析鲁棒性，防止异常行导致解析失败
  - 添加记录类型字段（ATOM/HETATM）到原子数据
  - HETATM原子视觉区分（半透明、不同光泽度）
  - 控制台输出解析统计信息
