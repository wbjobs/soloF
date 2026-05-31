<template>
  <div class="app">
    <el-container>
      <el-header>
        <h1>OTA 固件升级中心</h1>
      </el-header>
      <el-main>
        <el-row :gutter="20">
          <el-col :span="16">
            <el-card class="mb-4">
              <template #header>
                <div class="card-header">
                  <span>设备列表</span>
                  <el-button type="primary" size="small" @click="fetchDevices">刷新</el-button>
                </div>
              </template>
              <el-table :data="deviceList" border>
                <el-table-column label="设备ID" width="200">
                  <template #default="{ row }">
                    <span>{{ row.device_id }}</span>
                    <el-tag
                      v-if="grayConfig.enabled"
                      :type="isDeviceInGrayList(row.device_id) ? 'success' : 'info'"
                      size="small"
                      style="margin-left: 8px"
                    >
                      {{ isDeviceInGrayList(row.device_id) ? '灰度' : '排除' }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="ip" label="IP地址" width="140" />
                <el-table-column prop="version" label="当前版本" width="120" />
                <el-table-column prop="status" label="状态" width="120">
                  <template #default="{ row }">
                    <el-tag :type="getStatusType(row.status)">{{ row.status || 'offline' }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="升级进度" width="200">
                  <template #default="{ row }">
                    <el-progress
                      v-if="row.upgrade_info"
                      :percentage="Math.round((row.upgrade_info.received / row.upgrade_info.total_size) * 100)"
                      :status="row.upgrade_info.received >= row.upgrade_info.total_size ? 'success' : undefined"
                    />
                    <span v-else>-</span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="200">
                  <template #default="{ row }">
                    <el-button
                      type="primary"
                      size="small"
                      @click="showUpgradeDialog(row.device_id)"
                      :disabled="row.status === 'upgrading' || !isDeviceInGrayList(row.device_id)"
                    >
                      升级固件
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-card>
          </el-col>

          <el-col :span="8">
            <el-card class="mb-4">
              <template #header>
                <div class="card-header">
                  <span>固件管理</span>
                </div>
              </template>
              <el-upload
                action="/api/firmwares"
                :data="{ version: newVersion }"
                :on-success="onUploadSuccess"
                :show-file-list="false"
              >
                <el-input v-model="newVersion" placeholder="版本号" class="mb-2" />
                <el-button type="primary" class="w-full">上传固件</el-button>
              </el-upload>
              <el-divider />
              <el-list>
                <el-list-item v-for="fw in firmwareList" :key="fw.id">
                  <div class="firmware-item">
                    <strong>{{ fw.version }}</strong>
                    <span class="size">{{ formatSize(fw.size) }}</span>
                    <span class="checksum">{{ fw.checksum?.slice(0, 8) }}...</span>
                  </div>
                </el-list-item>
              </el-list>
            </el-card>

            <el-card class="mb-4">
              <template #header>
                <div class="card-header">
                  <span>灰度发布配置</span>
                  <el-switch
                    v-model="grayConfig.enabled"
                    @change="saveGrayConfig"
                  />
                </div>
              </template>
              <div v-if="grayConfig.enabled" class="gray-config">
                <div class="prefix-input">
                  <el-input
                    v-model="newPrefix"
                    placeholder="输入设备ID前缀"
                    size="small"
                    @keyup.enter="addPrefix"
                    style="flex: 1"
                  />
                  <el-button type="primary" size="small" @click="addPrefix">
                    添加
                  </el-button>
                </div>
                <el-divider />
                <div class="prefix-list">
                  <div
                    v-for="prefix in grayConfig.allowed_prefixes"
                    :key="prefix"
                    class="prefix-item"
                  >
                    <el-tag>{{ prefix }}</el-tag>
                    <el-button
                      type="danger"
                      size="small"
                      text
                      @click="removePrefix(prefix)"
                    >
                      删除
                    </el-button>
                  </div>
                  <el-empty
                    v-if="grayConfig.allowed_prefixes.length === 0"
                    description="暂无前缀配置，所有设备都无法升级"
                    :image-size="80"
                  />
                </div>
                <el-button
                  type="primary"
                  size="small"
                  class="w-full mt-4"
                  @click="saveGrayConfig"
                >
                  保存配置
                </el-button>
              </div>
              <div v-else class="gray-disabled">
                <el-empty
                  description="灰度发布已关闭，所有设备均可升级"
                  :image-size="80"
                />
              </div>
            </el-card>
          </el-col>
        </el-row>
      </el-main>
    </el-container>

    <el-dialog v-model="upgradeDialogVisible" title="选择固件升级" width="400px">
      <el-form label-width="80px">
        <el-form-item label="目标设备">
          <el-input v-model="selectedDevice" disabled />
        </el-form-item>
        <el-form-item label="选择固件">
          <el-select v-model="selectedFirmware" class="w-full">
            <el-option
              v-for="fw in firmwareList"
              :key="fw.id"
              :label="fw.version"
              :value="fw.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="upgradeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="startUpgrade" :loading="upgrading">开始升级</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

interface DeviceInfo {
  device_id: string
  ip: string
  version: string
  status: string
  upgrade_info?: {
    firmware_id: string
    version: string
    total_size: number
    received: number
    checksum: string
  }
}

interface FirmwareInfo {
  id: string
  version: string
  size: number
  checksum: string
}

interface GrayReleaseConfig {
  enabled: boolean
  allowed_prefixes: string[]
}

const deviceList = ref<DeviceInfo[]>([])
const firmwareList = ref<FirmwareInfo[]>([])
const newVersion = ref('')
const upgradeDialogVisible = ref(false)
const selectedDevice = ref('')
const selectedFirmware = ref('')
const upgrading = ref(false)
const grayConfig = ref<GrayReleaseConfig>({
  enabled: false,
  allowed_prefixes: []
})
const newPrefix = ref('')

const fetchDevices = async () => {
  try {
    const res = await axios.get('/api/devices')
    deviceList.value = Object.values(res.data.devices)
  } catch (e) {
    console.error(e)
  }
}

const fetchFirmwares = async () => {
  try {
    const res = await axios.get('/api/firmwares')
    firmwareList.value = Object.values(res.data.firmwares)
  } catch (e) {
    console.error(e)
  }
}

const onUploadSuccess = () => {
  ElMessage.success('固件上传成功')
  newVersion.value = ''
  fetchFirmwares()
}

const showUpgradeDialog = (deviceId: string) => {
  selectedDevice.value = deviceId
  upgradeDialogVisible.value = true
}

const startUpgrade = async () => {
  if (!selectedFirmware.value) {
    ElMessage.warning('请选择固件')
    return
  }
  upgrading.value = true
  try {
    await axios.post('/api/upgrade', {
      device_id: selectedDevice.value,
      firmware_id: selectedFirmware.value
    })
    ElMessage.success('升级指令已发送')
    upgradeDialogVisible.value = false
    setTimeout(fetchDevices, 1000)
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '升级失败')
  } finally {
    upgrading.value = false
  }
}

const getStatusType = (status: string) => {
  switch (status) {
    case 'online': return 'success'
    case 'upgrading': return 'warning'
    default: return 'info'
  }
}

const fetchGrayConfig = async () => {
  try {
    const res = await axios.get('/api/gray-config')
    grayConfig.value = res.data.config
  } catch (e) {
    console.error(e)
  }
}

const saveGrayConfig = async () => {
  try {
    await axios.post('/api/gray-config', grayConfig.value)
    ElMessage.success('灰度发布配置已保存')
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || '保存失败')
  }
}

const addPrefix = () => {
  const prefix = newPrefix.value.trim()
  if (prefix && !grayConfig.value.allowed_prefixes.includes(prefix)) {
    grayConfig.value.allowed_prefixes.push(prefix)
    newPrefix.value = ''
  }
}

const removePrefix = (prefix: string) => {
  const index = grayConfig.value.allowed_prefixes.indexOf(prefix)
  if (index > -1) {
    grayConfig.value.allowed_prefixes.splice(index, 1)
  }
}

const isDeviceInGrayList = (deviceId: string): boolean => {
  if (!grayConfig.value.enabled) return true
  return grayConfig.value.allowed_prefixes.some(prefix => 
    deviceId.startsWith(prefix)
  )
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

onMounted(() => {
  fetchDevices()
  fetchFirmwares()
  fetchGrayConfig()
  setInterval(fetchDevices, 3000)
})
</script>

<style scoped>
.app {
  height: 100vh;
}

.el-header {
  background-color: #409EFF;
  color: white;
  display: flex;
  align-items: center;
}

.el-header h1 {
  margin: 0;
  font-size: 24px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.mb-4 {
  margin-bottom: 16px;
}

.mb-2 {
  margin-bottom: 8px;
}

.mt-4 {
  margin-top: 16px;
}

.w-full {
  width: 100%;
}

.firmware-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.firmware-item .size {
  color: #909399;
  font-size: 12px;
}

.firmware-item .checksum {
  color: #C0C4CC;
  font-size: 11px;
  font-family: monospace;
}

.prefix-input {
  display: flex;
  gap: 8px;
  align-items: center;
}

.prefix-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid #f0f0f0;
}

.prefix-item:last-child {
  border-bottom: none;
}

.gray-disabled {
  padding: 20px 0;
}
</style>
