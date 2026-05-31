<script>
  import { invoke } from '@tauri-apps/api/tauri';
  import { listen } from '@tauri-apps/api/event';
  import { dialog } from '@tauri-apps/api';
  import FileTree from './FileTree.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import PeerList from './PeerList.svelte';
  import ConflictResolver from './ConflictResolver.svelte';

  let notesDirectory = null;
  let currentPath = null;
  let fileContent = '';
  let currentFileHashes = null;
  let selectedFiles = [];
  let pendingConflicts = [];
  let showConflictDialog = false;
  let currentConflict = null;

  async function selectDirectory() {
    const path = await dialog.open({ directory: true, multiple: false });
    if (path) {
      notesDirectory = await invoke('set_notes_directory', { path });
      await loadFileHashes();
    }
  }

  async function loadFileHashes() {
    currentFileHashes = await invoke('get_file_hashes');
  }

  async function handleFileSelect(file) {
    if (file.is_file) {
      currentPath = file.path;
      fileContent = await invoke('read_file_content', { path: file.path });
    }
  }

  async function handleFileChange(event) {
    console.log('File changed:', event.payload);
    if (notesDirectory) {
      await loadFileHashes();
    }
  }

  async function handleSave(content) {
    if (currentPath) {
      await invoke('save_file_content', { path: currentPath, content });
      await loadFileHashes();
    }
  }

  async function handleCreateFile(name, isDir) {
    if (notesDirectory) {
      const path = `${notesDirectory}/${name}`;
      await invoke('create_new_file', { path, isDir });
    }
  }

  async function handleDeleteFile(path, isDir) {
    const confirmed = await dialog.confirm(`确定要删除 ${path} 吗？`);
    if (confirmed) {
      await invoke('delete_file', { path, isDir });
      if (currentPath === path) {
        currentPath = null;
        fileContent = '';
      }
    }
  }

  async function startP2P() {
    await invoke('start_p2p_discovery');
  }

  async function stopP2P() {
    await invoke('stop_p2p_discovery');
  }

  function detectConflict(fileName) {
    if (Math.random() > 0.5) {
      return null;
    }

    const baseContent = '# 笔记标题\n\n这是一段基础内容。\n\n- 列表项 1\n- 列表项 2\n\n';
    const localContent = baseContent + '## 本地新增\n\n这是我在本地添加的内容。\n\n- 本地修改项 A\n- 本地修改项 B\n\n';
    const remoteContent = baseContent + '## 远程新增\n\n这是其他人在远程添加的内容。\n\n- 远程修改项 X\n- 远程修改项 Y\n\n';

    return {
      id: Date.now().toString(),
      fileName,
      filePath: `${notesDirectory}/${fileName}`,
      localContent,
      remoteContent,
      localModified: Math.floor(Date.now() / 1000) - 300,
      remoteModified: Math.floor(Date.now() / 1000) - 180,
    };
  }

  async function simulateConflict() {
    if (!currentPath || !notesDirectory) {
      await dialog.alert('请先打开一个文件');
      return;
    }

    const fileName = currentPath.split('/').pop();
    const conflict = detectConflict(fileName);
    
    if (conflict) {
      pendingConflicts.push(conflict);
      currentConflict = conflict;
      showConflictDialog = true;
    } else {
      await dialog.alert('本次模拟未检测到冲突，再试一次！');
    }
  }

  async function handleResolveConflict(event) {
    const { conflict, version, content } = event.detail;
    
    await invoke('save_file_content', { path: conflict.filePath, content });
    await loadFileHashes();
    
    pendingConflicts = pendingConflicts.filter(c => c.id !== conflict.id);
    
    if (conflict.filePath === currentPath) {
      fileContent = content;
    }

    showConflictDialog = false;
    currentConflict = null;
    
    await dialog.notify(`冲突已解决，已保留${version === 'local' ? '本地' : '远程'}版本`);
  }

  function handleCancelConflict() {
    showConflictDialog = false;
    currentConflict = null;
  }

  function openNextConflict() {
    if (pendingConflicts.length > 0) {
      currentConflict = pendingConflicts[0];
      showConflictDialog = true;
    }
  }

  async function init() {
    notesDirectory = await invoke('get_notes_directory');
    
    await listen('file_change', handleFileChange);
  }

  init();
</script>

<div class="app">
  <header class="header">
    <h1>📝 Note Sync App</h1>
    <div class="header-actions">
      {#if !notesDirectory}
        <button on:click={selectDirectory} class="btn btn-primary">
          📁 选择笔记目录
        </button>
      {:else}
        <button on:click={selectDirectory} class="btn btn-secondary">
          📁 切换目录: {notesDirectory.split('/').pop()}
        </button>
      {/if}
      <button on:click={startP2P} class="btn btn-success">🔌 启动P2P</button>
      <button on:click={stopP2P} class="btn btn-danger">⏹ 停止P2P</button>
      <button on:click={simulateConflict} class="btn btn-warning">
        🔀 模拟冲突
        {#if pendingConflicts.length > 0}
          <span class="conflict-badge">{pendingConflicts.length}</span>
        {/if}
      </button>
    </div>
  </header>

  <main class="main">
    <aside class="sidebar">
      <div class="sidebar-section">
        <h3>📂 文件</h3>
        {#if notesDirectory}
          <div class="file-actions">
            <button on:click={() => handleCreateFile(prompt('文件名:') || 'new_note.md', false)} 
                    class="btn btn-small">
              + 文件
            </button>
            <button on:click={() => handleCreateFile(prompt('文件夹名:') || 'new_folder', true)} 
                    class="btn btn-small">
              + 文件夹
            </button>
          </div>
          <FileTree 
            path={notesDirectory} 
            on:select={(e) => handleFileSelect(e.detail)}
            on:delete={(e) => handleDeleteFile(e.detail.path, e.detail.isDir)}
          />
        {:else}
          <p class="empty-state">请先选择笔记目录</p>
        {/if}
      </div>

      <div class="sidebar-section">
        <PeerList />
      </div>
    </aside>

    <section class="content">
      {#if currentPath}
        <MarkdownEditor 
          {fileContent} 
          {currentPath}
          on:save={(e) => handleSave(e.detail)}
        />
      {:else}
        <div class="empty-state">
          <p>选择或创建一个笔记文件开始编辑</p>
        </div>
      {/if}
    </section>
  </main>

  {#if currentFileHashes}
    <footer class="footer">
      <small>文件数: {Object.keys(currentFileHashes.files || {}).length} | 
      最后更新: {new Date(currentFileHashes.last_updated * 1000).toLocaleString()}</small>
    </footer>
  {/if}

  {#if showConflictDialog && currentConflict}
    <ConflictResolver 
      conflict={currentConflict}
      on:resolve={handleResolveConflict}
      on:cancel={handleCancelConflict}
    />
  {/if}
</div>

<style>
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f5f5f5;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 2rem;
    background: #2c3e50;
    color: white;
  }

  .header h1 {
    font-size: 1.5rem;
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
  }

  .main {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .sidebar {
    width: 300px;
    background: #ecf0f1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-right: 1px solid #bdc3c7;
  }

  .sidebar-section {
    padding: 1rem;
    border-bottom: 1px solid #bdc3c7;
  }

  .sidebar-section h3 {
    margin-bottom: 0.75rem;
    color: #2c3e50;
  }

  .file-actions {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .footer {
    padding: 0.5rem 2rem;
    background: #2c3e50;
    color: white;
    text-align: right;
  }

  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: opacity 0.2s;
  }

  .btn:hover {
    opacity: 0.9;
  }

  .btn-primary {
    background: #3498db;
    color: white;
  }

  .btn-secondary {
    background: #95a5a6;
    color: white;
  }

  .btn-success {
    background: #27ae60;
    color: white;
  }

  .btn-danger {
    background: #e74c3c;
    color: white;
  }

  .btn-warning {
    background: #f39c12;
    color: white;
    position: relative;
  }

  .btn-small {
    padding: 0.25rem 0.5rem;
    font-size: 0.8rem;
    background: #3498db;
    color: white;
  }

  .conflict-badge {
    position: absolute;
    top: -8px;
    right: -8px;
    background: #e74c3c;
    color: white;
    font-size: 0.7rem;
    padding: 2px 6px;
    border-radius: 10px;
    font-weight: bold;
    min-width: 18px;
    text-align: center;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #7f8c8d;
    font-size: 1.1rem;
  }
</style>
