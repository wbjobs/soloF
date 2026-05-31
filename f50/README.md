# 知识库聊天 CLI 工具

一个基于本地知识库文件的 Ollama 聊天命令行工具，支持长文档自动分块和摘要处理，以及交互式多轮对话。

## 安装依赖

```bash
pip install -r requirements.txt
```

## 核心功能

### 1. 长文档处理
当知识库文件内容超过模型上下文窗口限制（默认 6000 tokens）时，工具会自动：
1. **智能分块**：将长文本按段落和句子边界分割成多个块
2. **分块摘要**：对每个文本块进行独立摘要
3. **摘要整合**：合并所有块的摘要，必要时进行二次摘要

### 2. 交互式多轮对话
支持 REPL 模式进行连续问答：
- **上下文保留**：知识库内容永久保留在会话中
- **对话历史**：维护最近 10 轮对话历史作为上下文
- **交互命令**：支持清空历史、查看历史、退出等命令

## 使用方法

### 1. 查看帮助

```bash
python kb_chat.py --help
```

### 2. 列出可用的 Ollama 模型

```bash
python kb_chat.py list-models
```

### 3. 单次问答模式

自动检测文档长度，超过限制时自动进行摘要处理：

```bash
python kb_chat.py chat -f example_kb.md "这家公司的主营业务是什么？"
```

禁用自动摘要，直接使用原始文本（可能导致上下文溢出）：

```bash
python kb_chat.py chat -f example_kb.md "问题" --no-summarize
```

单次问答后进入交互模式：

```bash
python kb_chat.py chat -f example_kb.md "问题" -i
```

### 4. 交互式问答模式（推荐）

启动交互式会话，支持连续提问：

```bash
python kb_chat.py repl -f example_kb.md
```

在交互模式中可用的命令：
- `quit` / `exit` / `q`：退出程序
- `clear` / `c`：清空对话历史
- `history` / `h`：查看对话历史摘要

### 5. 单独使用文档摘要功能

```bash
python kb_chat.py summarize -f long_document.md
```

保存摘要到文件：

```bash
python kb_chat.py summarize -f long_document.md -o summary.md
```

### 6. 指定模型和服务地址

```bash
python kb_chat.py repl -f example_kb.md -m llama2 --host http://localhost:11434
```

## 参数说明

### chat 命令
- `-f, --file`: 知识库文件路径（文本或 Markdown 文件）
- `-m, --model`: Ollama 模型名称，默认为 llama3
- `--host`: Ollama 服务地址，默认为 http://localhost:11434
- `--no-summarize`: 禁用自动摘要功能
- `-i, --interactive`: 回答完成后进入交互式对话模式
- `question`: 要询问的问题（位置参数）

### repl 命令
- `-f, --file`: 知识库文件路径（文本或 Markdown 文件）
- `-m, --model`: Ollama 模型名称，默认为 llama3
- `--host`: Ollama 服务地址，默认为 http://localhost:11434
- `--no-summarize`: 禁用自动摘要功能

### summarize 命令
- `-f, --file`: 要摘要的文件路径
- `-m, --model`: Ollama 模型名称，默认为 llama3
- `--host`: Ollama 服务地址
- `-o, --output`: 输出文件路径（可选）

## 配置参数

可在代码中调整以下参数：
- `CHUNK_SIZE`: 单块文本大小（默认 3000 字符）
- `CHUNK_OVERLAP`: 块重叠大小（默认 200 字符）
- `MAX_CONTEXT_TOKENS`: 触发摘要的 token 阈值（默认 6000）
- `MAX_HISTORY_LENGTH`: 保留的最大对话轮数（默认 10 轮）

## 前置要求

1. 安装并启动 Ollama 服务：https://ollama.com/
2. 拉取所需的模型，例如：
   ```bash
   ollama pull llama3
   ```
