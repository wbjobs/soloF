# 🎵 AI 音乐生成器

基于 Next.js + Python FastAPI + Magenta.js 的 AI 音乐生成应用。

## 功能特性

- 🎹 **简谱输入**：点击钢琴键输入最多 8 小节的旋律
- 🎭 **曲风选择**：支持爵士、古典、电子三种曲风
- 😊 **情绪选择**：欢快、悲伤、激昂三种情绪风格
- 🤖 **AI 生成**：基于输入旋律自动续写 16 小节音乐
- 🎼 **钢琴卷帘编辑器**：可视化编辑音符，支持拖拽移动和调整时长
- 🎧 **实时播放**：使用 Tone.js 实时播放生成的音乐
- 💾 **导出功能**：支持导出 MIDI 文件

## 项目结构

```
.
├── frontend/           # Next.js 前端
│   ├── app/
│   │   ├── page.tsx    # 主页面
│   │   ├── layout.tsx  # 布局
│   │   └── globals.css # 全局样式
│   ├── components/
│   │   ├── SimpleInput.tsx  # 简谱输入组件
│   │   └── PianoRoll.tsx    # 钢琴卷帘编辑器
│   └── package.json
└── backend/            # FastAPI 后端
    ├── main.py         # API 主文件
    └── requirements.txt
```

## 快速开始

### 1. 安装并启动后端

```bash
cd backend
pip install -r requirements.txt
python main.py
```

后端将在 http://localhost:8000 启动

### 2. 安装并启动前端

```bash
cd frontend
npm install
npm run dev
```

前端将在 http://localhost:3000 启动

## 使用说明

1. **输入简谱**：在左侧点击钢琴键，输入旋律作为 AI 创作的起点（最多 8 小节）
2. **选择参数**：选择曲风、情绪，调整创意度滑块
3. **生成音乐**：点击"生成 16 小节音乐"按钮
4. **编辑音符**：在钢琴卷帘中拖拽移动音符，拖拽右侧边缘调整时长，双击添加新音符
5. **播放与导出**：点击播放按钮试听，满意后导出 MIDI 文件

## 技术栈

**前端**：
- Next.js 14
- React 18
- TypeScript
- Tailwind CSS
- Tone.js（音频播放）
- Magenta.js（音乐 AI）

**后端**：
- FastAPI
- Python 3.9+
- NumPy

## API 文档

启动后端后，访问 http://localhost:8000/docs 查看 API 文档。

### 主要接口

- `POST /api/generate` - 生成音乐
  - 请求体：`{ style, emotion, input_notes, temperature }`
  - 返回：生成的音符列表和 Base64 编码的 MIDI 文件

## 开发说明

### 前端开发

```bash
cd frontend
npm run dev
```

### 后端开发

```bash
cd backend
uvicorn main:app --reload
```

## 许可证

MIT
