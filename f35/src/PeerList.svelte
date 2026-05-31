<script>
  import { invoke } from '@tauri-apps/api/tauri';

  let discoveryMode = 'UDP';
  let peers = [];
  let refreshInterval;
  let relayStatus = {
    server_running: false,
    server_port: null,
    client_connected: false,
    client_server: null,
  };
  let discoveredServers = [];
  let customServerAddr = '';
  let isScanning = false;

  async function refreshPeers() {
    try {
      if (discoveryMode === 'UDP') {
        peers = await invoke('get_discovered_peers');
      } else {
        peers = await invoke('get_relay_peers');
      }
    } catch (error) {
      console.error('Failed to get peers:', error);
    }
  }

  async function refreshRelayStatus() {
    try {
      relayStatus = await invoke('get_relay_status');
    } catch (error) {
      console.error('Failed to get relay status:', error);
    }
  }

  async function scanServers() {
    isScanning = true;
    try {
      discoveredServers = await invoke('discover_relay_servers');
    } catch (error) {
      console.error('Failed to discover servers:', error);
    }
    isScanning = false;
  }

  async function startRelayServer() {
    try {
      const port = await invoke('start_relay_server', {});
      alert(`中继服务器已启动，端口: ${port}`);
      await refreshRelayStatus();
    } catch (error) {
      alert(`启动服务器失败: ${error}`);
    }
  }

  async function stopRelayServer() {
    try {
      await invoke('stop_relay_server');
      alert('中继服务器已停止');
      await refreshRelayStatus();
    } catch (error) {
      alert(`停止服务器失败: ${error}`);
    }
  }

  async function connectToServer(serverAddr) {
    try {
      await invoke('connect_to_relay', { serverAddr });
      alert(`已连接到 ${serverAddr}`);
      await refreshRelayStatus();
    } catch (error) {
      alert(`连接失败: ${error}`);
    }
  }

  async function disconnectFromServer() {
    try {
      await invoke('disconnect_from_relay');
      alert('已断开连接');
      await refreshRelayStatus();
    } catch (error) {
      alert(`断开连接失败: ${error}`);
    }
  }

  async function setMode(mode) {
    discoveryMode = mode;
    try {
      await invoke('set_discovery_mode', { mode });
      await refreshPeers();
    } catch (error) {
      console.error('Failed to set mode:', error);
    }
  }

  function startRefresh() {
    refreshPeers();
    refreshRelayStatus();
    refreshInterval = setInterval(() => {
      refreshPeers();
      refreshRelayStatus();
    }, 3000);
  }

  function stopRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  }

  startRefresh();
</script>

<div class="peer-list">
  <h3>🌐 P2P 节点发现</h3>

  <div class="mode-selector">
    <button 
      class:active={discoveryMode === 'UDP'} 
      on:click={() => setMode('UDP')}
    >
      📡 UDP 广播
    </button>
    <button 
      class:active={discoveryMode === 'TCPRelay'} 
      on:click={() => setMode('TCPRelay')}
    >
      🔗 TCP 中继
    </button>
  </div>

  {#if discoveryMode === 'TCPRelay'}
    <div class="relay-controls">
      <div class="relay-section">
        <h4>中继服务器</h4>
        {#if !relayStatus.server_running}
          <button class="btn-small btn-success" on:click={startRelayServer}>
            🚀 启动服务器
          </button>
        {:else}
          <div class="status-info">
            <span class="status-running">运行中，端口: {relayStatus.server_port}</span>
          </div>
          <button class="btn-small btn-danger" on:click={stopRelayServer}>
            ⏹ 停止服务器
          </button>
        {/if}
      </div>

      <div class="relay-section">
        <h4>中继客户端</h4>
        {#if !relayStatus.client_connected}
          <div class="connect-form">
            <input 
              type="text" 
              bind:value={customServerAddr} 
              placeholder="例如: 192.168.1.100:45679"
            />
            <button class="btn-small btn-primary" on:click={() => connectToServer(customServerAddr)}>
              连接
            </button>
          </div>
          <button class="btn-small btn-secondary" on:click={scanServers} disabled={isScanning}>
            {isScanning ? '扫描中...' : '🔍 扫描局域网服务器'}
          </button>
          {#if discoveredServers.length > 0}
            <div class="server-list">
              {#each discoveredServers as server}
                <button class="server-item" on:click={() => connectToServer(server)}>
                  {server}
                </button>
              {/each}
            </div>
          {/if}
        {:else}
          <div class="status-info">
            <span class="status-connected">已连接: {relayStatus.client_server}</span>
          </div>
          <button class="btn-small btn-danger" on:click={disconnectFromServer}>
            断开连接
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <div class="peers-section">
    <h4>发现的节点 ({peers.length})</h4>
    {#if peers.length > 0}
      <div class="peers">
        {#each peers as peer}
          <div class="peer-item">
            <span class="peer-name">💻 {peer.name}</span>
            <span class="peer-address">{peer.address.split(':')[0]}</span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="no-peers">暂无发现的节点</p>
    {/if}
    {#if discoveryMode === 'UDP'}
      <p class="peer-hint">点击"启动P2P"开始UDP广播发现</p>
    {:else}
      <p class="peer-hint">启动或连接到中继服务器后可发现节点</p>
    {/if}
  </div>
</div>

<style>
  .peer-list {
    padding: 0.5rem 0;
  }

  .peer-list h3 {
    margin-bottom: 0.75rem;
    color: #2c3e50;
    font-size: 1rem;
  }

  .peer-list h4 {
    margin: 0.75rem 0 0.5rem;
    color: #34495e;
    font-size: 0.9rem;
  }

  .mode-selector {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .mode-selector button {
    flex: 1;
    padding: 0.5rem;
    border: 2px solid #bdc3c7;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.2s;
  }

  .mode-selector button.active {
    background: #3498db;
    color: white;
    border-color: #3498db;
  }

  .relay-controls {
    background: #f8f9fa;
    border-radius: 6px;
    padding: 0.75rem;
    margin-bottom: 1rem;
  }

  .relay-section {
    margin-bottom: 1rem;
  }

  .relay-section:last-child {
    margin-bottom: 0;
  }

  .connect-form {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .connect-form input {
    flex: 1;
    padding: 0.4rem;
    border: 1px solid #bdc3c7;
    border-radius: 4px;
    font-size: 0.85rem;
  }

  .server-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }

  .server-item {
    padding: 0.4rem 0.6rem;
    background: white;
    border: 1px solid #bdc3c7;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    font-size: 0.85rem;
  }

  .server-item:hover {
    background: #ecf0f1;
  }

  .status-info {
    margin-bottom: 0.5rem;
  }

  .status-running {
    color: #27ae60;
    font-weight: 500;
    font-size: 0.85rem;
  }

  .status-connected {
    color: #2980b9;
    font-weight: 500;
    font-size: 0.85rem;
  }

  .peers {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .peer-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
    background: white;
    border-radius: 4px;
    border-left: 3px solid #27ae60;
  }

  .peer-name {
    font-size: 0.9rem;
    font-weight: 500;
    color: #2c3e50;
  }

  .peer-address {
    font-size: 0.75rem;
    color: #7f8c8d;
  }

  .no-peers {
    text-align: center;
    color: #95a5a6;
    font-size: 0.85rem;
    padding: 1rem 0;
  }

  .peer-hint {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: #7f8c8d;
    text-align: center;
  }

  .btn-small {
    padding: 0.4rem 0.8rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    transition: opacity 0.2s;
  }

  .btn-small:hover {
    opacity: 0.9;
  }

  .btn-small:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #3498db;
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

  .btn-secondary {
    background: #95a5a6;
    color: white;
  }
</style>
