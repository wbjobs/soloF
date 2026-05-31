# 模型目录

请将 LLM 模型文件放置在此目录下。

## 所需模型

### 1. Llama-3-8B GGUF 量化版

下载地址: https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct-GGUF

推荐下载:
- `llama-3-8b-instruct.Q4_K_M.gguf` (推荐，平衡速度和质量)

或其他量化版本:
- `llama-3-8b-instruct.Q2_K.gguf` (更小，更快，但质量较低)
- `llama-3-8b-instruct.Q5_K_M.gguf` (质量更高，但更慢)

### 2. BGE-M3 (自动下载)

嵌入模型 `BAAI/bge-m3` 会在首次运行时自动从 HuggingFace 下载。

## 文件结构

```
models/
├── llama-3-8b-instruct.Q4_K_M.gguf  (需要手动下载)
└── README.md
```
