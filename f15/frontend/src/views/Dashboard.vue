<template>
  <div class="dashboard">
    <el-row :gutter="20">
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon workflow">
              <el-icon><Document /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.workflows }}</div>
              <div class="stat-label">工作流总数</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon running">
              <el-icon><VideoPlay /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.running }}</div>
              <div class="stat-label">执行中</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon success">
              <el-icon><CircleCheck /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.completed }}</div>
              <div class="stat-label">已完成</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon failed">
              <el-icon><CircleClose /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.failed }}</div>
              <div class="stat-label">失败</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" style="margin-top: 20px;">
      <el-col :span="12">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>最近执行</span>
              <el-button type="primary" link @click="$router.push('/executions')">查看全部</el-button>
            </div>
          </template>
          <el-table :data="recentExecutions" style="width: 100%">
            <el-table-column prop="execution_id" label="执行ID" width="200" />
            <el-table-column prop="status" label="状态">
              <template #default="{ row }">
                <el-tag :type="getStatusType(row.status)">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="创建时间">
              <template #default="{ row }">
                {{ formatDate(row.created_at) }}
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>快捷操作</span>
            </div>
          </template>
          <div class="quick-actions">
            <el-button type="primary" size="large" @click="$router.push('/editor')">
              <el-icon><Plus /></el-icon>
              创建工作流
            </el-button>
            <el-button type="success" size="large" @click="$router.push('/workflows')">
              <el-icon><List /></el-icon>
              管理工作流
            </el-button>
            <el-button type="warning" size="large" @click="checkHealth">
              <el-icon><Connection /></el-icon>
              健康检查
            </el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { executionApi, workflowApi, healthApi } from '@/api'
import { ElMessage } from 'element-plus'

const router = useRouter()
const stats = ref({
  workflows: 0,
  running: 0,
  completed: 0,
  failed: 0
})
const recentExecutions = ref([])

const loadStats = async () => {
  try {
    const [workflowRes, executionRes] = await Promise.all([
      workflowApi.list(),
      executionApi.list()
    ])
    
    stats.value.workflows = workflowRes.data.length
    stats.value.running = executionRes.data.filter(e => ['RUNNING', 'PENDING', 'STARTED'].includes(e.status)).length
    stats.value.completed = executionRes.data.filter(e => e.status === 'COMPLETED').length
    stats.value.failed = executionRes.data.filter(e => e.status === 'FAILURE').length
    
    recentExecutions.value = executionRes.data.slice(0, 5)
  } catch (error) {
    console.error('加载统计数据失败:', error)
  }
}

const checkHealth = async () => {
  try {
    await healthApi.check()
    ElMessage.success('服务状态正常')
  } catch (error) {
    ElMessage.error('服务异常: ' + error.message)
  }
}

const getStatusType = (status) => {
  const typeMap = {
    'COMPLETED': 'success',
    'RUNNING': 'primary',
    'PENDING': 'warning',
    'STARTED': 'info',
    'FAILURE': 'danger'
  }
  return typeMap[status] || 'info'
}

const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

onMounted(() => {
  loadStats()
})
</script>

<style scoped>
.dashboard {
  padding: 0;
}

.stat-card {
  border: none;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
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

.stat-icon.workflow {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.stat-icon.running {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
}

.stat-icon.success {
  background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
}

.stat-icon.failed {
  background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
}

.stat-value {
  font-size: 32px;
  font-weight: bold;
  color: #303133;
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-top: 4px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.quick-actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.quick-actions .el-button {
  justify-content: flex-start;
  padding: 20px;
  font-size: 16px;
}
</style>