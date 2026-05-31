<template>
  <div class="blocks">
    <h2>Block Details</h2>

    <el-card>
      <template #header>
        <div class="card-header">
          <span>Blocks List</span>
          <el-button type="primary" @click="loadBlocks" :loading="loading">
            <el-icon><Refresh /></el-icon> Refresh
          </el-button>
        </div>
      </template>

      <el-table :data="blocks" border v-loading="loading">
        <el-table-column prop="ulid" label="ULID" width="200" />
        <el-table-column prop="num_series" label="Series" width="100" sortable />
        <el-table-column prop="num_samples" label="Samples" width="120" sortable />
        <el-table-column prop="num_chunks" label="Chunks" width="100" sortable />
        <el-table-column prop="compaction_level" label="Level" width="80" sortable />
        <el-table-column prop="size_bytes" label="Size" width="100" sortable>
          <template #default="{ row }">
            {{ formatBytes(row.size_bytes) }}
          </template>
        </el-table-column>
        <el-table-column prop="fragmentation" label="Fragmentation" width="150">
          <template #default="{ row }">
            <el-progress 
              :percentage="(row.fragmentation * 100).toFixed(1)"
              :color="getFragColor(row.fragmentation)"
            />
          </template>
        </el-table-column>
        <el-table-column prop="min_time" label="Time Range" min-width="200">
          <template #default="{ row }">
            {{ formatTime(row.min_time) }} - {{ formatTime(row.max_time) }}
          </template>
        </el-table-column>
      </el-table>

      <div v-if="blocks.length === 0 && !loading" style="text-align: center; padding: 40px">
        <el-empty description="No blocks found" />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import axios from 'axios'

const blocks = ref([])
const loading = ref(false)

const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatTime = (timestamp) => {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString()
}

const getFragColor = (frag) => {
  if (frag < 0.3) return '#67C23A'
  if (frag < 0.7) return '#E6A23C'
  return '#F56C6C'
}

const loadBlocks = async () => {
  loading.value = true
  try {
    const res = await axios.get('/api/v1/blocks')
    blocks.value = res.data.blocks || []
  } catch (e) {
    console.error('Failed to load blocks:', e)
  } finally {
    loading.value = false
  }
}

loadBlocks()
</script>

<style scoped>
.blocks h2 {
  margin-top: 0;
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
