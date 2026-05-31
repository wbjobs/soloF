<script>
  import { marked } from 'marked';
  import { createEventDispatcher } from 'svelte';

  export let fileContent;
  export let currentPath;

  const dispatch = createEventDispatcher();
  let editMode = true;
  let localContent = fileContent;
  let saveTimeout;

  $: {
    localContent = fileContent;
  }

  $: renderedHtml = marked.parse(localContent || '');

  function autoSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      dispatch('save', localContent);
    }, 1000);
  }

  function handleInput(event) {
    localContent = event.target.value;
    autoSave();
  }

  function handleSave() {
    dispatch('save', localContent);
  }

  function toggleMode() {
    editMode = !editMode;
  }
</script>

<div class="editor-container">
  <div class="editor-header">
    <h4>{currentPath.split('/').pop()}</h4>
    <div class="editor-actions">
      <button class:active={editMode} on:click={toggleMode}>✏️ 编辑</button>
      <button class:active={!editMode} on:click={toggleMode}>👁️ 预览</button>
      <button class="save-btn" on:click={handleSave}>💾 保存</button>
    </div>
  </div>

  <div class="editor-content">
    {#if editMode}
      <textarea 
        bind:value={localContent}
        on:input={handleInput}
        placeholder="在这里输入 Markdown 内容..."
      />
    {:else}
      <div class="markdown-preview">
        {@html renderedHtml}
      </div>
    {/if}
  </div>
</div>

<style>
  .editor-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: white;
  }

  .editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid #bdc3c7;
    background: #f8f9fa;
  }

  .editor-header h4 {
    margin: 0;
    color: #2c3e50;
  }

  .editor-actions {
    display: flex;
    gap: 0.5rem;
  }

  .editor-actions button {
    padding: 0.4rem 0.8rem;
    border: 1px solid #bdc3c7;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .editor-actions button:hover {
    background: #ecf0f1;
  }

  .editor-actions button.active {
    background: #3498db;
    color: white;
    border-color: #3498db;
  }

  .save-btn {
    background: #27ae60 !important;
    color: white !important;
    border-color: #27ae60 !important;
  }

  .editor-content {
    flex: 1;
    overflow: hidden;
  }

  textarea {
    width: 100%;
    height: 100%;
    padding: 1.5rem;
    border: none;
    resize: none;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.95rem;
    line-height: 1.6;
    outline: none;
  }

  .markdown-preview {
    padding: 1.5rem;
    overflow-y: auto;
    height: 100%;
    line-height: 1.6;
  }

  .markdown-preview :global(h1) {
    font-size: 1.8rem;
    margin-bottom: 1rem;
    border-bottom: 2px solid #3498db;
    padding-bottom: 0.5rem;
  }

  .markdown-preview :global(h2) {
    font-size: 1.5rem;
    margin: 1.5rem 0 0.75rem;
  }

  .markdown-preview :global(h3) {
    font-size: 1.25rem;
    margin: 1.25rem 0 0.5rem;
  }

  .markdown-preview :global(p) {
    margin-bottom: 1rem;
  }

  .markdown-preview :global(code) {
    background: #f4f4f4;
    padding: 0.2rem 0.4rem;
    border-radius: 3px;
    font-family: monospace;
  }

  .markdown-preview :global(pre) {
    background: #2c3e50;
    color: #ecf0f1;
    padding: 1rem;
    border-radius: 6px;
    overflow-x: auto;
  }

  .markdown-preview :global(pre code) {
    background: none;
    padding: 0;
  }

  .markdown-preview :global(ul),
  .markdown-preview :global(ol) {
    margin: 1rem 0;
    padding-left: 2rem;
  }

  .markdown-preview :global(li) {
    margin: 0.5rem 0;
  }

  .markdown-preview :global(blockquote) {
    border-left: 4px solid #3498db;
    padding-left: 1rem;
    margin: 1rem 0;
    color: #7f8c8d;
  }

  .markdown-preview :global(a) {
    color: #3498db;
    text-decoration: none;
  }

  .markdown-preview :global(a:hover) {
    text-decoration: underline;
  }

  .markdown-preview :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
  }

  .markdown-preview :global(th),
  .markdown-preview :global(td) {
    border: 1px solid #bdc3c7;
    padding: 0.5rem;
    text-align: left;
  }

  .markdown-preview :global(th) {
    background: #ecf0f1;
  }
</style>
