<template>
  <div class="dag-editor">
    <el-card class="editor-card">
      <template #header>
        <div class="header-toolbar">
          <el-input
            v-model="workflowName"
            placeholder="工作流名称"
            style="width: 200px;"
          />
          <el-input
            v-model="workflowDesc"
            placeholder="工作流描述"
            style="width: 250px; margin-left: 10px;"
          />
          <el-input-number
            v-model="maxParallelTasks"
            :min="0"
            :max="100"
            placeholder="最大并行数"
            style="margin-left: 10px;"
            size="default"
          >
            <template #prepend>最大并行任务数</template>
          </el-input-number>
          <el-tooltip content="0表示不限制并行数" placement="bottom">
            <el-icon style="margin-left: 5px; color: #909399;"><QuestionFilled /></el-icon>
          </el-tooltip>
          <div class="toolbar-right">
            <el-button @click="clearCanvas">清空画布</el-button>
            <el-button type="primary" @click="saveWorkflow">保存工作流</el-button>
          </div>
        </div>
      </template>

      <div class="editor-container">
        <div class="node-palette">
          <h4>节点类型</h4>
          <div
            v-for="type in nodeTypes"
            :key="type.type"
            class="palette-item"
            draggable="true"
            @dragstart="onDragStart($event, type)"
          >
            <el-icon :size="20" :color="type.color">{{ type.icon }}</el-icon>
            <span>{{ type.label }}</span>
          </div>
        </div>

        <div class="canvas-wrapper">
          <el-alert
            v-if="hasCycle"
            :title="cycleMessage"
            type="error"
            :closable="false"
            style="margin-bottom: 10px;"
          />
          <div
            class="canvas"
            @drop="onDrop"
            @dragover.prevent
            @click="onCanvasClick"
            ref="canvasRef"
          >
          <div
            v-for="node in nodes"
            :key="node.id"
            class="dag-node"
            :class="{ selected: selectedNode?.id === node.id }"
            :style="{ left: node.x + 'px', top: node.y + 'px' }"
            @mousedown="startDragNode($event, node)"
            @click.stop="selectNode(node)"
          >
            <div class="node-header" :style="{ background: getNodeType(node.config.type).color }">
              <el-icon>{{ getNodeType(node.config.type).icon }}</el-icon>
              <span>{{ node.label }}</span>
            </div>
            <div class="node-body">
              {{ getNodeType(node.config.type).label }}
            </div>
            <div
              class="node-port output"
              @mousedown.stop="startConnect($event, node, 'output')"
            ></div>
            <div
              class="node-port input"
              @mousedown.stop="startConnect($event, node, 'input')"
            ></div>
          </div>

          <svg class="connections-svg">
            <line
              v-for="edge in edges"
              :key="edge.id"
              :x1="getNodeCenter(edge.source).x"
              :y1="getNodeCenter(edge.source).y"
              :x2="getNodeCenter(edge.target).x"
              :y2="getNodeCenter(edge.target).y"
              stroke="#409eff"
              stroke-width="2"
              marker-end="url(#arrowhead)"
            />
            <line
              v-if="connecting"
              :x1="connecting.from.x"
              :y1="connecting.from.y"
              :x2="connecting.to.x"
              :y2="connecting.to.y"
              stroke="#909399"
              stroke-width="2"
              stroke-dasharray="5,5"
            />
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#409eff" />
              </marker>
            </defs>
          </svg>
          </div>
        </div>

        <div class="properties-panel" v-if="selectedNode">
          <h4>节点属性</h4>
          <el-form label-width="80px">
            <el-form-item label="名称">
              <el-input v-model="selectedNode.label" />
            </el-form-item>
            <el-form-item label="类型">
              <el-select v-model="selectedNode.config.type" @change="onTypeChange">
                <el-option
                  v-for="type in nodeTypes"
                  :key="type.type"
                  :label="type.label"
                  :value="type.type"
                />
              </el-select>
            </el-form-item>
            
            <template v-if="selectedNode.config.type === 'shell'">
              <el-form-item label="脚本">
                <el-input
                  v-model="selectedNode.config.script"
                  type="textarea"
                  :rows="4"
                  placeholder="echo hello"
                />
              </el-form-item>
            </template>
            
            <template v-if="selectedNode.config.type === 'python'">
              <el-form-item label="脚本">
                <el-input
                  v-model="selectedNode.config.script"
                  type="textarea"
                  :rows="4"
                  placeholder="print('hello')"
                />
              </el-form-item>
            </template>
            
            <template v-if="selectedNode.config.type === 'http'">
              <el-form-item label="URL">
                <el-input v-model="selectedNode.config.url" placeholder="https://api.example.com" />
              </el-form-item>
              <el-form-item label="方法">
                <el-select v-model="selectedNode.config.method">
                  <el-option label="GET" value="GET" />
                  <el-option label="POST" value="POST" />
                  <el-option label="PUT" value="PUT" />
                  <el-option label="DELETE" value="DELETE" />
                </el-select>
              </el-form-item>
              <el-form-item label="请求头">
                <el-input
                  v-model="headersJson"
                  type="textarea"
                  :rows="3"
                  placeholder='{"Content-Type": "application/json"}'
                  @blur="parseHeaders"
                />
              </el-form-item>
              <el-form-item label="请求体">
                <el-input
                  v-model="bodyJson"
                  type="textarea"
                  :rows="3"
                  placeholder='{"key": "value"}'
                  @blur="parseBody"
                />
              </el-form-item>
            </template>
          </el-form>
          
          <el-button type="danger" @click="deleteNode" style="width: 100%; margin-top: 20px;">
            <el-icon><Delete /></el-icon>
            删除节点
          </el-button>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { workflowApi } from '@/api'
import { ElMessage } from 'element-plus'

const route = useRoute()
const router = useRouter()
const canvasRef = ref(null)

const workflowName = ref('')
const workflowDesc = ref('')
const workflowId = ref(null)
const maxParallelTasks = ref(0)

const nodes = ref([])
const edges = ref([])
const selectedNode = ref(null)

const draggingNode = ref(null)
const dragOffset = ref({ x: 0, y: 0 })

const connecting = ref(null)
const connectFromNode = ref(null)
const connectFromPort = ref(null)

const headersJson = ref('')
const bodyJson = ref('')

const hasCycle = ref(false)
const cyclePath = ref([])
const cycleMessage = ref('')

const nodeTypes = [
  { type: 'shell', label: 'Shell命令', icon: 'Operation', color: '#67c23a' },
  { type: 'python', label: 'Python脚本', icon: 'Code', color: '#409eff' },
  { type: 'http', label: 'HTTP请求', icon: 'Link', color: '#e6a23c' }
]

const getNodeType = (type) => {
  return nodeTypes.find(t => t.type === type) || nodeTypes[0]
}

const detectCycle = () => {
  if (nodes.value.length === 0) {
    hasCycle.value = false
    cyclePath.value = []
    cycleMessage.value = ''
    return false
  }

  const nodeIds = nodes.value.map(n => n.id)
  const inDegree = {}
  const adj = {}

  nodeIds.forEach(id => {
    inDegree[id] = 0
    adj[id] = []
  })

  edges.value.forEach(edge => {
    if (!inDegree[edge.source]) inDegree[edge.source] = 0
    if (!inDegree[edge.target]) inDegree[edge.target] = 0
    if (!adj[edge.source]) adj[edge.source] = []
    adj[edge.source].push(edge.target)
    inDegree[edge.target]++
  })

  const queue = nodeIds.filter(id => inDegree[id] === 0)
  let visitedCount = 0

  while (queue.length > 0) {
    const node = queue.shift()
    visitedCount++

    adj[node].forEach(neighbor => {
      inDegree[neighbor]--
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor)
      }
    })
  }

  if (visitedCount !== nodeIds.length) {
    const visited = new Set()
    const recursionStack = new Set()
    const path = []

    const findCycle = (node) => {
      visited.add(node)
      recursionStack.add(node)
      path.push(node)

      for (const neighbor of adj[node] || []) {
        if (!visited.has(neighbor)) {
          const result = findCycle(neighbor)
          if (result) return result
        } else if (recursionStack.has(neighbor)) {
          const cycleStart = path.indexOf(neighbor)
          return path.slice(cycleStart).concat([neighbor])
        }
      }

      path.pop()
      recursionStack.delete(node)
      return null
    }

    for (const nodeId of nodeIds) {
      if (!visited.has(nodeId)) {
        const cycle = findCycle(nodeId)
        if (cycle) {
          hasCycle.value = true
          cyclePath.value = cycle
          cycleMessage.value = `检测到循环依赖: ${cycle.join(' → ')}`
          return true
        }
      }
    }

    hasCycle.value = true
    cyclePath.value = []
    cycleMessage.value = '存在循环依赖'
    return true
  }

  hasCycle.value = false
  cyclePath.value = []
  cycleMessage.value = ''
  return false
}

watch([nodes, edges], () => {
  detectCycle()
}, { deep: true })

watch(selectedNode, (node) => {
  if (node && node.config.type === 'http') {
    headersJson.value = node.config.headers ? JSON.stringify(node.config.headers, null, 2) : ''
    bodyJson.value = node.config.body ? JSON.stringify(node.config.body, null, 2) : ''
  }
})

const parseHeaders = () => {
  if (selectedNode.value && headersJson.value) {
    try {
      selectedNode.value.config.headers = JSON.parse(headersJson.value)
    } catch (e) {
      console.error('JSON解析错误')
    }
  }
}

const parseBody = () => {
  if (selectedNode.value && bodyJson.value) {
    try {
      selectedNode.value.config.body = JSON.parse(bodyJson.value)
    } catch (e) {
      console.error('JSON解析错误')
    }
  }
}

const onDragStart = (e, type) => {
  e.dataTransfer.setData('nodeType', JSON.stringify(type))
}

const onDrop = (e) => {
  e.preventDefault()
  const typeData = e.dataTransfer.getData('nodeType')
  if (!typeData) return
  
  const type = JSON.parse(typeData)
  const rect = canvasRef.value.getBoundingClientRect()
  
  const newNode = {
    id: 'node_' + Date.now(),
    label: type.label,
    x: e.clientX - rect.left - 75,
    y: e.clientY - rect.top - 40,
    config: {
      type: type.type,
      script: '',
      url: '',
      method: 'GET',
      headers: {},
      body: {}
    }
  }
  
  nodes.value.push(newNode)
  selectedNode.value = newNode
}

const onCanvasClick = () => {
  selectedNode.value = null
}

const selectNode = (node) => {
  selectedNode.value = node
}

const startDragNode = (e, node) => {
  draggingNode.value = node
  dragOffset.value = {
    x: e.clientX - node.x,
    y: e.clientY - node.y
  }
  
  document.addEventListener('mousemove', onDragNode)
  document.addEventListener('mouseup', stopDragNode)
}

const onDragNode = (e) => {
  if (draggingNode.value) {
    const rect = canvasRef.value.getBoundingClientRect()
    draggingNode.value.x = Math.max(0, e.clientX - rect.left - dragOffset.value.x)
    draggingNode.value.y = Math.max(0, e.clientY - rect.top - dragOffset.value.y)
  }
}

const stopDragNode = () => {
  draggingNode.value = null
  document.removeEventListener('mousemove', onDragNode)
  document.removeEventListener('mouseup', stopDragNode)
}

const startConnect = (e, node, port) => {
  connectFromNode.value = node
  connectFromPort.value = port
  
  const rect = canvasRef.value.getBoundingClientRect()
  const nodeCenter = getNodeCenter(node.id)
  
  connecting.value = {
    from: { x: nodeCenter.x, y: nodeCenter.y },
    to: { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  
  document.addEventListener('mousemove', onConnecting)
  document.addEventListener('mouseup', stopConnect)
}

const onConnecting = (e) => {
  if (connecting.value) {
    const rect = canvasRef.value.getBoundingClientRect()
    connecting.value.to = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
  }
}

const stopConnect = (e) => {
  if (connecting.value && connectFromNode.value) {
    const rect = canvasRef.value.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    
    const targetNode = nodes.value.find(node => {
      return node.id !== connectFromNode.value.id &&
             x >= node.x && x <= node.x + 150 &&
             y >= node.y && y <= node.y + 80
    })
    
    if (targetNode) {
      const exists = edges.value.some(edge =>
        edge.source === connectFromNode.value.id && edge.target === targetNode.id
      )
      
      if (!exists) {
        const tempEdges = [...edges.value, {
          source: connectFromNode.value.id,
          target: targetNode.id
        }]
        
        const nodeIds = nodes.value.map(n => n.id)
        const inDegree = {}
        const adj = {}
        
        nodeIds.forEach(id => {
          inDegree[id] = 0
          adj[id] = []
        })
        
        tempEdges.forEach(edge => {
          if (!inDegree[edge.source]) inDegree[edge.source] = 0
          if (!inDegree[edge.target]) inDegree[edge.target] = 0
          if (!adj[edge.source]) adj[edge.source] = []
          adj[edge.source].push(edge.target)
          inDegree[edge.target]++
        })
        
        const queue = nodeIds.filter(id => inDegree[id] === 0)
        let visitedCount = 0
        const tempQueue = [...queue]
        
        while (tempQueue.length > 0) {
          const node = tempQueue.shift()
          visitedCount++
          
          adj[node].forEach(neighbor => {
            inDegree[neighbor]--
            if (inDegree[neighbor] === 0) {
              tempQueue.push(neighbor)
            }
          })
        }
        
        if (visitedCount === nodeIds.length) {
          edges.value.push({
            id: 'edge_' + Date.now(),
            source: connectFromNode.value.id,
            target: targetNode.id
          })
        } else {
          ElMessage.warning('此连接会形成循环依赖，不允许连接')
        }
      }
    }
  }
  
  connecting.value = null
  connectFromNode.value = null
  document.removeEventListener('mousemove', onConnecting)
  document.removeEventListener('mouseup', stopConnect)
}

const getNodeCenter = (nodeId) => {
  const node = nodes.value.find(n => n.id === nodeId)
  if (!node) return { x: 0, y: 0 }
  return {
    x: node.x + 75,
    y: node.y + 40
  }
}

const deleteNode = () => {
  if (selectedNode.value) {
    nodes.value = nodes.value.filter(n => n.id !== selectedNode.value.id)
    edges.value = edges.value.filter(e =>
      e.source !== selectedNode.value.id && e.target !== selectedNode.value.id
    )
    selectedNode.value = null
  }
}

const clearCanvas = () => {
  nodes.value = []
  edges.value = []
  selectedNode.value = null
}

const onTypeChange = () => {
  if (selectedNode.value) {
    selectedNode.value.label = getNodeType(selectedNode.value.config.type).label
  }
}

const saveWorkflow = async () => {
  if (!workflowName.value) {
    ElMessage.warning('请输入工作流名称')
    return
  }
  
  if (nodes.value.length === 0) {
    ElMessage.warning('请至少添加一个节点')
    return
  }
  
  if (hasCycle.value) {
    ElMessage.error(cycleMessage.value)
    return
  }
  
  const data = {
    name: workflowName.value,
    description: workflowDesc.value,
    dag_config: {
      nodes: nodes.value,
      edges: edges.value,
      max_parallel_tasks: maxParallelTasks.value
    }
  }
  
  try {
    if (workflowId.value) {
      await workflowApi.update(workflowId.value, data)
      ElMessage.success('更新成功')
    } else {
      await workflowApi.create(data)
      ElMessage.success('创建成功')
    }
    router.push('/workflows')
  } catch (error) {
    const errorDetail = error.response?.data?.detail
    if (errorDetail && errorDetail.error === '循环依赖检测失败') {
      ElMessage.error(errorDetail.message)
    } else {
      ElMessage.error('保存失败')
    }
  }
}

const loadWorkflow = async (id) => {
  try {
    const res = await workflowApi.get(id)
    const workflow = res.data
    workflowId.value = workflow.id
    workflowName.value = workflow.name
    workflowDesc.value = workflow.description || ''
    nodes.value = workflow.dag_config.nodes || []
    edges.value = workflow.dag_config.edges || []
    maxParallelTasks.value = workflow.dag_config.max_parallel_tasks || 0
  } catch (error) {
    ElMessage.error('加载工作流失败')
  }
}

onMounted(() => {
  if (route.params.id) {
    loadWorkflow(route.params.id)
  }
})
</script>

<style scoped>
.dag-editor {
  height: calc(100vh - 100px);
}

.editor-card {
  height: 100%;
}

.header-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toolbar-right {
  display: flex;
  gap: 10px;
}

.editor-container {
  display: flex;
  height: calc(100% - 50px);
  gap: 10px;
}

.node-palette {
  width: 180px;
  background: #f5f7fa;
  border-radius: 8px;
  padding: 15px;
}

.node-palette h4 {
  margin: 0 0 15px 0;
  color: #606266;
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: white;
  border-radius: 6px;
  margin-bottom: 10px;
  cursor: grab;
  transition: all 0.3s;
  border: 1px solid #e4e7ed;
}

.palette-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.canvas-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.canvas {
  flex: 1;
  background: #fafafa;
  border-radius: 8px;
  position: relative;
  overflow: auto;
  background-image: 
    linear-gradient(rgba(0, 0, 0, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 0, 0, 0.05) 1px, transparent 1px);
  background-size: 20px 20px;
}

.dag-node {
  position: absolute;
  width: 150px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  cursor: move;
  transition: box-shadow 0.3s;
  z-index: 10;
}

.dag-node:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.dag-node.selected {
  box-shadow: 0 0 0 2px #409eff, 0 4px 20px rgba(64, 158, 255, 0.3);
}

.node-header {
  padding: 8px 12px;
  color: white;
  border-radius: 8px 8px 0 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
}

.node-body {
  padding: 12px;
  font-size: 12px;
  color: #606266;
}

.node-port {
  position: absolute;
  width: 12px;
  height: 12px;
  background: #409eff;
  border: 2px solid white;
  border-radius: 50%;
  cursor: crosshair;
  z-index: 20;
}

.node-port.output {
  right: -6px;
  top: 50%;
  transform: translateY(-50%);
}

.node-port.input {
  left: -6px;
  top: 50%;
  transform: translateY(-50%);
}

.connections-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 5;
}

.properties-panel {
  width: 280px;
  background: #f5f7fa;
  border-radius: 8px;
  padding: 15px;
  overflow-y: auto;
}

.properties-panel h4 {
  margin: 0 0 15px 0;
  color: #606266;
}
</style>