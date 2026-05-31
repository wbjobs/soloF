<template>
  <div class="editor-page">
    <el-header class="page-header">
      <div class="header-left">
        <el-button link @click="goBack" class="back-btn">
          <el-icon><ArrowLeft /></el-icon>
          返回列表
        </el-button>
        <el-divider direction="vertical" />
        <h2 class="doc-title">{{ document?.title || '加载中...' }}</h2>
      </div>
      <div class="header-right">
        <el-dropdown v-if="canEdit" @command="handleExportCommand" class="mr-2">
          <el-button type="primary" size="small">
            <el-icon class="mr-1"><Download /></el-icon>
            导出
            <el-icon class="ml-1"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="pdf">
                <el-icon><Document /></el-icon>
                导出为 PDF
              </el-dropdown-item>
              <el-dropdown-item command="redline">
                <el-icon><EditPen /></el-icon>
                导出修订模式 PDF
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        
        <el-button v-if="canEdit" type="success" size="small" @click="showSaveVersionDialog" :loading="savingVersion">
          <el-icon class="mr-1"><Collection /></el-icon>
          保存版本
        </el-button>
        
        <el-button v-if="canEdit" type="info" size="small" @click="showVersionHistory" class="ml-2">
          <el-icon class="mr-1"><Clock /></el-icon>
          版本历史
        </el-button>
        
        <el-tag :type="userRoleType" size="large" class="ml-2">
          {{ userRoleText }}
        </el-tag>
      </div>
    </el-header>
    
    <div class="editor-content">
      <div class="editor-area">
        <ProseEditor
          ref="editorRef"
          :docId="docId"
          :editable="canEdit"
          :comments="documentStore.comments"
          :activeCommentId="activeCommentId"
          @selectionChange="handleSelectionChange"
          @commentClick="handleCommentClick"
        />
      </div>
      
      <div class="comments-panel">
        <div class="panel-header">
          <h3>
            <el-icon><ChatDotRound /></el-icon>
            评论
          </h3>
          <el-badge :value="documentStore.comments.length" class="item" />
        </div>
        
        <div class="comment-input" v-if="canComment">
          <el-input
            v-model="newComment"
            type="textarea"
            :rows="3"
            placeholder="添加评论..."
            resize="none"
          />
          <div class="comment-actions">
            <el-button type="primary" size="small" @click="submitComment" :loading="submitting">
              发表评论
            </el-button>
            <span v-if="selectedText" class="selected-info">
              已选择文本: "{{ selectedText.substring(0, 30) }}{{ selectedText.length > 30 ? '...' : '' }}"
            </span>
          </div>
        </div>
        
        <el-divider class="panel-divider" />
        
        <div class="comments-list">
          <el-empty v-if="documentStore.comments.length === 0" description="暂无评论" />
          <div
            v-for="comment in documentStore.comments"
            :key="comment.id"
            class="comment-item"
            :class="{ active: activeCommentId === comment.id }"
            @click="focusComment(comment)"
          >
            <div class="comment-header">
              <el-avatar :size="28" style="background-color: #409eff;">
                {{ comment.author?.charAt(0) }}
              </el-avatar>
              <div class="comment-meta">
                <span class="author">{{ comment.author }}</span>
                <span class="time">{{ formatDate(comment.created_at) }}</span>
              </div>
            </div>
            <div class="comment-quoted" v-if="getCommentQuotedText(comment)">
              <el-icon class="quote-icon"><ChatLineSquare /></el-icon>
              <span class="quote-text">"{{ getCommentQuotedText(comment) }}"</span>
            </div>
            <div class="comment-content">
              {{ comment.content }}
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <el-dialog v-model="saveVersionDialog" title="保存版本" width="500px">
      <el-form :model="versionForm" label-width="80px">
        <el-form-item label="版本说明">
          <el-input
            v-model="versionForm.comment"
            type="textarea"
            :rows="3"
            placeholder="请输入本次版本的修改说明（可选）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="saveVersionDialog = false">取消</el-button>
        <el-button type="primary" @click="saveVersion" :loading="savingVersion">
          保存
        </el-button>
      </template>
    </el-dialog>
    
    <el-dialog v-model="versionHistoryDialog" title="版本历史" width="700px">
      <div v-if="versions.length === 0" class="empty-versions">
        <el-empty description="暂无版本记录" />
      </div>
      <div v-else class="version-list">
        <div
          v-for="version in versions"
          :key="version.id"
          class="version-item"
        >
          <div class="version-header">
            <el-tag type="primary" size="small">
              版本 {{ version.version_number }}
            </el-tag>
            <span class="version-meta">
              <el-icon><User /></el-icon>
              {{ version.created_by }}
              <el-icon class="ml-2"><Clock /></el-icon>
              {{ formatDate(version.created_at) }}
            </span>
          </div>
          <div class="version-comment" v-if="version.comment">
            {{ version.comment }}
          </div>
          <div class="version-actions">
            <el-button size="small" type="primary" link @click="exportRedlineFromVersion(version.version_number)">
              <el-icon><Download /></el-icon>
              导出修订对比
            </el-button>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="versionHistoryDialog = false">关闭</el-button>
      </template>
    </el-dialog>
    
    <el-dialog v-model="redlineDialog" title="导出修订模式 PDF" width="500px">
      <el-form label-width="120px">
        <el-form-item label="起始版本">
          <el-select v-model="redlineForm.from_version" placeholder="选择起始版本">
            <el-option
              v-for="version in versions"
              :key="version.version_number"
              :label="`版本 ${version.version_number}`"
              :value="version.version_number"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="目标版本">
          <el-select v-model="redlineForm.to_version" placeholder="选择目标版本">
            <el-option
              v-for="version in versions"
              :key="version.version_number"
              :label="`版本 ${version.version_number}`"
              :value="version.version_number"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <div class="redline-hint">
        <el-alert
          title="系统将对比两个版本的差异，生成 Redline 格式的 PDF 文件，高亮显示所有新增、删除和修改的内容。"
          type="info"
          :closable="false"
        />
      </div>
      <template #footer>
        <el-button @click="redlineDialog = false">取消</el-button>
        <el-button type="primary" @click="exportRedline" :loading="exporting">
          导出 PDF
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useDocumentStore } from '@/stores/document'
import ProseEditor from '@/components/ProseEditor.vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import {
  ArrowLeft, ChatDotRound, ChatLineSquare, Download, Document,
  EditPen, Collection, Clock, User, ArrowDown
} from '@element-plus/icons-vue'
import { CommentAnchorManager } from '@/editor/commentAnchor'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const documentStore = useDocumentStore()

const docId = computed(() => route.params.id)
const document = ref(null)
const editorRef = ref(null)
const newComment = ref('')
const submitting = ref(false)
const selectedText = ref('')
const selectedRange = ref(null)
const activeCommentId = ref(null)
const quotedTextCache = ref(new Map())

const saveVersionDialog = ref(false)
const versionHistoryDialog = ref(false)
const redlineDialog = ref(false)
const savingVersion = ref(false)
const exporting = ref(false)
const versions = ref([])

const versionForm = ref({
  comment: ''
})

const redlineForm = ref({
  from_version: null,
  to_version: null
})

const canEdit = computed(() => authStore.canEdit)
const canComment = computed(() => authStore.canComment)

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

function goBack() {
  router.push('/')
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN')
}

function handleSelectionChange(selection) {
  if (selection && selection.text) {
    selectedText.value = selection.text
    selectedRange.value = { from: selection.from, to: selection.to }
  } else {
    selectedText.value = ''
    selectedRange.value = null
  }
}

function handleCommentClick(commentId) {
  activeCommentId.value = commentId
  
  const comment = documentStore.comments.find(c => c.id === commentId)
  if (comment && comment.position && editorRef.value) {
    editorRef.value.scrollToComment(comment.position)
  }
}

function focusComment(comment) {
  activeCommentId.value = comment.id
  
  if (comment.position && editorRef.value) {
    editorRef.value.scrollToComment(comment.position)
  }
}

function getCommentQuotedText(comment) {
  if (!comment.position) return null
  
  if (quotedTextCache.value.has(comment.id)) {
    return quotedTextCache.value.get(comment.id)
  }
  
  if (editorRef.value) {
    const text = editorRef.value.getTextAtPosition(comment.position)
    if (text) {
      const truncated = text.length > 50 ? text.substring(0, 50) + '...' : text
      quotedTextCache.value.set(comment.id, truncated)
      return truncated
    }
  }
  
  return null
}

async function submitComment() {
  if (!newComment.value.trim()) {
    ElMessage.warning('请输入评论内容')
    return
  }
  
  let positionData = null
  
  if (selectedRange.value && editorRef.value) {
    const relativeAnchor = editorRef.value.createRelativeAnchor(
      selectedRange.value.from,
      selectedRange.value.to,
      null
    )
    
    if (relativeAnchor) {
      positionData = {
        relativeFrom: CommentAnchorManager.encodeRelativePosition(relativeAnchor.relativeFrom),
        relativeTo: CommentAnchorManager.encodeRelativePosition(relativeAnchor.relativeTo),
        originalText: selectedText.value
      }
    }
  }
  
  submitting.value = true
  try {
    await documentStore.addComment(docId.value, newComment.value, positionData)
    ElMessage.success('评论已发表')
    newComment.value = ''
    selectedText.value = ''
    selectedRange.value = null
    quotedTextCache.value.clear()
    
    setTimeout(() => {
      if (editorRef.value) {
        editorRef.value.updateAllCommentHighlights()
      }
    }, 200)
  } catch (error) {
    ElMessage.error('发表失败')
  } finally {
    submitting.value = false
  }
}

function handleExportCommand(command) {
  if (command === 'pdf') {
    exportSimplePDF()
  } else if (command === 'redline') {
    showRedlineDialog()
  }
}

async function exportSimplePDF() {
  try {
    const response = await axios.post(`/api/documents/${docId.value}/export/pdf`, {}, {
      responseType: 'blob'
    })
    
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `${document.value?.title || 'document'}.pdf`)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
    
    ElMessage.success('PDF 导出成功')
  } catch (error) {
    ElMessage.error('导出失败，请确保已保存至少一个版本')
  }
}

function showSaveVersionDialog() {
  versionForm.value.comment = ''
  saveVersionDialog.value = true
}

async function saveVersion() {
  if (!editorRef.value || !editorRef.value.editorView) {
    ElMessage.error('编辑器未就绪')
    return
  }
  
  const state = editorRef.value.editorView.state
  const content = state.doc.toString()
  
  savingVersion.value = true
  try {
    await axios.post(`/api/documents/${docId.value}/versions`, {
      content: content,
      comment: versionForm.value.comment
    })
    
    ElMessage.success('版本保存成功')
    saveVersionDialog.value = false
    await loadVersions()
  } catch (error) {
    ElMessage.error('保存版本失败')
  } finally {
    savingVersion.value = false
  }
}

async function showVersionHistory() {
  await loadVersions()
  versionHistoryDialog.value = true
}

async function loadVersions() {
  try {
    const response = await axios.get(`/api/documents/${docId.value}/versions`)
    versions.value = response.data
  } catch (error) {
    ElMessage.error('加载版本历史失败')
  }
}

function showRedlineDialog() {
  if (versions.value.length === 0) {
    loadVersions()
  }
  redlineForm.value.from_version = null
  redlineForm.value.to_version = null
  redlineDialog.value = true
}

function exportRedlineFromVersion(versionNum) {
  redlineForm.value.from_version = versionNum - 1 > 0 ? versionNum - 1 : null
  redlineForm.value.to_version = versionNum
  redlineDialog.value = true
  versionHistoryDialog.value = false
}

async function exportRedline() {
  if (redlineForm.value.to_version === null) {
    ElMessage.warning('请选择目标版本')
    return
  }
  
  exporting.value = true
  try {
    const response = await axios.post(
      `/api/documents/${docId.value}/export/redline`,
      {
        from_version: redlineForm.value.from_version,
        to_version: redlineForm.value.to_version
      },
      { responseType: 'blob' }
    )
    
    const fromVer = redlineForm.value.from_version || '初始'
    const toVer = redlineForm.value.to_version
    const filename = `${document.value?.title || 'document'}_修订模式_v${fromVer}-v${toVer}.pdf`
    
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
    
    ElMessage.success('修订模式 PDF 导出成功')
    redlineDialog.value = false
  } catch (error) {
    ElMessage.error('导出失败，请确保已保存至少两个版本')
  } finally {
    exporting.value = false
  }
}

async function loadDocument() {
  try {
    document.value = await documentStore.getDocument(docId.value)
    await documentStore.fetchComments(docId.value)
    await loadVersions()
  } catch (error) {
    ElMessage.error('加载文档失败')
    router.push('/')
  }
}

onMounted(() => {
  loadDocument()
})
</script>

<style scoped>
.editor-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.page-header {
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

.header-right {
  display: flex;
  align-items: center;
}

.back-btn {
  font-size: 14px;
  padding: 8px 0;
}

.doc-title {
  margin: 0;
  font-size: 18px;
  color: #303133;
}

.mr-1 {
  margin-right: 4px;
}

.mr-2 {
  margin-right: 8px;
}

.ml-1 {
  margin-left: 4px;
}

.ml-2 {
  margin-left: 8px;
}

.editor-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.editor-area {
  flex: 1;
  overflow: hidden;
}

.comments-panel {
  width: 360px;
  background: white;
  border-left: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid #f0f2f5;
}

.panel-header h3 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  color: #303133;
}

.panel-divider {
  margin: 0;
}

.comment-input {
  padding: 16px;
}

.comment-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.selected-info {
  font-size: 12px;
  color: #909399;
}

.comments-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.comment-item {
  margin-bottom: 16px;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  border-left: 3px solid transparent;
}

.comment-item:hover {
  background: #ecf5ff;
}

.comment-item.active {
  background: #ecf5ff;
  border-left-color: #409eff;
}

.comment-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.comment-meta {
  display: flex;
  flex-direction: column;
}

.author {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.time {
  font-size: 12px;
  color: #909399;
}

.comment-quoted {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px;
  background: #fff7e6;
  border-left: 3px solid #e6a23c;
  border-radius: 4px;
  margin-bottom: 8px;
}

.quote-icon {
  font-size: 14px;
  color: #e6a23c;
  flex-shrink: 0;
  margin-top: 2px;
}

.quote-text {
  font-size: 12px;
  color: #b88230;
  font-style: italic;
  line-height: 1.4;
}

.comment-content {
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
}

.version-list {
  max-height: 500px;
  overflow-y: auto;
}

.version-item {
  padding: 16px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  margin-bottom: 12px;
  background: #fafafa;
}

.version-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.version-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #909399;
}

.version-comment {
  font-size: 14px;
  color: #606266;
  padding: 8px 12px;
  background: white;
  border-radius: 4px;
  border-left: 3px solid #409eff;
}

.version-actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}

.redline-hint {
  margin-top: 16px;
}

.empty-versions {
  padding: 40px 0;
}
</style>