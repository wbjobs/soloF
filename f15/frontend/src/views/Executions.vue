<template>
  <div class="executions">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>执行历史</span>
          <el-button type="primary" @click="$router.push('/workflows')">
            <el-icon><Plus /></el-icon>
            新建执行
          </el-button>
        </div>
      </template>
      
      <el-table :data="executions" v-loading="loading" style="width: 100%">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="workflow_id" label="工作流ID" width="120" />
        <el-table-column prop="execution_id" label="执行ID" width="200" />
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
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="viewDetail(row)">
              <el-icon><View /></el-icon>
              详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { executionApi } from '@/api'
import { ElMessage } from 'element-plus'

const router = useRouter()
const executions = ref([])
const loading = ref(false)

const loadExecutions = async () => {
  loading.value = true
  try {
    const res = await executionApi.list()
    executions.value = res.data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  } catch (error) {
    ElMessage.error('加载执行历史失败')
  } finally {
    loading.value = false
  }
}

const viewDetail = (row) => {
  router.push(`/executions/${row.execution_id}`)
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
  loadExecutions()
})
</script>

<style scoped>
.executions {
  padding: 0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>