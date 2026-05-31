# PDF to Markdown Converter

一个智能的 PDF 科研论文转 Markdown 工具，支持数学公式识别并转换为 LaTeX 格式。

## ✨ 功能特性

- 📁 **PDF 上传**: 支持拖拽上传，最大 20MB
- 🔢 **公式识别**: 自动识别行内和行间数学公式，转换为 LaTeX
- 📊 **实时进度**: 转换过程实时显示进度和状态
- 📝 **Markdown 编辑器**: 内置编辑器，支持编辑/预览/分屏模式
- 🎯 **公式预览**: 高亮显示所有识别的公式，支持复制 LaTeX 代码
- 💾 **导出下载**: 一键下载转换后的 Markdown 文件
- 🚀 **异步处理**: 基于 Celery 的异步任务处理
- ☁️ **对象存储**: 使用 MinIO 存储文件和结果

## 🛠️ 技术栈

### 后端
- **FastAPI**: 现代、快速的 Web 框架
- **Celery**: 异步任务队列
- **Redis**: 任务状态存储和消息代理
- **MinIO**: 对象存储服务
- **pdf2image**: PDF 转图片
- **OpenCV**: 图像处理和公式区域检测
- **Mathpix API**: 数学公式 OCR 识别

### 前端
- **React 18**: 用户界面框架
- **ReactMarkdown**: Markdown 渲染
- **KaTeX**: LaTeX 数学公式渲染
- **remark-math / rehype-katex**: 数学公式处理插件

## 🚀 快速开始

### 环境要求
- Docker & Docker Compose
- Mathpix API Key (可选，用于公式识别)

### 启动步骤

1. **克隆项目**
```bash
git clone <repository-url>
cd pdf-to-markdown
```

2. **配置环境变量**
```bash
cp .env.example .env
```

编辑 `.env` 文件，配置 Mathpix API（可选）：
```env
MATHPIX_APP_ID=your_app_id
MATHPIX_APP_KEY=your_app_key
```

3. **启动所有服务**
```bash
docker-compose up -d
```

4. **访问应用**
- 前端界面: http://localhost:3000
- 后端 API: http://localhost:8000
- API 文档: http://localhost:8000/docs
- MinIO 控制台: http://localhost:9001 (minioadmin/minioadmin)

## 📁 项目结构

```
.
├── backend/                 # 后端服务
│   ├── app/
│   │   ├── api/            # API 路由
│   │   ├── core/           # 核心配置 (Celery, Config)
│   │   ├── services/       # 业务服务
│   │   └── tasks/          # Celery 任务
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/               # 前端应用
│   ├── src/
│   │   ├── components/     # React 组件
│   │   └── services/       # API 服务
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml      # Docker 编排
├── .env.example           # 环境变量示例
└── README.md
```

## 🔧 API 接口

### 文件上传
```http
POST /api/upload
Content-Type: multipart/form-data
```

### 任务状态查询
```http
GET /api/task/{task_id}
```

### 获取转换结果
```http
GET /api/result/{file_id}
```

### 更新 Markdown
```http
PUT /api/result/{file_id}?markdown=...
```

### 下载 Markdown
```http
GET /api/download/{file_id}
```

## 📊 核心服务说明

### 1. PDF 处理服务 (`pdf_processor.py`)
- 使用 pdf2image 将 PDF 每页转为图片
- 使用 OpenCV 进行轮廓检测，识别公式区域
- 根据大小、宽高比等特征区分行内和行间公式

### 2. 数学公式 OCR (`math_ocr.py`)
- 集成 Mathpix API 进行高精度公式识别
- 支持本地 fallback 模式（无需 API Key）
- 批量处理识别到的公式区域

### 3. 存储服务 (`storage.py`)
- MinIO 对象存储集成
- 支持 PDF、Markdown、公式图片存储
- 预签名 URL 下载

### 4. 异步任务 (`tasks/conversion.py`)
- Celery 异步处理转换任务
- 实时更新任务进度
- 失败自动重试机制

## 🎨 界面预览

### 上传页面
- 拖拽上传区域
- 文件大小限制提示
- 友好的视觉反馈

### 转换中
- 实时进度条
- 转换步骤提示
- 文件名显示

### 结果页面
- 公式列表（支持筛选：全部/行内/行间）
- Markdown 编辑器（编辑/预览/分屏）
- 一键保存和下载

## 🔐 环境变量配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| MATHPIX_APP_ID | Mathpix API ID | - |
| MATHPIX_APP_KEY | Mathpix API Key | - |
| REDIS_URL | Redis 连接地址 | redis://localhost:6379/0 |
| MINIO_ENDPOINT | MinIO 地址 | localhost:9000 |
| MINIO_ACCESS_KEY | MinIO 访问密钥 | minioadmin |
| MINIO_SECRET_KEY | MinIO 密钥 | minioadmin |
| MAX_PDF_SIZE | 最大 PDF 大小 (字节) | 20971520 |

## 🧪 本地开发

### 后端开发
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### 前端开发
```bash
cd frontend
npm install
npm start
```

### 启动 Celery Worker
```bash
cd backend
celery -A app.core.celery_app worker --loglevel=info
```

## 📝 使用说明

1. 上传 PDF 科研论文
2. 等待系统自动识别和转换
3. 在公式预览区查看识别到的数学公式
4. 在编辑器中修正转换结果
5. 保存并下载 Markdown 文件

## ⚠️ 注意事项

- 首次启动需要拉取 Docker 镜像，可能需要较长时间
- 不配置 Mathpix API 时，使用 fallback 模式（公式识别精度较低）
- PDF 文件越大，转换时间越长
- 系统支持最多显示 50 个公式

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 License

MIT License
