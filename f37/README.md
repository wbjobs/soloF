# 检索增强生成（RAG）系统

基于 LangChain + ChromaDB + FastAPI 的 RAG 系统，用于对 PDF 技术文档进行智能问答。

## 项目结构

```
.
├── requirements.txt      # 项目依赖
├── ingest.py             # PDF 文档入库模块
├── chain.py              # RAG 链路逻辑（检索 + 生成）
├── query.py              # FastAPI 后端接口
├── chroma_db/            # ChromaDB 向量数据库（自动生成）
└── temp_uploads/         # 临时上传目录（自动生成）
```

## 核心模块说明

### 1. ingest.py - 文档入库模块

**功能**：
- 读取本地 PDF 文档
- 使用 LangChain 进行文本切片（Chunking）
- 使用 HuggingFace 开源 Embedding 模型向量化
- 将向量存入 ChromaDB 向量数据库

**主要类**：
- `PDFIngestor`: PDF 文档处理和入库的核心类

**命令行使用**：
```bash
# 处理单个 PDF 文件
python ingest.py --path ./docs/example.pdf --collection rag_collection

# 处理整个目录下的 PDF 文件
python ingest.py --path ./docs/ --collection rag_collection
```

### 2. chain.py - RAG 链路逻辑

**功能**：
- 从 ChromaDB 检索相关文档片段
- **BGE Reranker 重排序优化**：先粗检索（默认 20 个候选），再精排序，提升检索准确度
- 组装 Prompt 发送给 LLM
- 支持模拟 LLM 和真实开源 LLM（如 Llama）

**主要类**：
- `BGEReranker`: BGE 重排序模型，用于优化检索结果排序
- `MockLLM`: 模拟 LLM，用于测试和演示
- `RAGChain`: RAG 链路的核心类，包含检索、重排序和生成逻辑

**命令行使用**：
```bash
# 测试 RAG 查询（默认启用重排序）
python chain.py --question "怎么配置网络？" --collection rag_collection --top-k 4

# 禁用重排序进行对比
python chain.py --question "怎么配置网络？" --collection rag_collection --top-k 4 --no-rerank
```

### 3. query.py - FastAPI 后端接口

**功能**：
- 提供 REST API 接口
- 支持 PDF 文件上传和入库
- 支持 RAG 问答查询
- 支持向量集合管理

**启动服务**：
```bash
python query.py
```

**API 接口**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | API 根路径，返回接口说明 |
| GET | `/health` | 健康检查 |
| POST | `/query` | RAG 问答查询 |
| POST | `/ingest` | 上传并入库单个 PDF 文件 |
| POST | `/ingest/directory` | 入库目录下所有 PDF |
| GET | `/collections` | 列出所有向量集合 |
| DELETE | `/collections/{name}` | 删除指定向量集合 |

**API 请求示例**：

POST `/query`
```json
{
    "question": "请解释一下 RAG 的工作原理？",
    "collection_name": "rag_collection",
    "top_k": 4,
    "use_mock_llm": true
}
```

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 准备 PDF 文档

将 PDF 技术文档放入 `./docs/` 目录下，或直接指定文件路径。

### 3. 文档入库

```bash
# 方式一：使用命令行
python ingest.py --path ./docs/

# 方式二：启动 API 服务后上传文件
python query.py
# 然后通过 POST /ingest 接口上传文件
```

### 4. 启动服务

```bash
python query.py
```

服务启动后，访问 http://localhost:8000/docs 查看 Swagger 文档。

### 5. 进行查询

在 Swagger 文档中测试 `/query` 接口，或使用 curl：

```bash
curl -X POST "http://localhost:8000/query" \
     -H "Content-Type: application/json" \
     -d '{"question": "你的问题", "use_mock_llm": true}'
```

## 配置说明

### Embedding 模型

默认使用 `BAAI/bge-small-zh-v1.5`，这是一个优秀的中文 Embedding 模型。

可以在 `PDFIngestor` 和 `RAGChain` 初始化时修改：
```python
ingestor = PDFIngestor(embedding_model="BAAI/bge-base-zh-v1.5")
```

### 文本切片参数

```python
ingestor = PDFIngestor(
    chunk_size=500,    # 每个 chunk 的字符数
    chunk_overlap=50   # chunk 之间的重叠字符数
)
```

### 接入真实 LLM

要接入真实的开源 LLM（如 Llama、Qwen 等），修改 `use_mock_llm=False` 并指定模型路径：

```python
rag = RAGChain(
    use_mock_llm=False,
    llm_model_path="/path/to/your/model"
)
```

## 技术栈

- **LangChain**: LLM 应用开发框架
- **ChromaDB**: 向量数据库
- **HuggingFace Transformers**: 预训练模型
- **BGE Reranker**: 交叉编码器重排序模型（FlagEmbedding）
- **FastAPI**: Web 框架
- **PyPDF**: PDF 文件处理
- **Sentence-Transformers**: 句子向量化

---

## 📌 引用溯源功能

### 功能特点

1. **自动标注引用**：回答中自动标注 `[n]` 形式的引用标记
2. **页码溯源**：每个引用对应源 PDF 的具体页码
3. **原文高亮**：前端可点击引用标记高亮对应原文片段
4. **交互体验**：点击回答中的 `[1]` 自动跳转并高亮引用来源

### API 返回示例

```json
{
  "success": true,
  "question": "怎么配置网络？",
  "answer": "根据文档说明[1]，配置网络需要以下步骤...",
  "citations": [
    {
      "citation_id": 1,
      "content": "完整的文档片段内容...",
      "source": "network_manual.pdf",
      "page": 15,
      "highlight_text": "用于前端展示的高亮原文片段..."
    }
  ],
  "citation_count": 1
}
```

### 网页演示

启动服务后访问：`http://localhost:8000/static/index.html`

功能：
- 📄 上传 PDF 文档到向量库
- 🔍 输入问题进行智能问答
- 💡 查看 AI 回答，包含引用标记
- 📚 点击 `[n]` 引用，自动高亮对应原文
- 📑 显示每个引用的页码和来源文件

### 工作原理

```
用户问题
    ↓
向量检索 → 找到相关文档片段
    ↓
LLM 生成回答 → 自动插入引用标记 [n]
    ↓
引用解析 → 提取每个引用对应的页码和原文
    ↓
前端展示 → 点击引用高亮对应原文
```

---

## 注意事项

1. 首次运行会自动下载 Embedding 模型和 Reranker 模型，需要网络连接
2. 使用真实 LLM 需要足够的 GPU 显存（建议 16GB 以上）
3. Reranker 模型在 GPU 上运行速度更快，CPU 模式稍慢但可用
4. PDF 文档建议是可复制的文本型 PDF，扫描版 PDF 需要先 OCR
5. 中文文档建议使用中文优化的 Embedding 模型（如 BGE 系列）
6. 检索效果优化：增大 `rerank_top_k`（如 30-50）可提升召回率，但会增加计算量
