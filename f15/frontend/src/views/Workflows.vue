<template>
  <div class="workflows">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>工作流管理</span>
          <el-button type="primary" @click="$router.push('/editor')">
            <el-icon><Plus /></el-icon>
            新建工作流
          </el-button>
        </div>
      </template>
      
      <el-table :data="workflows" v-loading="loading" style="width: 100%">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="名称" />
        <el-table-column prop="description" label="描述" show-overflow-tooltip />
        <el-table-column prop="schedule" label="定时表达式" width="150">
          <template #default="{ row }">
            <el-tag v-if="row.schedule" size="small">{{ row.schedule }}</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="is_active" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.is_active ? 'success' : 'info'" size="small">
              {{ row.is_active ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="editWorkflow(row)">
              <el-icon><Edit /></el-icon>
              编辑
            </el-button>
            <el-button type="success" link @click="executeWorkflow(row)">
              <el-icon><VideoPlay /></el-icon>
              执行
            </el-button>
            <el-button type="danger" link @click="deleteWorkflow(row)">
              <el-icon><Delete /></el-icon>
              删除
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
import { workflowApi } from '@/api'
import { ElMessage, ElMessageBox } from 'element-plus'

const router = useRouter()
const workflows = ref([])
const loading = ref(false)

const loadWorkflows = async () => {
  loading.value = true
  try {
    const res = await workflowApi.list()
    workflows.value = res.data
  } catch (error) {
    ElMessage.error('加载工作流失败')
  } finally {
    loading.value = false
  }
}

const editWorkflow = (row) => {
  router.push(`/editor/${row.id}`)
}

const executeWorkflow = async (row) => {
  try {
    const res = await workflowApi.execute(row.id)
    ElMessage.success(`工作流已启动，执行ID: ${res.data.execution_id}`)
    router.push(`/executions/${res.data.execution_id}`)
  } catch (error) {
    ElMessage.error('启动失败')
  }
}

const deleteWorkflow = async (row) => {
  try {
    await ElMessageBox.confirm('确定要删除该工作流吗？', '提示', {
      type: 'warning'
    })
    await workflowApi.delete(row.id)
    ElMessage.success('删除成功')
    loadWorkflows()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

onMounted(() => {
  loadWorkflows()
})
</script>

<style scoped>
.workflows {
  padding: 0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>