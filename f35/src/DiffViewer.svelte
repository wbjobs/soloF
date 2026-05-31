<script>
  export let localContent;
  export let remoteContent;
  export let fileName;

  function computeDiff(local, remote) {
    const localLines = local.split('\n');
    const remoteLines = remote.split('\n');
    const diff = [];
    
    let i = 0, j = 0;
    
    while (i < localLines.length || j < remoteLines.length) {
      if (i < localLines.length && j < remoteLines.length && localLines[i] === remoteLines[j]) {
        diff.push({ type: 'same', content: localLines[i], lineNum: i + 1 });
        i++;
        j++;
      } else {
        let foundMatch = false;
        
        for (let k = i + 1; k < Math.min(i + 5, localLines.length); k++) {
          if (k < localLines.length && j < remoteLines.length && localLines[k] === remoteLines[j]) {
            for (let m = i; m < k; m++) {
              diff.push({ type: 'delete', content: localLines[m], lineNum: m + 1 });
            }
            i = k;
            foundMatch = true;
            break;
          }
        }
        
        if (!foundMatch) {
          for (let k = j + 1; k < Math.min(j + 5, remoteLines.length); k++) {
            if (k < remoteLines.length && i < localLines.length && remoteLines[k] === localLines[i]) {
              for (let m = j; m < k; m++) {
                diff.push({ type: 'insert', content: remoteLines[m], lineNum: m + 1 });
              }
              j = k;
              foundMatch = true;
              break;
            }
          }
        }
        
        if (!foundMatch) {
          if (i < localLines.length) {
            diff.push({ type: 'delete', content: localLines[i], lineNum: i + 1 });
            i++;
          }
          if (j < remoteLines.length) {
            diff.push({ type: 'insert', content: remoteLines[j], lineNum: j + 1 });
            j++;
          }
        }
      }
    }
    
    return diff;
  }

  $: diffLines = computeDiff(localContent || '', remoteContent || '');

  function getLineClass(type) {
    switch (type) {
      case 'same': return 'line-same';
      case 'delete': return 'line-delete';
      case 'insert': return 'line-insert';
      default: return '';
    }
  }

  function getLineSymbol(type) {
    switch (type) {
      case 'same': return ' ';
      case 'delete': return '-';
      case 'insert': return '+';
      default: return '';
    }
  }
</script>

<div class="diff-viewer">
  <div class="diff-header">
    <h4>📄 文件差异对比: {fileName}</h4>
    <div class="diff-legend">
      <span class="legend-delete">本地内容 (删除)</span>
      <span class="legend-same">相同内容</span>
      <span class="legend-insert">远程内容 (新增)</span>
    </div>
  </div>
  
  <div class="diff-stats">
    <span class="stat-delete">删除: {diffLines.filter(l => l.type === 'delete').length} 行</span>
    <span class="stat-insert">新增: {diffLines.filter(l => l.type === 'insert').length} 行</span>
    <span class="stat-same">相同: {diffLines.filter(l => l.type === 'same').length} 行</span>
  </div>

  <div class="diff-content">
    {#each diffLines as line}
      <div class="diff-line {getLineClass(line.type)}">
        <span class="line-symbol">{getLineSymbol(line.type)}</span>
        <span class="line-number">{line.lineNum}</span>
        <span class="line-content">{line.content}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .diff-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #282c34;
    color: #abb2bf;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 14px;
    border-radius: 8px;
    overflow: hidden;
  }

  .diff-header {
    padding: 12px 16px;
    background: #21252b;
    border-bottom: 1px solid #181a1f;
  }

  .diff-header h4 {
    margin: 0 0 8px 0;
    color: #e6e6e6;
    font-size: 16px;
  }

  .diff-legend {
    display: flex;
    gap: 16px;
    font-size: 12px;
  }

  .diff-legend span {
    padding: 2px 8px;
    border-radius: 3px;
  }

  .legend-delete {
    background: rgba(255, 92, 87, 0.3);
    color: #ff5c57;
  }

  .legend-same {
    background: rgba(171, 178, 191, 0.2);
    color: #abb2bf;
  }

  .legend-insert {
    background: rgba(92, 255, 87, 0.3);
    color: #5cff57;
  }

  .diff-stats {
    padding: 8px 16px;
    background: #21252b;
    border-bottom: 1px solid #181a1f;
    display: flex;
    gap: 16px;
    font-size: 12px;
  }

  .stat-delete {
    color: #ff5c57;
  }

  .stat-insert {
    color: #5cff57;
  }

  .stat-same {
    color: #abb2bf;
  }

  .diff-content {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .diff-line {
    display: flex;
    align-items: center;
    padding: 2px 16px;
    min-height: 24px;
  }

  .diff-line:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .line-same {
    background: transparent;
  }

  .line-delete {
    background: rgba(255, 92, 87, 0.15);
  }

  .line-insert {
    background: rgba(92, 255, 87, 0.15);
  }

  .line-symbol {
    width: 16px;
    text-align: center;
    font-weight: bold;
    flex-shrink: 0;
  }

  .line-delete .line-symbol {
    color: #ff5c57;
  }

  .line-insert .line-symbol {
    color: #5cff57;
  }

  .line-number {
    width: 40px;
    text-align: right;
    color: #636d83;
    margin-right: 12px;
    flex-shrink: 0;
    user-select: none;
  }

  .line-content {
    flex: 1;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
