<template>
  <div class="analyze">
    <h2>TSDB Analysis</h2>
    
    <el-card>
      <template #header>
        <div class="card-header">
          <span>Analysis Report</span>
          <el-button type="primary" @click="runAnalysis" :loading="loading">
            <el-icon><Refresh /></el-icon> Run Analysis
          </el-button>
        </div>
      </template>

      <el-empty v-if="!report" description="Click 'Run Analysis' to start" />
      
      <div v-else>
        <el-tabs v-model="activeTab">
          <el-tab-pane label="Overview" name="overview">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="Data Directory">{{ report.data_dir }}</el-descriptions-item>
              <el-descriptions-item label="Generated At">{{ report.generated_at }}</el-descriptions-item>
              <el-descriptions-item label="Total Blocks">{{ report.total_blocks }}</el-descriptions-item>
              <el-descriptions-item label="Total Series">{{ report.total_series }}</el-descriptions-item>
              <el-descriptions-item label="Total Samples">{{ report.total_samples }}</el-descriptions-item>
              <el-descriptions-item label="Est. Query Delay">{{ report.estimated_query_delay_ms.toFixed(2) }} ms</el-descriptions-item>
            </el-descriptions>
          </el-tab-pane>

          <el-tab-pane label="Fragmentation" name="fragmentation">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="Fragmentation Rate">
                <el-tag :type="getFragRateType(report.fragmentation.fragmentation_rate)">
                  {{ (report.fragmentation.fragmentation_rate * 100).toFixed(2) }}%
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="Small Blocks">{{ report.fragmentation.small_blocks_count }}</el-descriptions-item>
              <el-descriptions-item label="Orphaned Series">{{ report.fragmentation.orphaned_series_count }}</el-descriptions-item>
            </el-descriptions>
          </el-tab-pane>

          <el-tab-pane label="Hotspots" name="hotspots">
            <el-table :data="report.hotspots" border>
              <el-table-column prop="label_matcher" label="Label Matcher" />
              <el-table-column prop="series_count" label="Series Count" />
              <el-table-column prop="frequency_score" label="Frequency Score">
                <template #default="{ row }">
                  <el-progress :percentage="row.frequency_score * 100" />
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="Labels" name="labels">
            <el-descriptions :column="1" border>
              <el-descriptions-item label="Unique Label Names">{{ report.label_stats.unique_label_names }}</el-descriptions-item>
              <el-descriptions-item label="Total Label Pairs">{{ report.label_stats.total_label_pairs }}</el-descriptions-item>
            </el-descriptions>
          </el-tab-pane>

          <el-tab-pane label="Recommendations" name="recommendations">
            <el-alert
              v-for="(rec, index) in report.recommendations"
              :key="index"
              :title="rec"
              type="info"
              :closable="false"
              style="margin-bottom: 10px"
            />
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import axios from 'axios'

const report = ref(null)
const loading = ref(false)
const activeTab = ref('overview')

const getFragRateType = (rate) => {
  if (rate < 0.3) return 'success'
  if (rate < 0.7) return 'warning'
  return 'danger'
}

const runAnalysis = async () => {
  loading.value = true
  try {
    const res = await axios.get('/api/v1/analyze')
    report.value = res.data
  } catch (e) {
    console.error('Analysis failed:', e)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.analyze h2 {
  margin-top: 0;
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
