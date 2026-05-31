#!/usr/bin/env python3
import typer
from pathlib import Path
import ollama
from typing import List, Optional, Dict
import sys

app = typer.Typer(help="基于本地知识库的 Ollama 聊天 CLI 工具")

CHUNK_SIZE = 3000
CHUNK_OVERLAP = 200
MAX_CONTEXT_TOKENS = 6000
MAX_HISTORY_LENGTH = 10


def estimate_tokens(text: str) -> int:
    return len(text) // 4


def read_file(file_path: Path) -> str:
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        typer.echo(f"读取文件失败: {e}", err=True)
        raise typer.Exit(1)


def split_into_chunks(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    chunks = []
    start = 0
    text_length = len(text)
    
    while start < text_length:
        end = start + chunk_size
        
        if end > text_length:
            end = text_length
        else:
            paragraph_end = text.find('\n\n', start, end)
            if paragraph_end != -1 and paragraph_end > start + chunk_size // 2:
                end = paragraph_end
            else:
                sentence_end = text.rfind('. ', start, end)
                if sentence_end != -1:
                    end = sentence_end + 2
        
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        
        start = end - overlap
        
        if end >= text_length:
            break
    
    return chunks


def summarize_chunk(client: ollama.Client, model: str, chunk: str, chunk_index: int, total_chunks: int) -> str:
    prompt = f"""请对以下文本进行简洁的摘要，保留关键信息和重要事实。
这是第 {chunk_index}/{total_chunks} 个文本块。

文本内容：
{chunk}

摘要："""
    
    try:
        response = client.generate(model=model, prompt=prompt, stream=False)
        return response.get('response', '').strip()
    except Exception as e:
        typer.echo(f"⚠️  摘要第 {chunk_index} 个文本块时出错: {e}", err=True)
        return chunk[:500] + "..."


def summarize_document(client: ollama.Client, model: str, text: str) -> str:
    chunks = split_into_chunks(text)
    
    if len(chunks) == 1:
        return text
    
    typer.echo(f"📝 文档过长，正在将文档分成 {len(chunks)} 个块进行摘要...", err=True)
    
    summaries = []
    for i, chunk in enumerate(chunks, 1):
        typer.echo(f"   正在处理第 {i}/{len(chunks)} 个文本块...", err=True)
        summary = summarize_chunk(client, model, chunk, i, len(chunks))
        summaries.append(summary)
    
    combined_summary = "\n\n".join(summaries)
    
    if estimate_tokens(combined_summary) > MAX_CONTEXT_TOKENS // 2:
        typer.echo("🔄 合并后的摘要仍然较长，正在进行二次摘要...", err=True)
        final_prompt = f"""请对以下多个文本块的摘要进行整合，生成一个连贯的完整摘要，保留所有重要信息：

{combined_summary}

整合后的完整摘要："""
        try:
            response = client.generate(model=model, prompt=final_prompt, stream=False)
            return response.get('response', '').strip()
        except Exception as e:
            typer.echo(f"⚠️  二次摘要时出错: {e}", err=True)
            return combined_summary
    
    return combined_summary


def format_chat_history(history: List[Dict[str, str]]) -> str:
    if not history:
        return ""
    
    formatted = ["对话历史："]
    for msg in history:
        if msg['role'] == 'user':
            formatted.append(f"用户: {msg['content']}")
        else:
            formatted.append(f"助手: {msg['content']}")
    
    return "\n".join(formatted)


def build_prompt(knowledge: str, question: str, history: Optional[List[Dict[str, str]]] = None) -> str:
    history_text = format_chat_history(history) if history else ""
    
    if history_text:
        prompt = f"""请基于以下知识库内容和对话历史回答用户的问题。如果知识库中没有相关信息，请如实说明。

知识库内容：
{knowledge}

{history_text}

用户当前问题：{question}

请根据知识库内容和对话历史回答当前问题："""
    else:
        prompt = f"""请基于以下知识库内容回答用户的问题。如果知识库中没有相关信息，请如实说明。

知识库内容：
{knowledge}

用户问题：{question}

请根据知识库内容回答："""
    return prompt


def stream_response(client: ollama.Client, model: str, prompt: str) -> str:
    full_response = ""
    stream = client.generate(
        model=model,
        prompt=prompt,
        stream=True
    )
    
    for chunk in stream:
        if chunk.get('response'):
            text = chunk['response']
            typer.echo(text, nl=False)
            full_response += text
    
    typer.echo()
    return full_response


def load_knowledge_base(file: Path, client: ollama.Client, model: str, no_summarize: bool = False) -> str:
    typer.echo(f"📄 正在读取知识库文件: {file}", err=True)
    knowledge_content = read_file(file)
    
    text_tokens = estimate_tokens(knowledge_content)
    typer.echo(f"📊 估算文本 Token 数: {text_tokens}", err=True)
    
    if not no_summarize and text_tokens > MAX_CONTEXT_TOKENS:
        typer.echo(f"⚠️  文本超过上下文窗口限制 ({MAX_CONTEXT_TOKENS} tokens)", err=True)
        knowledge_content = summarize_document(client, model, knowledge_content)
        summarized_tokens = estimate_tokens(knowledge_content)
        typer.echo(f"✅ 摘要完成，当前 Token 数: {summarized_tokens}", err=True)
    else:
        typer.echo("✅ 文本长度在限制范围内，直接使用", err=True)
    
    return knowledge_content


@app.command()
def chat(
    file: Path = typer.Option(..., "--file", "-f", help="知识库文件路径（文本或 Markdown 文件）", exists=True, file_okay=True, dir_okay=False),
    question: str = typer.Argument(..., help="要询问的问题"),
    model: str = typer.Option("llama3", "--model", "-m", help="Ollama 模型名称"),
    host: str = typer.Option("http://localhost:11434", "--host", help="Ollama 服务地址"),
    no_summarize: bool = typer.Option(False, "--no-summarize", help="禁用自动摘要功能，直接使用原始文本"),
    interactive: bool = typer.Option(False, "--interactive", "-i", help="完成后进入交互式对话模式"),
):
    """
    基于本地知识库文件与 Ollama 模型进行对话，流式输出回答
    """
    client = ollama.Client(host=host)
    knowledge_content = load_knowledge_base(file, client, model, no_summarize)
    
    history = []
    
    typer.echo(f"🤖 正在调用 Ollama 模型: {model}", err=True)
    typer.echo("-" * 50, err=True)
    
    try:
        prompt = build_prompt(knowledge_content, question, history)
        response = stream_response(client, model, prompt)
        
        history.append({"role": "user", "content": question})
        history.append({"role": "assistant", "content": response})
        
        typer.echo("-" * 50, err=True)
        typer.echo("✅ 回答完成", err=True)
        
        if interactive:
            typer.echo("\n💬 进入交互式对话模式（输入 quit 或 exit 退出）", err=True)
            run_repl(client, model, knowledge_content, history)
            
    except Exception as e:
        typer.echo(f"\n❌ 调用 Ollama 失败: {e}", err=True)
        typer.echo("请确保 Ollama 服务正在运行，并且模型已正确安装", err=True)
        raise typer.Exit(1)


@app.command()
def repl(
    file: Path = typer.Option(..., "--file", "-f", help="知识库文件路径（文本或 Markdown 文件）", exists=True, file_okay=True, dir_okay=False),
    model: str = typer.Option("llama3", "--model", "-m", help="Ollama 模型名称"),
    host: str = typer.Option("http://localhost:11434", "--host", help="Ollama 服务地址"),
    no_summarize: bool = typer.Option(False, "--no-summarize", help="禁用自动摘要功能，直接使用原始文本"),
):
    """
    交互式问答模式，支持多轮对话和上下文保留
    """
    client = ollama.Client(host=host)
    knowledge_content = load_knowledge_base(file, client, model, no_summarize)
    
    typer.echo(f"\n{'='*50}", err=True)
    typer.echo(f"💬 交互式问答模式", err=True)
    typer.echo(f"📚 已加载知识库: {file}", err=True)
    typer.echo(f"🤖 使用模型: {model}", err=True)
    typer.echo(f"ℹ️  输入 quit 或 exit 退出，输入 clear 清空对话历史", err=True)
    typer.echo(f"{'='*50}\n", err=True)
    
    history = []
    run_repl(client, model, knowledge_content, history)


def run_repl(client: ollama.Client, model: str, knowledge_content: str, history: List[Dict[str, str]]):
    while True:
        try:
            question = typer.prompt("\n👤 你的问题")
            question = question.strip()
            
            if not question:
                continue
            
            if question.lower() in ['quit', 'exit', 'q']:
                typer.echo("👋 再见！", err=True)
                break
            
            if question.lower() in ['clear', 'c']:
                history.clear()
                typer.echo("🔄 对话历史已清空", err=True)
                continue
            
            if question.lower() in ['history', 'h']:
                typer.echo("\n📜 对话历史：", err=True)
                for i, msg in enumerate(history):
                    role = "👤" if msg['role'] == 'user' else "🤖"
                    typer.echo(f"{role} [{i//2 + 1}]: {msg['content'][:100]}...", err=True)
                continue
            
            if len(history) > MAX_HISTORY_LENGTH * 2:
                history = history[-MAX_HISTORY_LENGTH * 2:]
                typer.echo(f"⚠️  对话历史过长，已保留最近 {MAX_HISTORY_LENGTH} 轮", err=True)
            
            typer.echo("\n🤖 回答：", err=False)
            prompt = build_prompt(knowledge_content, question, history)
            response = stream_response(client, model, prompt)
            
            history.append({"role": "user", "content": question})
            history.append({"role": "assistant", "content": response})
            
        except KeyboardInterrupt:
            typer.echo("\n\n👋 再见！", err=True)
            break
        except EOFError:
            typer.echo("\n\n👋 再见！", err=True)
            break
        except Exception as e:
            typer.echo(f"\n❌ 出错: {e}", err=True)


@app.command()
def summarize(
    file: Path = typer.Option(..., "--file", "-f", help="要摘要的文件路径（文本或 Markdown 文件）", exists=True, file_okay=True, dir_okay=False),
    model: str = typer.Option("llama3", "--model", "-m", help="Ollama 模型名称"),
    host: str = typer.Option("http://localhost:11434", "--host", help="Ollama 服务地址"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="输出文件路径（可选）"),
):
    """
    对长文档进行摘要处理
    """
    typer.echo(f"📄 正在读取文件: {file}", err=True)
    content = read_file(file)
    
    client = ollama.Client(host=host)
    
    text_tokens = estimate_tokens(content)
    typer.echo(f"📊 估算文本 Token 数: {text_tokens}", err=True)
    
    summary = summarize_document(client, model, content)
    
    typer.echo("-" * 50, err=True)
    typer.echo(summary)
    typer.echo("-" * 50, err=True)
    
    if output:
        try:
            with open(output, 'w', encoding='utf-8') as f:
                f.write(summary)
            typer.echo(f"💾 摘要已保存到: {output}", err=True)
        except Exception as e:
            typer.echo(f"❌ 保存文件失败: {e}", err=True)
    
    typer.echo("✅ 摘要完成", err=True)


@app.command()
def list_models(
    host: str = typer.Option("http://localhost:11434", "--host", help="Ollama 服务地址"),
):
    """
    列出本地可用的 Ollama 模型
    """
    try:
        client = ollama.Client(host=host)
        models = client.list()
        
        if not models.get('models'):
            typer.echo("未找到任何模型，请先使用 'ollama pull' 命令拉取模型")
            return
        
        typer.echo("📦 可用的 Ollama 模型:")
        for model in models['models']:
            typer.echo(f"  - {model['name']}")
            
    except Exception as e:
        typer.echo(f"❌ 获取模型列表失败: {e}", err=True)
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
