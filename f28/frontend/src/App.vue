<template>
  <div class="app-container">
    <el-container>
      <el-header>
        <h1>任务调度系统</h1>
        <el-button type="primary" @click="showCreateDialog = true">
          <el-icon><Plus /></el-icon>
          新建任务
        </el-button>
      </el-header>
      <el-main>
        <el-table :data="tasks" border style="width: 100%">
          <el-table-column prop="id" label="ID" width="80" />
          <el-table-column prop="name" label="任务名称" width="180" />
          <el-table-column prop="cron_expr" label="Cron表达式" width="150" />
          <el-table-column prop="command" label="执行命令" show-overflow-tooltip />
          <el-table-column prop="dependency" label="依赖任务" width="120">
            <template #default="{ row }">
              <span v-if="row.dependency">{{ row.dependency }}</span>
              <span v-else class="text-gray">-</span>
            </template>
          </el-table-column>
          <el-table-column prop="timeout" label="超时(秒)" width="100">
            <template #default="{ row }">
              <span>{{ row.timeout || 30 }}</span>
            </template>
          </el-table-column>
          <el-table-column label="运行状态" width="120">
            <template #default="{ row }">
              <el-tag :type="getStatusType(row.status)" size="small">
                {{ row.status === 'running' ? '运行中' : '已停止' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="执行结果" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.last_status" :type="getResultType(row.last_status)" size="small">
                {{ getResultText(row.last_status) }}
              </el-tag>
              <span v-else class="text-gray">-</span>
            </template>
          </el-table-column>
          <el-table-column label="下次执行" width="180">
            <template #default="{ row }">
              <span v-if="row.next_run">{{ formatDate(row.next_run) }}</span>
              <span v-else class="text-gray">-</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="280" fixed="right">
            <template #default="{ row }">
              <el-button size="small" @click="viewLogs(row.id)">日志</el-button>
              <el-button v-if="row.status === 'stopped'" size="small" type="success" @click="startTask(row.id)">
                启动
              </el-button>
              <el-button v-else size="small" type="warning" @click="stopTask(row.id)">
                停止
              </el-button>
              <el-button size="small" type="danger" @click="deleteTask(row.id)">
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-main>
    </el-container>

    <el-dialog v-model="showCreateDialog" title="新建任务" width="600px">
      <el-form :model="formData" label-width="100px">
        <el-form-item label="任务名称">
          <el-input v-model="formData.name" />
        </el-form-item>
        <el-form-item label="Cron表达式">
          <el-input v-model="formData.cron_expr" placeholder="例如: */5 * * * * *" />
        </el-form-item>
        <el-form-item label="执行命令">
          <el-input v-model="formData.command" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="超时时间(秒)">
          <el-input-number v-model="formData.timeout" :min="1" :max="3600" />
        </el-form-item>
        <el-form-item label="依赖任务ID">
          <el-input v-model="formData.dependency" placeholder="JSON数组格式，如: [1,2]" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="createTask">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showLogsDialog" title="任务日志" width="900px" :fullscreen="true">
      <template #header>
        <div class="dialog-header">
          <span>任务日志 - {{ currentTaskName }}</span>
          <el-tag v-if="wsConnected" type="success" size="small">实时连接中</el-tag>
          <el-tag v-else type="info" size="small">离线模式</el-tag>
        </div>
      </template>
      <el-tabs v-model="activeLogTab">
        <el-tab-pane label="执行历史" name="history">
          <el-table :data="taskLogs" border style="width: 100%; margin-bottom: 20px;">
            <el-table-column prop="start_time" label="开始时间" width="180">
              <template #default="{ row }">{{ formatDate(row.start_time) }}</template>
            </el-table-column>
            <el-table-column prop="end_time" label="结束时间" width="180">
              <template #default="{ row }">{{ formatDate(row.end_time) }}</template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="getResultType(row.status)" size="small">
                  {{ getResultText(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100">
              <template #default="{ row }">
                <el-button size="small" @click="showLogDetail(row)">查看详情</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="实时日志" name="realtime">
          <div class="realtime-log-container">
            <div class="log-toolbar">
              <el-button size="small" @click="clearRealtimeLog">清空</el-button>
              <el-button size="small" @click="scrollToBottom">滚动到底部</el-button>
            </div>
            <div ref="logContainerRef" class="log-content">
              <div v-for="(log, index) in realtimeLogs" :key="index" :class="['log-line', log.status]">
                <span class="log-time">{{ formatDate(new Date()) }}</span>
                <span class="log-status">[{{ getResultText(log.status) }}]</span>
                <span class="log-message">{{ log.message }}</span>
              </div>
              <div v-if="realtimeLogs.length === 0" class="empty-log">暂无实时日志</div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>

    <el-dialog v-model="showLogDetailDialog" title="日志详情" width="800px">
      <el-descriptions :column="1" border>
        <el-descriptions-item label="开始时间">{{ formatDate(selectedLog.start_time) }}</el-descriptions-item>
        <el-descriptions-item label="结束时间">{{ formatDate(selectedLog.end_time) }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="getResultType(selectedLog.status)" size="small">
            {{ getResultText(selectedLog.status) }}
          </el-tag>
        </el-descriptions-item>
      </el-descriptions>
      <div class="log-output-title">输出内容：</div>
      <pre class="log-output">{{ selectedLog.output }}</pre>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import axios from 'axios'

const tasks = ref([])
const taskLogs = ref([])
const realtimeLogs = ref([])
const showCreateDialog = ref(false)
const showLogsDialog = ref(false)
const showLogDetailDialog = ref(false)
const activeLogTab = ref('history')
const wsConnected = ref(false)
const currentTaskId = ref(null)
const currentTaskName = ref('')
const selectedLog = ref({})
const logContainerRef = ref(null)
let ws = null
let autoRefreshInterval = null

const formData = ref({
  name: '',
  cron_expr: '',
  command: '',
  timeout: 30,
  dependency: ''
})

const fetchTasks = async () => {
  try {
    const res = await axios.get('/api/tasks')
    tasks.value = res.data.data
  } catch (err) {
    // 静默失败，避免频繁弹窗
  }
}

const createTask = async () => {
  try {
    await axios.post('/api/tasks', formData.value)
    ElMessage.success('创建成功')
    showCreateDialog.value = false
    formData.value = { name: '', cron_expr: '', command: '', timeout: 30, dependency: '' }
    fetchTasks()
  } catch (err) {
    const msg = err.response?.data?.error || '创建失败'
    ElMessage.error(msg)
  }
}

const startTask = async (id) => {
  try {
    await axios.post(`/api/tasks/${id}/start`)
    ElMessage.success('启动成功')
    fetchTasks()
  } catch (err) {
    const msg = err.response?.data?.error || '启动失败'
    ElMessage.error(msg)
  }
}

const stopTask = async (id) => {
  try {
    await axios.post(`/api/tasks/${id}/stop`)
    ElMessage.success('停止成功')
    fetchTasks()
  } catch (err) {
    const msg = err.response?.data?.error || '停止失败'
    ElMessage.error(msg)
  }
}

const deleteTask = async (id) => {
  try {
    await ElMessageBox.confirm('确定要删除这个任务吗?', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await axios.delete(`/api/tasks/${id}`)
    ElMessage.success('删除成功')
    fetchTasks()
  } catch (err) {
    if (err !== 'cancel') {
      const msg = err.response?.data?.error || '删除失败'
      ElMessage.error(msg)
    }
  }
}

const viewLogs = async (id) => {
  try {
    const task = tasks.value.find(t => t.id === id)
    currentTaskId.value = id
    currentTaskName.value = task ? task.name : ''
    const res = await axios.get(`/api/tasks/${id}/logs`)
    taskLogs.value = res.data.data
    realtimeLogs.value = []
    showLogsDialog.value = true
    connectWebSocket(id)
  } catch (err) {
    const msg = err.response?.data?.error || '获取日志失败'
    ElMessage.error(msg)
  }
}

const showLogDetail = (log) => {
  selectedLog.value = log
  showLogDetailDialog.value = true
}

const clearRealtimeLog = () => {
  realtimeLogs.value = []
}

const scrollToBottom = () => {
  nextTick(() => {
    if (logContainerRef.value) {
      logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight
    }
  })
}

const connectWebSocket = (taskId) => {
  if (ws) {
    ws.close()
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//localhost:8080/api/tasks/${taskId}/ws`
  ws = new WebSocket(wsUrl)
  ws.onopen = () => {
    wsConnected.value = true
  }
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      realtimeLogs.value.push({
        message: data.message,
        status: data.status,
        timestamp: data.timestamp
      })
      scrollToBottom()
    } catch (e) {
      realtimeLogs.value.push({
        message: event.data,
        status: 'running',
        timestamp: new Date().toISOString()
      })
      scrollToBottom()
    }
  }
  ws.onclose = () => {
    wsConnected.value = false
  }
  ws.onerror = () => {
    wsConnected.value = false
  }
}

const disconnectWebSocket = () => {
  if (ws) {
    ws.close()
    ws = null
  }
  wsConnected.value = false
}

const getStatusType = (status) => {
  return status === 'running' ? 'success' : 'info'
}

const getResultType = (status) => {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'timeout') return 'warning'
  if (status === 'running') return 'primary'
  return 'info'
}

const getResultText = (status) => {
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'timeout') return '超时'
  if (status === 'running') return '运行中'
  return status
}

const formatDate = (date) => {
  if (!date) return '-'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

watch(showLogsDialog, (newVal) => {
  if (!newVal) {
    disconnectWebSocket()
  }
})

onMounted(() => {
  fetchTasks()
  autoRefreshInterval = setInterval(fetchTasks, 5000)
})

onBeforeUnmount(() => {
  disconnectWebSocket()
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval)
  }
})
</script>

<style scoped>
.app-container {
  height: 100vh;
}
.el-header {
  background-color: #409eff;
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
}
.el-header h1 {
  margin: 0;
  font-size: 24px;
}
.el-main {
  background-color: #f5f7fa;
  padding: 20px;
}
.text-gray {
  color: #909399;
}
.dialog-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.realtime-log-container {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 200px);
}
.log-toolbar {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #ebeef5;
  margin-bottom: 10px;
}
.log-content {
  flex: 1;
  overflow-y: auto;
  background: #1e1e1e;
  padding: 15px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
}
.log-line {
  margin-bottom: 5px;
  white-space: pre-wrap;
  word-break: break-all;
}
.log-line.success {
  color: #67c23a;
}
.log-line.failed {
  color: #f56c6c;
}
.log-line.timeout {
  color: #e6a23c;
}
.log-line.running {
  color: #409eff;
}
.log-time {
  color: #888;
  margin-right: 10px;
}
.log-status {
  margin-right: 10px;
  font-weight: bold;
}
.log-message {
  color: #d4d4d4;
}
.empty-log {
  color: #888;
  text-align: center;
  padding: 50px;
}
.log-output-title {
  margin: 20px 0 10px 0;
  font-weight: bold;
}
.log-output {
  background: #f5f7fa;
  padding: 15px;
  border-radius: 4px;
  max-height: 400px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
}
</style>
