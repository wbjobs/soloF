<template>
  <div class="cache-manager">
    <h2>智能预读缓存管理</h2>

    <el-row :gutter="20" class="stats-row">
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon blue">
              <el-icon><TrendCharts /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ (stats.hit_rate * 100).toFixed(1) }}%</div>
              <div class="stat-label">缓存命中率</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon green">
              <el-icon><Timer /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ latencyImprovement.toFixed(1) }}%</div>
              <div class="stat-label">P99延迟降低</div>
              <el-tag v-if="latencyImprovement >= 30" type="success" size="small">目标达成 ✓</el-tag>
              <el-tag v-else type="warning" size="small">目标: >30%</el-tag>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon purple">
              <el-icon><DataLine /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.preloaded_blocks }}</div>
              <div class="stat-label">预加载块数</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon orange">
              <el-icon><FolderOpened /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ (stats.memory_used_bytes / 1024 / 1024).toFixed(1) }} MB</div>
              <div class="stat-label">内存使用</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" style="margin-bottom: 20px">
      <el-col :span="12">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>缓存控制</span>
              <div class="header-actions">
                <el-button 
                  :type="stats.cache_enabled ? 'danger' : 'success'"
                  @click="toggleCache"
                  :loading="loading"
                >
                  {{ stats.cache_enabled ? '禁用缓存' : '启用缓存' }}
                </el-button>
                <el-button @click="flushCache" :loading="loading">
                  <el-icon><Delete /></el-icon> 清空缓存
                </el-button>
                <el-button type="primary" @click="loadStats" :loading="loading">
                  <el-icon><Refresh /></el-icon> 刷新
                </el-button>
              </div>
            </div>
          </template>

          <el-descriptions :column="2" border>
            <el-descriptions-item label="总查询数">
              {{ stats.total_queries }}
            </el-descriptions-item>
            <el-descriptions-item label="缓存命中">
              {{ stats.hits }}
            </el-descriptions-item>
            <el-descriptions-item label="缓存未命中">
              {{ stats.misses }}
            </el-descriptions-item>
            <el-descriptions-item label="淘汰次数">
              {{ stats.evictions }}
            </el-descriptions-item>
            <el-descriptions-item label="平均加载时间">
              {{ stats.avg_load_time_ms.toFixed(2) }} ms
            </el-descriptions-item>
            <el-descriptions-item label="缓存状态">
              <el-tag :type="stats.cache_enabled ? 'success' : 'danger'">
                {{ stats.cache_enabled ? '已启用' : '已禁用' }}
              </el-tag>
            </el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card>
          <template #header>
            <span>已缓存的Block ({{ cachedBlocks.length }})</span>
          </template>
          <el-table :data="cachedBlocks" border size="small" height="200">
            <el-table-column prop="" label="Block ID" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20">
      <el-col :span="24">
        <el-card>
          <template #header>
            <span>热门查询模式检测 (Top {{ patterns.length }})</span>
          </template>
          <el-table :data="patterns" border>
            <el-table-column prop="label_matcher" label="标签匹配器" min-width="300" />
            <el-table-column prop="query_count" label="查询次数" width="120" sortable />
            <el-table-column prop="avg_range_hours" label="平均查询范围(小时)" width="160" sortable>
              <template #default="{ row }">
                {{ row.avg_range_hours.toFixed(1) }}
              </template>
            </el-table-column>
            <el-table-column prop="hot_score" label="热度分数" width="150" sortable>
              <template #default="{ row }">
                <el-progress 
                  :percentage="row.hot_score * 100"
                  :color="getHotScoreColor(row.hot_score)"
                />
              </template>
            </el-table-column>
            <el-table-column label="最后访问" width="180">
              <template #default="{ row }">
                {{ row.last_accessed }}
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { TrendCharts, Timer, DataLine, FolderOpened, Refresh, Delete } from '@element-plus/icons-vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'

const stats = ref({
  hits: 0,
  misses: 0,
  evictions: 0,
  preloaded_blocks: 0,
  memory_used_bytes: 0,
  hit_rate: 0,
  avg_load_time_ms: 0,
  total_queries: 0,
  cache_enabled: false
})

const latencyImprovement = ref(0)
const cachedBlocks = ref([])
const patterns = ref([])
const loading = ref(false)

const loadStats = async () => {
  loading.value = true
  try {
    const res = await axios.get('/api/v1/cache/stats')
    stats.value = res.data.stats
    latencyImprovement.value = res.data.latency_improvement_pct
  } catch (e) {
    console.error('Failed to load stats:', e)
  } finally {
    loading.value = false
  }
}

const loadPatterns = async () => {
  try {
    const res = await axios.get('/api/v1/cache/patterns')
    patterns.value = res.data.patterns
  } catch (e) {
    console.error('Failed to load patterns:', e)
  }
}

const loadCachedBlocks = async () => {
  try {
    const res = await axios.get('/api/v1/cache/blocks')
    cachedBlocks.value = res.data.cached_blocks
  } catch (e) {
    console.error('Failed to load blocks:', e)
  }
}

const toggleCache = async () => {
  loading.value = true
  try {
    if (stats.value.cache_enabled) {
      await axios.post('/api/v1/cache/disable')
      ElMessage.success('缓存已禁用')
    } else {
      await axios.post('/api/v1/cache/enable')
      ElMessage.success('缓存已启用')
    }
    await loadStats()
  } catch (e) {
    ElMessage.error('操作失败')
  } finally {
    loading.value = false
  }
}

const flushCache = async () => {
  loading.value = true
  try {
    await axios.post('/api/v1/cache/flush')
    ElMessage.success('缓存已清空')
    await Promise.all([loadStats(), loadCachedBlocks()])
  } catch (e) {
    ElMessage.error('清空失败')
  } finally {
    loading.value = false
  }
}

const getHotScoreColor = (score) => {
  if (score >= 0.7) return '#67c23a'
  if (score >= 0.4) return '#e6a23c'
  return '#909399'
}

onMounted(() => {
  loadStats()
  loadPatterns()
  loadCachedBlocks()
})
</script>

<style scoped>
.cache-manager h2 {
  margin-bottom: 20px;
}

.stats-row {
  margin-bottom: 20px;
}

.stat-card {
  border-radius: 8px;
}

.stat-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-icon {
  width: 60px;
  height: 60px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: white;
}

.stat-icon.blue { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
.stat-icon.green { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
.stat-icon.purple { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); }
.stat-icon.orange { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }

.stat-value {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-bottom: 5px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-actions {
  display: flex;
  gap: 10px;
}
</style>
