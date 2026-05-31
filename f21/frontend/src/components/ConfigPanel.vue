<template>
  <div class="config-panel">
    <div class="panel-header" @click="togglePanel">
      <h3>⚙️ 异常检测配置</h3>
      <span class="toggle-icon">{{ isOpen ? '▼' : '▶' }}</span>
    </div>
    
    <div v-if="isOpen" class="panel-content">
      <div class="form-grid">
        <div class="form-group">
          <label>滑动窗口大小</label>
          <input
            type="number"
            v-model.number="localConfig.window_size"
            min="5"
            max="100"
            class="form-input"
          />
          <span class="hint">数据点数量 (5-100)</span>
        </div>
        
        <div class="form-group">
          <label>IQR阈值倍数</label>
          <input
            type="number"
            v-model.number="localConfig.iqr_threshold"
            min="0.5"
            max="10"
            step="0.1"
            class="form-input"
          />
          <span class="hint">异常判定灵敏度 (0.5-10)</span>
        </div>
        
        <div class="form-group">
          <label>最小数据点数</label>
          <input
            type="number"
            v-model.number="localConfig.min_data_points"
            min="3"
            max="20"
            class="form-input"
          />
          <span class="hint">开始检测所需数据 (3-20)</span>
        </div>
        
        <div class="form-group">
          <label>异常检测窗口</label>
          <input
            type="number"
            v-model.number="localConfig.recent_window"
            min="2"
            max="10"
            class="form-input"
          />
          <span class="hint">最近N个数据点 (2-10)</span>
        </div>
        
        <div class="form-group">
          <label>异常判定数量</label>
          <input
            type="number"
            v-model.number="localConfig.required_anomalies"
            min="1"
            max="10"
            class="form-input"
          />
          <span class="hint">窗口内异常点数量 (1-10)</span>
        </div>
      </div>
      
      <div class="button-group">
        <button @click="saveConfig" class="btn btn-primary" :disabled="isSaving">
          {{ isSaving ? '保存中...' : '保存配置' }}
        </button>
        <button @click="resetConfig" class="btn btn-secondary">
          重置
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { getAnomalyConfig, updateAnomalyConfig, type AnomalyConfig } from '../api'

const emit = defineEmits<{
  (e: 'config-updated', config: AnomalyConfig): void
}>()

const isOpen = ref(false)
const isSaving = ref(false)
const currentConfig = ref<AnomalyConfig | null>(null)
const localConfig = ref<Partial<AnomalyConfig>>({})

const loadConfig = async () => {
  try {
    const config = await getAnomalyConfig()
    currentConfig.value = config
    localConfig.value = { ...config }
  } catch (error) {
    console.error('加载配置失败:', error)
  }
}

const saveConfig = async () => {
  if (!localConfig.value) return
  isSaving.value = true
  try {
    const updated = await updateAnomalyConfig(localConfig.value)
    currentConfig.value = updated
    emit('config-updated', updated)
    alert('配置保存成功！')
  } catch (error) {
    console.error('保存配置失败:', error)
    alert('保存失败，请重试')
  } finally {
    isSaving.value = false
  }
}

const resetConfig = () => {
  if (currentConfig.value) {
    localConfig.value = { ...currentConfig.value }
  }
}

const togglePanel = () => {
  isOpen.value = !isOpen.value
  if (isOpen.value && !currentConfig.value) {
    loadConfig()
  }
}

onMounted(() => {
  loadConfig()
})
</script>

<style scoped>
.config-panel {
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.panel-header {
  padding: 16px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: opacity 0.2s;
}

.panel-header:hover {
  opacity: 0.95;
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.toggle-icon {
  font-size: 12px;
  opacity: 0.8;
}

.panel-content {
  padding: 20px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: #333;
}

.form-input {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.hint {
  font-size: 11px;
  color: #999;
}

.button-group {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-secondary {
  background: #f0f0f0;
  color: #333;
}

.btn-secondary:hover:not(:disabled) {
  background: #e5e5e5;
}
</style>