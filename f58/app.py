import os
import re
import tempfile
import streamlit as st
from pathlib import Path

from src.config import Config
from src.data_processor import DataProcessor
from src.retriever import Retriever
from src.generator import AnswerGenerator

st.set_page_config(
    page_title="法律卷宗检索工具",
    page_icon="⚖️",
    layout="wide"
)

st.title("⚖️ 离线法律卷宗检索工具")
st.markdown("---")

@st.cache_resource(show_spinner=False)
def init_data_processor():
    try:
        return DataProcessor()
    except Exception as e:
        st.error(f"初始化数据处理器失败: {str(e)}")
        return None

@st.cache_resource(show_spinner=False)
def init_retriever(_data_processor):
    if _data_processor is None:
        return None
    try:
        vector_store = _data_processor.get_vector_store()
        return Retriever(vector_store)
    except Exception as e:
        st.error(f"初始化检索器失败: {str(e)}")
        return None

@st.cache_resource(show_spinner=False)
def init_generator(_retriever):
    if _retriever is None:
        return None
    try:
        return AnswerGenerator(_retriever)
    except FileNotFoundError as e:
        st.warning(str(e))
        return None
    except Exception as e:
        st.error(f"初始化生成器失败: {str(e)}")
        return None

data_processor = init_data_processor()
retriever = init_retriever(data_processor)
generator = init_generator(retriever)

if "current_sources" not in st.session_state:
    st.session_state["current_sources"] = []
if "current_cited_sources" not in st.session_state:
    st.session_state["current_cited_sources"] = []

with st.sidebar:
    st.header("📁 文档管理")

    uploaded_files = st.file_uploader(
        "上传法律卷宗 (PDF)",
        type=["pdf"],
        accept_multiple_files=True
    )

    if uploaded_files and data_processor is not None:
        if st.button("处理并索引文档", type="primary"):
            with st.spinner("正在处理文档..."):
                total_splits = 0
                for uploaded_file in uploaded_files:
                    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_file:
                        tmp_file.write(uploaded_file.read())
                        tmp_path = tmp_file.name

                    try:
                        splits_count = data_processor.process_pdf(tmp_path)
                        total_splits += splits_count
                        st.success(f"✅ {uploaded_file.name} 处理完成，生成 {splits_count} 个片段")
                    except Exception as e:
                        st.error(f"❌ 处理 {uploaded_file.name} 失败: {str(e)}")
                    finally:
                        os.unlink(tmp_path)

                st.success(f"🎉 所有文档处理完成，共生成 {total_splits} 个片段")
                st.cache_resource.clear()

    st.markdown("---")
    st.subheader("⚙️ 系统设置")

    chunk_size = st.slider("切片大小", 200, 1000, Config.CHUNK_SIZE, 50)
    chunk_overlap = st.slider("重叠大小", 0, 200, Config.CHUNK_OVERLAP, 10)
    top_k = st.slider("检索数量", 1, 10, Config.TOP_K, 1)

    st.markdown("---")
    st.subheader("🔗 多跳检索")
    multi_hop_enabled = st.toggle(
        "启用多跳检索",
        value=True,
        help="自动识别复杂问题（对比、分析、总结等）并进行多轮检索"
    )
    force_multi_hop = st.checkbox(
        "强制多跳检索",
        value=False,
        help="即使是简单问题也使用多跳检索"
    )

    if generator is not None:
        generator.set_multi_hop_enabled(multi_hop_enabled)

    if st.button("清除数据库"):
        if data_processor is not None:
            data_processor.clear_database()
            st.cache_resource.clear()
            st.session_state["current_sources"] = []
            st.session_state["current_cited_sources"] = []
            st.session_state["retrieval_stats"] = {}
            st.success("数据库已清除")

    st.markdown("---")
    st.caption("💡 本工具完全离线运行，所有数据保存在本地")

col1, col2 = st.columns([2, 1])

with col1:
    st.subheader("🔍 智能问答")

    question = st.text_input(
        "请输入您的问题",
        placeholder="例如：对比案例A和案例B的判决差异",
        key="question_input"
    )

    question_type_info = st.empty()
    if question and generator is not None:
        q_type = generator.detect_question_type(question)
        if q_type.get("is_multi_hop", False):
            type_names = {
                "comparison": "对比分析型",
                "analysis": "关系分析型",
                "synthesis": "综合总结型",
                "enumeration": "列举型",
                "combination": "组合型",
                "causal": "因果分析型"
            }
            type_name = type_names.get(q_type["question_type"], "复杂问题")
            question_type_info.info(f"🧠 检测到{type_name}问题，将使用多跳检索")
        else:
            question_type_info.caption("💡 简单问题，使用标准检索")

    col_ask, col_clear = st.columns([1, 1])
    with col_ask:
        ask_button = st.button("获取回答", type="primary", use_container_width=True)
    with col_clear:
        clear_button = st.button("清空对话", use_container_width=True)

    if clear_button:
        st.session_state["history"] = []
        st.session_state["current_sources"] = []
        st.session_state["current_cited_sources"] = []
        st.session_state["retrieval_stats"] = {}
        st.rerun()

    if "history" not in st.session_state:
        st.session_state["history"] = []
    if "retrieval_stats" not in st.session_state:
        st.session_state["retrieval_stats"] = {}

    if ask_button and question:
        if generator is None:
            st.error("⚠️ 生成模型未初始化，请检查LLM模型文件是否存在")
        else:
            with st.spinner("正在检索相关内容并生成回答..."):
                try:
                    all_sources = generator.get_sources_for_question(question, force_multi_hop)
                    st.session_state["current_sources"] = all_sources

                    answer_placeholder = st.empty()
                    status_placeholder = st.empty()
                    final_answer = ""
                    final_cited_sources = []
                    final_stats = {}
                    final_retrieval_stats = {}

                    for result in generator.generate_stream(question, force_multi_hop):
                        current_answer, cited_sources, stats, retrieval_stats = result
                        display_answer = re.sub(r'REF-\d+-[a-f0-9]+', '⏳', current_answer)
                        display_answer = re.sub(r'<\|.*?\|>', '', display_answer)
                        answer_placeholder.markdown(display_answer + "▌")

                        if retrieval_stats and retrieval_stats.get("is_multi_hop"):
                            sub_queries = retrieval_stats.get("sub_queries", [])
                            if sub_queries:
                                status_text = f"🔗 多跳检索进行中... 已执行 {len(sub_queries)} 个子查询"
                                status_placeholder.caption(status_text)

                        if cited_sources is not None:
                            final_answer = current_answer
                            final_cited_sources = cited_sources
                            final_stats = stats
                            final_retrieval_stats = retrieval_stats

                    answer_placeholder.markdown(final_answer)
                    status_placeholder.empty()
                    st.session_state["current_cited_sources"] = final_cited_sources
                    st.session_state["retrieval_stats"] = final_retrieval_stats

                    if final_retrieval_stats.get("is_multi_hop", False):
                        st.success(f"✅ 多跳检索完成，共执行 {final_retrieval_stats.get('total_sub_queries', 0)} 个子查询")

                    if final_stats and final_stats.get("invalid_mentions", 0) > 0:
                        st.caption(f"⚠️ 已过滤 {final_stats['invalid_mentions']} 个无效引用")

                    st.session_state["history"].append({
                        "question": question,
                        "answer": final_answer,
                        "all_sources": all_sources,
                        "cited_sources": final_cited_sources,
                        "stats": final_stats,
                        "retrieval_stats": final_retrieval_stats
                    })

                except Exception as e:
                    st.error(f"生成回答失败: {str(e)}")

    if st.session_state["history"]:
        st.markdown("---")
        st.subheader("📜 对话历史")
        for i, item in enumerate(reversed(st.session_state["history"])):
            with st.expander(f"Q: {item['question']}", expanded=(i == 0)):
                st.markdown("**回答：**")
                st.write(item["answer"])
                if item.get("cited_sources"):
                    st.markdown("**引用来源：**")
                    for src in item["cited_sources"]:
                        st.caption(f"[{src['number']}] {src['source']} (第 {src['page']} 页)")

with col2:
    st.subheader("📚 引用来源")

    retrieval_stats = st.session_state.get("retrieval_stats", {})
    if retrieval_stats.get("is_multi_hop", False):
        type_names = {
            "comparison": "对比分析",
            "analysis": "关系分析",
            "synthesis": "综合总结",
            "enumeration": "列举",
            "combination": "组合",
            "causal": "因果分析",
            "forced": "强制多跳"
        }
        q_type = type_names.get(retrieval_stats.get("question_type", ""), "复杂")
        st.info(f"🔗 多跳检索模式 · {q_type}")

        sub_queries = retrieval_stats.get("sub_queries", [])
        if sub_queries:
            with st.expander(f"📋 子查询 ({len(sub_queries)}个)", expanded=False):
                for i, sq in enumerate(sub_queries, 1):
                    st.caption(f"{i}. {sq}")

        unique_docs = retrieval_stats.get("unique_docs", 0)
        total_docs = retrieval_stats.get("total_docs_before_dedup", 0)
        if total_docs > 0:
            st.caption(f"📊 检索统计: 去重前 {total_docs} 条 → 去重后 {unique_docs} 条")

    if st.session_state["current_cited_sources"]:
        st.success(f"✅ 实际引用 {len(st.session_state['current_cited_sources'])} 个来源")
        for src in st.session_state["current_cited_sources"]:
            expander_title = f"[{src['number']}] {src['source']} (第 {src['page']} 页)"
            if src.get("sub_query"):
                expander_title += f" · 子查询匹配"
            with st.expander(expander_title, expanded=True):
                st.info(src["content"])
                if src.get("sub_query"):
                    st.caption(f"匹配子查询: {src['sub_query']}")
                st.caption(f"引用编号: [{src['number']}]")

    elif st.session_state["current_sources"]:
        st.info(f"检索到 {len(st.session_state['current_sources'])} 个相关片段（未被引用）")
        for i, src in enumerate(st.session_state["current_sources"], 1):
            expander_title = f"候选 {i}: {src['source']} (第 {src['page']} 页)"
            if src.get("sub_query"):
                expander_title += f" · 子查询匹配"
            with st.expander(expander_title, expanded=False):
                st.info(src["content"])
                if src.get("sub_query"):
                    st.caption(f"匹配子查询: {src['sub_query']}")
    else:
        if question and retriever is not None:
            try:
                docs = retriever.search(question)
                if docs:
                    st.info(f"检索到 {len(docs)} 个相关片段")
                    for i, doc in enumerate(docs, 1):
                        source = doc.metadata.get("source", "未知来源")
                        page = doc.metadata.get("page", "未知页码")
                        with st.expander(f"候选 {i}: {source} (第 {page} 页)", expanded=False):
                            st.info(doc.page_content)
                else:
                    st.info("未检索到相关内容")
            except Exception as e:
                st.error(f"检索失败: {str(e)}")
        else:
            st.info("请输入问题后查看相关来源")

    st.markdown("---")
    st.subheader("📊 知识库状态")

    if data_processor is not None:
        try:
            vector_store = data_processor.get_vector_store()
            collection = vector_store._collection
            count = collection.count()
            st.metric("已索引片段数", count)
        except Exception as e:
            st.metric("已索引片段数", 0)
    else:
        st.metric("已索引片段数", 0)

st.markdown("---")
st.caption("🔒 所有数据处理均在本地完成，无需联网")
