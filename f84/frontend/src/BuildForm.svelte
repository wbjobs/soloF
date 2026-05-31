<script>
  import { createEventDispatcher } from 'svelte'

  export let repoPath = ''
  export let disabled = false

  const dispatch = createEventDispatcher()

  function submit() {
    if (repoPath.trim() && !disabled) {
      dispatch('build', repoPath.trim())
    }
  }
</script>

<form class="build-form" on:submit|preventDefault={submit}>
  <input
    type="text"
    bind:value={repoPath}
    placeholder="输入项目路径..."
    class="build-input"
    {disabled}
  />
  <button type="submit" class="btn build-btn" {disabled}>开始分析</button>
</form>

<style>
  .build-form {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }

  .build-input {
    background: #1a1a2e;
    border: 1px solid #0f3460;
    color: #eee;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
    width: 240px;
  }

  .build-input:focus {
    outline: none;
    border-color: #e94560;
  }

  .build-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .build-btn {
    padding: 8px 14px;
    font-size: 13px;
  }

  .build-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
