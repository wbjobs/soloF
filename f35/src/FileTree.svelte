<script>
  import { invoke } from '@tauri-apps/api/tauri';
  import { createEventDispatcher } from 'svelte';

  export let path;
  const dispatch = createEventDispatcher();

  let files = [];
  let expandedDirs = new Set();

  async function loadFiles(dirPath) {
    try {
      const result = await invoke('get_file_tree', { path: dirPath });
      return result;
    } catch (error) {
      console.error('Failed to load files:', error);
      return [];
    }
  }

  async function refresh() {
    files = await loadFiles(path);
  }

  async function toggleDir(file) {
    if (expandedDirs.has(file.path)) {
      expandedDirs.delete(file.path);
    } else {
      expandedDirs.add(file.path);
    }
    expandedDirs = new Set(expandedDirs);
  }

  function selectFile(file) {
    if (file.is_file) {
      dispatch('select', file);
    }
  }

  function deleteFile(file) {
    dispatch('delete', { path: file.path, isDir: file.is_dir });
  }

  $: if (path) {
    refresh();
  }
</script>

<div class="file-tree">
  {#each files as file}
    <div class="file-item">
      <div class="file-row" class:selected={file.is_file} on:click={() => file.is_dir ? toggleDir(file) : selectFile(file)}>
        <span class="file-icon">
          {#if file.is_dir}
            {expandedDirs.has(file.path) ? '📂' : '📁'}
          {:else}
            {file.name.endsWith('.md') ? '📝' : '📄'}
          {/if}
        </span>
        <span class="file-name">{file.name}</span>
        <button class="delete-btn" on:click|stopPropagation={() => deleteFile(file)} title="删除">
          🗑
        </button>
      </div>
      {#if file.is_dir && expandedDirs.has(file.path)}
        <div class="subtree">
          <svelte:self path={file.path} on:select on:delete />
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .file-tree {
    user-select: none;
  }

  .file-item {
    margin: 2px 0;
  }

  .file-row {
    display: flex;
    align-items: center;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    gap: 6px;
  }

  .file-row:hover {
    background: #d5dbdb;
  }

  .file-row.selected {
    background: #3498db;
    color: white;
  }

  .file-icon {
    font-size: 1rem;
  }

  .file-name {
    flex: 1;
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .delete-btn {
    opacity: 0;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.8rem;
    padding: 2px 4px;
    border-radius: 2px;
  }

  .file-row:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    background: rgba(231, 76, 60, 0.2);
  }

  .subtree {
    margin-left: 20px;
    border-left: 1px solid #bdc3c7;
    padding-left: 8px;
  }
</style>
