<template>
  <div class="container">
    <div class="sidebar">
      <h1>🎯 3D矩阵变换可视化</h1>
      
      <div class="section">
        <div class="section-title">动画设置</div>
        <div class="animation-controls">
          <div class="control-row">
            <label>动画曲线:</label>
            <select v-model="easingType" class="select-input">
              <option value="linear">线性</option>
              <option value="ease">缓动</option>
              <option value="bounce">弹跳</option>
              <option value="elastic">弹性</option>
              <option value="back">回弹</option>
            </select>
          </div>
          <div class="control-row">
            <label>动画时长:</label>
            <input 
              v-model.number="animationDuration" 
              class="number-input" 
              type="number" 
              min="0" 
              max="3" 
              step="0.1"
            />
            <span class="unit">秒</span>
          </div>
          <div class="control-row">
            <label>
              <input type="checkbox" v-model="enableAnimation" />
              启用动画
            </label>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">预设变换</div>
        <div class="preset-buttons">
          <button class="btn btn-secondary" @click="applyIdentity">单位矩阵</button>
          <button class="btn btn-secondary" @click="applyTranslation">平移变换</button>
          <button class="btn btn-secondary" @click="applyRotation">旋转变换</button>
          <button class="btn btn-secondary" @click="applyScale">缩放变换</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">变换矩阵 (4×4)</div>
        <div class="matrix-grid">
          <input
            v-for="(value, index) in matrix"
            :key="index"
            v-model.number="matrix[index]"
            class="matrix-input"
            type="number"
            step="0.1"
          />
        </div>
      </div>

      <div class="section">
        <div class="section-title">矩阵运算</div>
        <div class="btn-group">
          <button class="btn btn-primary" @click="computeInverse">求逆矩阵</button>
          <button class="btn btn-primary" @click="computeEigen">特征分解</button>
        </div>
        
        <div class="matrix-label">矩阵B (用于乘法)</div>
        <div class="matrix-grid">
          <input
            v-for="(value, index) in matrixB"
            :key="'b-' + index"
            v-model.number="matrixB[index]"
            class="matrix-input"
            type="number"
            step="0.1"
          />
        </div>
        <button class="btn btn-primary" @click="multiplyMatrices">A × B</button>
      </div>

      <div v-if="error" class="error-message">{{ error }}</div>

      <div v-if="result" class="result-box">
        <div class="result-title">计算结果</div>
        <div class="matrix-grid">
          <input
            v-for="(value, index) in result"
            :key="'r-' + index"
            :value="value.toFixed(4)"
            class="matrix-input"
            disabled
          />
        </div>
      </div>

      <div v-if="eigenResult" class="result-box">
        <div class="result-title">特征值</div>
        <div style="font-size: 14px; line-height: 2;">
          {{ eigenResult.eigenvalues?.map(v => v.toFixed(4)).join(', ') }}
        </div>
      </div>

      <div class="section">
        <div class="section-title">计算历史</div>
        <button class="btn btn-secondary" @click="clearHistory" style="margin-bottom: 12px;">
          清空历史
        </button>
        <div v-for="record in history.slice().reverse()" :key="record.id" class="history-item">
          <div class="history-type">{{ getOperationName(record.type) }}</div>
          <div class="history-time">{{ formatTime(record.timestamp) }}</div>
        </div>
      </div>
    </div>

    <div class="main-content">
      <ThreeScene 
        :matrix="matrix" 
        :easing="easingType" 
        :duration="enableAnimation ? animationDuration : 0"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import ThreeScene, { type EasingType } from './components/ThreeScene.vue'
import type { MatrixResult, EigenResult, CalculationRecord } from './types'

const enableAnimation = ref(true)
const animationDuration = ref(0.5)
const easingType = ref<EasingType>('ease')

const matrix = ref<number[]>([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
])

const matrixB = ref<number[]>([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
])

const result = ref<number[] | null>(null)
const eigenResult = ref<EigenResult | null>(null)
const error = ref<string>('')
const history = ref<CalculationRecord[]>([])

function calculateDeterminant(m: number[]): number {
  if (m.length !== 16) return 0
  
  const inv = new Array(16)
  
  inv[0] = m[5]  * m[10] * m[15] - 
           m[5]  * m[11] * m[14] - 
           m[9]  * m[6]  * m[15] + 
           m[9]  * m[7]  * m[14] +
           m[13] * m[6]  * m[11] - 
           m[13] * m[7]  * m[10]

  inv[4] = -m[4]  * m[10] * m[15] + 
            m[4]  * m[11] * m[14] + 
            m[8]  * m[6]  * m[15] - 
            m[8]  * m[7]  * m[14] - 
            m[12] * m[6]  * m[11] + 
            m[12] * m[7]  * m[10]

  inv[8] = m[4]  * m[9] * m[15] - 
           m[4]  * m[11] * m[13] - 
           m[8]  * m[5] * m[15] + 
           m[8]  * m[7] * m[13] + 
           m[12] * m[5] * m[11] - 
           m[12] * m[7] * m[9]

  inv[12] = -m[4]  * m[9] * m[14] + 
             m[4]  * m[10] * m[13] +
             m[8]  * m[5] * m[14] - 
             m[8]  * m[6] * m[13] - 
             m[12] * m[5] * m[10] + 
             m[12] * m[6] * m[9]

  return m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12]
}

function isSingularMatrix(m: number[]): boolean {
  const det = calculateDeterminant(m)
  return Math.abs(det) < 1e-10
}

const applyIdentity = () => {
  matrix.value = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

const applyTranslation = () => {
  matrix.value = [1, 0, 0, 1, 0, 1, 0, 0.5, 0, 0, 1, 0.3, 0, 0, 0, 1]
}

const applyRotation = () => {
  const angle = Math.PI / 4
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  matrix.value = [cos, -sin, 0, 0, sin, cos, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

const applyScale = () => {
  matrix.value = [1.5, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 1.2, 0, 0, 0, 0, 1]
}

const multiplyMatrices = async () => {
  try {
    const response = await fetch('/api/matrix/multiply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matrixA: matrix.value, matrixB: matrixB.value })
    })
    
    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status}`)
    }
    
    const data: MatrixResult = await response.json()
    
    if (data.success && data.data) {
      matrix.value = data.data
      result.value = data.data
      error.value = ''
      await loadHistory()
    } else {
      error.value = data.error || '计算失败'
      result.value = null
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '计算失败，请重试'
    result.value = null
    console.error('矩阵乘法失败:', e)
  }
}

const computeInverse = async () => {
  try {
    if (isSingularMatrix(matrix.value)) {
      error.value = '矩阵不可逆（行列式为0），请修改矩阵值后重试'
      result.value = null
      return
    }
    
    const response = await fetch('/api/matrix/inverse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matrix: matrix.value })
    })
    
    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status}`)
    }
    
    const data: MatrixResult = await response.json()
    
    if (data.success && data.data) {
      result.value = data.data
      error.value = ''
      await loadHistory()
    } else {
      error.value = data.error || '计算失败'
      result.value = null
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '计算失败，请重试'
    result.value = null
    console.error('矩阵求逆失败:', e)
  }
}

const computeEigen = async () => {
  try {
    const response = await fetch('/api/matrix/eigen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matrix: matrix.value })
    })
    
    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status}`)
    }
    
    const data: EigenResult = await response.json()
    
    if (data.success) {
      eigenResult.value = data
      error.value = ''
      await loadHistory()
    } else {
      error.value = data.error || '计算失败'
      eigenResult.value = null
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '计算失败，请重试'
    eigenResult.value = null
    console.error('特征分解失败:', e)
  }
}

const loadHistory = async () => {
  try {
    const response = await fetch('/api/history')
    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status}`)
    }
    const data = await response.json()
    if (data.success) {
      history.value = data.data
    }
  } catch (e) {
    console.error('加载历史失败:', e)
  }
}

const clearHistory = async () => {
  try {
    const response = await fetch('/api/history', { method: 'DELETE' })
    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status}`)
    }
    history.value = []
  } catch (e) {
    console.error('清空历史失败:', e)
  }
}

const getOperationName = (type: string): string => {
  const names: Record<string, string> = {
    multiply: '矩阵乘法',
    inverse: '矩阵求逆',
    eigen: '特征分解'
  }
  return names[type] || type
}

const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString('zh-CN')
}

onMounted(() => {
  loadHistory()
})
</script>
