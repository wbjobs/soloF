<template>
  <div class="login-container">
    <el-card class="login-card">
      <template #header>
        <div class="login-header">
          <h1>法律合同协同编辑平台</h1>
          <p>请登录以继续</p>
        </div>
      </template>
      
      <el-form :model="loginForm" ref="loginFormRef" label-position="top" @submit.prevent="handleLogin">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="loginForm.username" placeholder="请输入用户名" size="large" />
        </el-form-item>
        
        <el-form-item label="密码" prop="password">
          <el-input v-model="loginForm.password" type="password" placeholder="请输入密码" size="large" show-password />
        </el-form-item>
        
        <el-button type="primary" size="large" class="login-btn" @click="handleLogin" :loading="loading">
          登录
        </el-button>
      </el-form>
      
      <div class="demo-accounts">
        <h4>演示账号：</h4>
        <p><strong>管理员：</strong>admin / admin123</p>
        <p><strong>律师：</strong>lawyer1 / lawyer123</p>
        <p><strong>客户：</strong>client1 / client123</p>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessage } from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()

const loginForm = ref({
  username: '',
  password: ''
})

const loginFormRef = ref(null)
const loading = ref(false)

async function handleLogin() {
  if (!loginForm.value.username || !loginForm.value.password) {
    ElMessage.warning('请输入用户名和密码')
    return
  }
  
  loading.value = true
  try {
    await authStore.login(loginForm.value.username, loginForm.value.password)
    ElMessage.success('登录成功')
    router.push('/')
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-container {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.login-card {
  width: 420px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.login-header {
  text-align: center;
}

.login-header h1 {
  margin: 0 0 8px 0;
  font-size: 24px;
  color: #303133;
}

.login-header p {
  margin: 0;
  color: #909399;
  font-size: 14px;
}

.login-btn {
  width: 100%;
  margin-top: 16px;
}

.demo-accounts {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
}

.demo-accounts h4 {
  margin: 0 0 8px 0;
  color: #606266;
  font-size: 14px;
}

.demo-accounts p {
  margin: 4px 0;
  font-size: 13px;
  color: #909399;
}

.demo-accounts strong {
  color: #606266;
}
</style>