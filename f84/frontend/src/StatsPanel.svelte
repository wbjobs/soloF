<script>
  export let stats = {
    total_files: 0,
    total_dependencies: 0,
    external_packages: 0
  }
</script>

<div class="stats">
  <div class="stat">
    <span class="stat-value">{stats.total_files}</span>
    <span class="stat-label">文件</span>
  </div>
  <div class="stat">
    <span class="stat-value">{stats.total_dependencies}</span>
    <span class="stat-label">依赖</span>
  </div>
  <div class="stat">
    <span class="stat-value">{stats.external_packages}</span>
    <span class="stat-label">外部包</span>
  </div>
</div>

<style>
  .stats {
    display: flex;
    gap: 20px;
    align-items: center;
  }

  .stat {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }

  .stat-value {
    font-size: 18px;
    font-weight: 700;
    color: #10b981;
  }

  .stat-label {
    font-size: 12px;
    color: #888;
  }
</style>
