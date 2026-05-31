<template>
  <el-container class="app-container">
    <el-header class="app-header">
      <div class="header-left">
        <el-icon size="28" color="#409EFF"><Monitor /></el-icon>
        <h1>Prometheus TSDB Manager</h1>
      </div>
      <div class="header-right">
        <el-tag type="success" v-if="isConnected">Connected</el-tag>
        <el-tag type="danger" v-else>Disconnected</el-tag>
      </div>
    </el-header>
    
    <el-container>
      <el-aside width="200px" class="app-aside">
        <el-menu
          :default-active="activeMenu"
          router
          background-color="#304156"
          text-color="#bfcbd9"
          active-text-color="#409EFF"
        >
          <el-menu-item index="/">
            <el-icon><HomeFilled /></el-icon>
            <span>Dashboard</span>
          </el-menu-item>
          <el-menu-item index="/analyze">
            <el-icon><Search /></el-icon>
            <span>Analyze</span>
          </el-menu-item>
          <el-menu-item index="/optimize">
            <el-icon><MagicStick /></el-icon>
            <span>Optimize</span>
          </el-menu-item>
          <el-menu-item index="/cache">
            <el-icon><Coin /></el-icon>
            <span>Cache</span>
          </el-menu-item>
          <el-menu-item index="/blocks">
            <el-icon><Grid /></el-icon>
            <span>Blocks</span>
          </el-menu-item>
        </el-menu>
      </el-aside>
      
      <el-main class="app-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Monitor, HomeFilled, Search, MagicStick, Grid, Coin } from '@element-plus/icons-vue'
import axios from 'axios'

const route = useRoute()
const activeMenu = ref('/')
const isConnected = ref(false)

onMounted(() => {
  checkHealth()
})

const checkHealth = async () => {
  try {
    const res = await axios.get('/api/v1/health')
    isConnected.value = res.status === 200
  } catch (e) {
    isConnected.value = false
  }
}
</script>

<style scoped>
.app-container {
  height: 100vh;
}

.app-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  color: white;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-left h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
}

.app-aside {
  background-color: #304156;
}

.app-main {
  background-color: #f5f7fa;
  padding: 24px;
}
</style>
