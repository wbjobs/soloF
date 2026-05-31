<template>
  <div class="execution-detail">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>执行详情 - {{ executionId }}</span>
          <el-button @click="$router.back()">返回</el-button>
        </div>
      </template>

      <el-descriptions :column="2" border v-if="execution">
        <el-descriptions-item label="执行ID">{{ execution.execution_id }}</el-descriptions-item>
        <el-descriptions-item label="工作流ID">{{ execution.workflow_id }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="getStatusType(execution.status)">{{ execution.status }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatDate(execution.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="开始时间">{{ formatDate(execution.start_time) }}</el-descriptions-item>
        <el-descriptions-item label="结束时间">{{ formatDate(execution.end_time) }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card v-if="executionState" style="margin-top: 20px;">
      <template #header>
        <div class="card-header">
          <span>执行调度状态</span>
          <el-button type="primary" size="small" @click="loadDetail">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
      </template>
      <el-row :gutter="20">
        <el-col :span="6">
          <div class="stat-item">
            <div class="stat-label">最大并行数</div>
            <div class="stat-value primary">{{ executionState.max_parallel_tasks || '无限制' }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-item">
            <div class="stat-label">运行中任务</div>
            <div class="stat-value running">{{ executionState.running_tasks?.length || 0 }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-item">
            <div class="stat-label">等待队列</div>
            <div class="stat-value waiting">{{ executionState.waiting_queue?.length || 0 }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-item">
            <div class="stat-label">已完成</div>
            <div class="stat-value success">{{ executionState.completed_tasks?.length || 0 }}</div>
          </div>
        </el-col>
      </el-row>
      <el-divider />
      <el-row :gutter="20" v-if="executionState.waiting_queue?.length > 0">
        <el-col :span="24">
          <div class="queue-section">
            <h5>等待队列</h5>
            <el-tag v-for="nodeId in executionState.waiting_queue" :key="nodeId" size="small" style="margin-right: 8px; margin-bottom: 8px;">
              {{ nodeId }}
            </el-tag>
          </div>
        </el-col>
      </el-row>
      <el-row :gutter="20" v-if="executionState.running_tasks?.length > 0">
        <el-col :span="24">
          <div class="queue-section">
            <h5>运行中任务</h5>
            <el-tag v-for="nodeId in executionState.running_tasks" :key="nodeId" type="primary" size="small" style="margin-right: 8px; margin-bottom: 8px;">
              {{ nodeId }}
            </el-tag>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <el-card style="margin-top: 20px;">
      <template #header>
        <span>任务执行列表</span>
      </template>
      
      <el-table :data="tasks" v-loading="loading" style="width: 100%">
        <el-table-column prop="node_id" label="节点ID" width="150" />
        <el-table-column prop="task_id" label="任务ID" width="200" />
        <el-table-column prop="task_name" label="任务名称" width="150" />
        <el-table-column prop="task_type" label="任务类型" width="120">
          <template #default="{ row }">
            <el-tag size="small">{{ getTaskTypeLabel(row.task_type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)" size="small">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="start_time" label="开始时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.start_time) }}
          </template>
        </el-table-column>
        <el-table-column prop="end_time" label="结束时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.end_time) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button type="primary" link @click="viewResult(row)" v-if="row.result">
              查看结果
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="resultDialogVisible"
      title="任务执行结果"
      width="700px"
    >
      <pre style="background: #f5f7fa; padding: 15px; border-radius: 6px; max-height: 400px; overflow: auto;">
{{ currentResult }}
      </pre>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { executionApi } from '@/api'
import { ElMessage } from 'element-plus'

const route = useRoute()
const executionId = ref(route.params.id)
const execution = ref(null)
const tasks = ref([])
const loading = ref(false)
const resultDialogVisible = ref(false)
const currentResult = ref('')
const executionState = ref(null)
const autoRefreshTimer = ref(null)

const loadDetail = async () => {
  loading.value = true
  try {
    const res = await executionApi.get(executionId.value)
    execution.value = res.data
    
    const tasksRes = await executionApi.getTasks(executionId.value)
    tasks.value = tasksRes.data
    
    await loadExecutionState()
  } catch (error) {
    console.error('加载执行详情失败:', error)
  } finally {
    loading.value = false
  }
}

const loadExecutionState = async () => {
  try {
    const res = await executionApi.getState(executionId.value)
    executionState.value = res.data
  } catch (error) {
    if (error.response?.status !== 404) {
      console.error('加载执行状态失败:', error)
    }
  }
}

const startAutoRefresh = () => {
  stopAutoRefresh()
  autoRefreshTimer.value = setInterval(async () => {
    if (execution.value && ['RUNNING', 'PENDING'].includes(execution.value.status)) {
      await loadDetail()
    } else {
      stopAutoRefresh()
    }
  }, 3000)
}

const stopAutoRefresh = () => {
  if (autoRefreshTimer.value) {
    clearInterval(autoRefreshTimer.value)
    autoRefreshTimer.value = null
  }
}

const viewResult = (row) => {
  currentResult.value = row.result
  resultDialogVisible.value = true
}

const getStatusType = (status) => {
  const typeMap = {
    'SUCCESS': 'success',
    'COMPLETED': 'success',
    'RUNNING': 'primary',
    'PENDING': 'warning',
    'STARTED': 'info',
    'FAILURE': 'danger',
    'FAILED': 'danger'
  }
  return typeMap[status] || 'info'
}

const getTaskTypeLabel = (type) => {
  const labelMap = {
    'shell': 'Shell命令',
    'python': 'Python脚本',
    'http': 'HTTP请求'
  }
  return labelMap[type] || type
}

const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

onMounted(() => {
  loadDetail().then(() => {
    startAutoRefresh()
  })
})

onUnmounted(() => {
  stopAutoRefresh()
})
</script>

<style scoped>
.execution-detail {
  padding: 0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-item {
  text-align: center;
  padding: 15px;
  background: #f5f7fa;
  border-radius: 8px;
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 28px;
  font-weight: bold;
}

.stat-value.primary {
  color: #409eff;
}

.stat-value.running {
  color: #e6a23c;
}

.stat-value.waiting {
  color: #909399;
}

.stat-value.success {
  color: #67c23a;
}

.queue-section h5 {
  margin: 0 0 10px 0;
  color: #606266;
  font-weight: normal;
}
</style>