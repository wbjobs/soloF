<template>
  <div class="documents-container">
    <el-header class="header">
      <div class="header-left">
        <el-icon class="logo"><Document /></el-icon>
        <h1>法律合同管理</h1>
      </div>
      <div class="header-right">
        <el-tag :type="userRoleType" size="large">
          {{ userRoleText }}
        </el-tag>
        <el-dropdown @command="handleCommand">
          <span class="user-info">
            <el-avatar :size="32" style="background-color: #409eff;">
              {{ authStore.user?.full_name?.charAt(0) || authStore.user?.username?.charAt(0) }}
            </el-avatar>
            <span class="username">{{ authStore.user?.full_name || authStore.user?.username }}</span>
            <el-icon><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-header>
    
    <el-main class="main-content">
      <div class="toolbar">
        <el-input
          v-model="searchQuery"
          placeholder="搜索文档..."
          style="width: 300px;"
          :prefix-icon="Search"
        />
        <el-button type="primary" :icon="Plus" @click="showCreateDialog" v-if="canCreate">
          新建合同
        </el-button>
      </div>
      
      <el-table :data="filteredDocuments" style="width: 100%" v-loading="documentStore.loading">
        <el-table-column prop="title" label="文档标题" min-width="200">
          <template #default="{ row }">
            <div class="doc-title" @click="openDocument(row.id)">
              <el-icon><Document /></el-icon>
              <span>{{ row.title }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="owner" label="创建者" width="150">
          <template #default="{ row }">
            <el-tag size="small">{{ row.owner }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="200">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column prop="updated_at" label="更新时间" width="200">
          <template #default="{ row }">
            {{ formatDate(row.updated_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openDocument(row.id)">
              打开
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      
      <el-empty v-if="!documentStore.loading && filteredDocuments.length === 0" description="暂无文档" />
    </el-main>
    
    <el-dialog v-model="createDialogVisible" title="新建合同文档">
      <el-form :model="createForm" label-width="80px">
        <el-form-item label="文档标题">
          <el-input v-model="createForm.title" placeholder="请输入文档标题" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="createDocument" :loading="creating">
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useDocumentStore } from '@/stores/document'
import { ElMessage } from 'element-plus'
import { Document, ArrowDown, Search, Plus } from '@element-plus/icons-vue'

const router = useRouter()
const authStore = useAuthStore()
const documentStore = useDocumentStore()

const searchQuery = ref('')
const createDialogVisible = ref(false)
const creating = ref(false)
const createForm = ref({
  title: ''
})

const canCreate = computed(() => authStore.isLawyer)

const userRoleType = computed(() => {
  const role = authStore.userRole
  if (role === 'admin' || role === 'lawyer') return 'primary'
  return 'info'
})

const userRoleText = computed(() => {
  const role = authStore.userRole
  if (role === 'admin') return '管理员'
  if (role === 'lawyer') return '律师'
  return '客户'
})

const filteredDocuments = computed(() => {
  if (!searchQuery.value) return documentStore.documents
  return documentStore.documents.filter(doc =>
    doc.title.toLowerCase().includes(searchQuery.value.toLowerCase())
  )
})

function formatDate(dateStr) {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN')
}

function openDocument(docId) {
  router.push(`/document/${docId}`)
}

function showCreateDialog() {
  createForm.value.title = ''
  createDialogVisible.value = true
}

async function createDocument() {
  if (!createForm.value.title.trim()) {
    ElMessage.warning('请输入文档标题')
    return
  }
  
  creating.value = true
  try {
    const doc = await documentStore.createDocument(createForm.value.title)
    ElMessage.success('创建成功')
    createDialogVisible.value = false
    router.push(`/document/${doc.id}`)
  } catch (error) {
    ElMessage.error('创建失败')
  } finally {
    creating.value = false
  }
}

function handleCommand(command) {
  if (command === 'logout') {
    authStore.logout()
    router.push('/login')
  }
}

onMounted(() => {
  documentStore.fetchDocuments()
})
</script>

<style scoped>
.documents-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.header {
  background: white;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-left h1 {
  margin: 0;
  font-size: 20px;
  color: #303133;
}

.logo {
  font-size: 28px;
  color: #409eff;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.username {
  font-size: 14px;
  color: #606266;
}

.main-content {
  flex: 1;
  overflow: auto;
  padding: 24px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.doc-title {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: #409eff;
}

.doc-title:hover {
  color: #66b1ff;
}
</style>