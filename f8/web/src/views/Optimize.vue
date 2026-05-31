<template>
  <div class="optimize">
    <h2>TSDB Optimization</h2>

    <el-row :gutter="20">
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>Run Optimization</span>
          </template>

          <el-form label-width="120px">
            <el-form-item label="Dry Run">
              <el-switch v-model="dryRun" />
              <div style="color: #909399; font-size: 12px">
                Run optimization without actual changes
              </div>
            </el-form-item>

            <el-form-item>
              <el-button 
                type="primary" 
                @click="runOptimize" 
                :loading="loading"
                size="large"
              >
                <el-icon><MagicStick /></el-icon>
                Start Optimization
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card>
          <template #header>
            <span>Optimization Status</span>
          </template>
          
          <el-empty v-if="!result" description="No optimization run yet" />
          
          <div v-else>
            <el-result 
              :icon="result.success ? 'success' : 'error'"
              :title="result.success ? 'Optimization Completed' : 'Optimization Failed'"
              :sub-title="result.message"
            >
              <template #extra>
                <div class="optimization-stats">
                  <el-statistic 
                    title="Saved Space" 
                    :value="formatBytes(result.saved_space_bytes)"
                    value-style="color: #67C23A"
                  />
                </div>
              </template>
            </el-result>

            <el-divider content-position="left">Operations Performed</el-divider>
            
            <el-timeline>
              <el-timeline-item
                v-for="(opt, index) in result.optimizations"
                :key="index"
                :type="opt.type === 'merge_blocks' ? 'primary' : 'success'"
                timestamp=""
              >
                <el-tag>{{ opt.type }}</el-tag>
                {{ opt.description }}
              </el-timeline-item>
            </el-timeline>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" style="margin-top: 20px" v-if="result?.before_report && result?.after_report">
      <el-col :span="24">
        <el-card>
          <template #header>
            <span>Before / After Comparison</span>
          </template>

          <el-table :data="comparisonData" border>
            <el-table-column prop="metric" label="Metric" width="200" />
            <el-table-column prop="before" label="Before" />
            <el-table-column prop="after" label="After" />
            <el-table-column label="Change">
              <template #default="{ row }">
                <span :style="{ color: row.change > 0 ? '#F56C6C' : '#67C23A' }">
                  {{ row.change > 0 ? '+' : '' }}{{ row.changePercent }}%
                </span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { MagicStick } from '@element-plus/icons-vue'
import axios from 'axios'

const dryRun = ref(true)
const loading = ref(false)
const result = ref(null)

const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const comparisonData = computed(() => {
  if (!result.value?.before_report || !result.value?.after_report) return []
  
  const before = result.value.before_report
  const after = result.value.after_report

  const calcChange = (b, a) => ((a - b) / (b || 1) * 100).toFixed(2)

  return [
    {
      metric: 'Total Blocks',
      before: before.total_blocks,
      after: after.total_blocks,
      change: after.total_blocks - before.total_blocks,
      changePercent: calcChange(before.total_blocks, after.total_blocks)
    },
    {
      metric: 'Total Series',
      before: before.total_series,
      after: after.total_series,
      change: after.total_series - before.total_series,
      changePercent: calcChange(before.total_series, after.total_series)
    },
    {
      metric: 'Fragmentation Rate',
      before: (before.fragmentation.fragmentation_rate * 100).toFixed(2) + '%',
      after: (after.fragmentation.fragmentation_rate * 100).toFixed(2) + '%',
      change: (after.fragmentation.fragmentation_rate - before.fragmentation.fragmentation_rate) * 100,
      changePercent: calcChange(before.fragmentation.fragmentation_rate, after.fragmentation.fragmentation_rate)
    },
    {
      metric: 'Est. Query Delay',
      before: before.estimated_query_delay_ms.toFixed(2) + ' ms',
      after: after.estimated_query_delay_ms.toFixed(2) + ' ms',
      change: after.estimated_query_delay_ms - before.estimated_query_delay_ms,
      changePercent: calcChange(before.estimated_query_delay_ms, after.estimated_query_delay_ms)
    }
  ]
})

const runOptimize = async () => {
  loading.value = true
  try {
    const res = await axios.post('/api/v1/optimize', { dry_run: dryRun.value })
    result.value = res.data
  } catch (e) {
    console.error('Optimization failed:', e)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.optimize h2 {
  margin-top: 0;
  margin-bottom: 20px;
}

.optimization-stats {
  display: flex;
  justify-content: center;
  padding: 20px 0;
}
</style>
