<template>
  <div class="editor-container">
    <div class="editor-toolbar" v-if="canEdit">
      <el-button-group>
        <el-button @click="execCommand('strong')" :class="{ active: isMarkActive('strong') }">
          <el-icon><Bold /></el-icon>
        </el-button>
        <el-button @click="execCommand('em')" :class="{ active: isMarkActive('em') }">
          <el-icon><Italic /></el-icon>
        </el-button>
        <el-button @click="execCommand('underline')">
          <el-icon><Underline /></el-icon>
        </el-button>
        <el-button @click="execCommand('important')" :class="{ active: isMarkActive('important') }">
          <el-icon><WarningFilled /></el-icon>
        </el-button>
      </el-button-group>
      
      <el-divider direction="vertical" />
      
      <el-button-group>
        <el-button @click="execCommand('heading', { level: 1 })">
          H1
        </el-button>
        <el-button @click="execCommand('heading', { level: 2 })">
          H2
        </el-button>
        <el-button @click="execCommand('heading', { level: 3 })">
          H3
        </el-button>
        <el-button @click="execCommand('paragraph')">
          正文
        </el-button>
      </el-button-group>
      
      <el-divider direction="vertical" />
      
      <el-button-group>
        <el-button @click="execCommand('bullet_list')">
          <el-icon><List /></el-icon>
        </el-button>
        <el-button @click="execCommand('ordered_list')">
          <el-icon><OrderedList /></el-icon>
        </el-button>
        <el-button @click="execCommand('blockquote')">
          <el-icon><ChatDotRound /></el-icon>
        </el-button>
      </el-button-group>
      
      <el-divider direction="vertical" />
      
      <el-button-group>
        <el-button @click="insertClause">
          <el-icon><Document /></el-icon>
          插入条款
        </el-button>
        <el-button @click="execCommand('code_block')">
          <el-icon><CircleCheck /></el-icon>
          代码块
        </el-button>
      </el-button-group>
      
      <el-divider direction="vertical" />
      
      <el-button-group>
        <el-button @click="execCommand('undo')">
          <el-icon><RefreshLeft /></el-icon>
        </el-button>
        <el-button @click="execCommand('redo')">
          <el-icon><RefreshRight /></el-icon>
        </el-button>
      </el-button-group>
      
      <div class="toolbar-right">
        <el-tag v-if="isConnected" type="success">
          <el-icon class="mr-1"><Connection /></el-icon>
          已连接
        </el-tag>
        <el-tag v-else type="warning">
          <el-icon class="mr-1"><Cpu /></el-icon>
          离线模式
        </el-tag>
        <el-tag class="ml-2" :type="userRoleType">
          {{ userRoleText }}
        </el-tag>
      </div>
    </div>
    
    <div class="editor-wrapper" ref="editorWrapper">
      <div ref="editor" class="prose-editor"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { ySyncPlugin, yCursorPlugin, yUndoPlugin, undo, redo } from 'y-prosemirror'
import { legalSchema } from '@/editor/schema'
import { buildKeymap, buildInputRules, history } from '@/editor/plugins'
import { createCollaborativeEditor } from '@/editor/yjs'
import { createCommentAnchorManager } from '@/editor/commentAnchor'
import { useAuthStore } from '@/stores/auth'
import { useDocumentStore } from '@/stores/document'
import {
  Bold, Italic, Underline, List, OrderedList, ChatDotRound,
  Document, RefreshLeft, RefreshRight, Connection, Cpu,
  WarningFilled, CircleCheck
} from '@element-plus/icons-vue'

const props = defineProps({
  docId: {
    type: String,
    required: true
  },
  editable: {
    type: Boolean,
    default: true
  },
  comments: {
    type: Array,
    default: () => []
  },
  activeCommentId: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['selectionChange', 'commentClick'])

const authStore = useAuthStore()
const documentStore = useDocumentStore()

const editor = ref(null)
const editorWrapper = ref(null)
const editorView = ref(null)
const collaborativeEditor = ref(null)
const commentAnchorManager = ref(null)
const isConnected = ref(false)
const currentState = ref(null)
const ydoc = ref(null)
const xmlFragment = ref(null)

const canEdit = computed(() => props.editable && authStore.canEdit)
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

function isMarkActive(markType) {
  if (!currentState.value) return false
  const { $from, $to } = currentState.value.selection
  const mark = currentState.value.schema.marks[markType]
  if (!mark) return false
  return currentState.value.doc.rangeHasMark($from.pos, $to.pos, mark)
}

function execCommand(command, attrs = {}) {
  if (!editorView.value) return
  const view = editorView.value
  const { state, dispatch } = view
  
  if (command === 'undo') {
    undo(state, dispatch)
    return
  }
  if (command === 'redo') {
    redo(state, dispatch)
    return
  }
  
  if (command === 'strong' || command === 'em' || command === 'underline' || command === 'important') {
    const markType = state.schema.marks[command]
    if (markType) {
      const { $from, $to } = state.selection
      if (state.selection.empty) return
      if (state.doc.rangeHasMark($from.pos, $to.pos, markType)) {
        dispatch(state.tr.removeMark($from.pos, $to.pos, markType).scrollIntoView())
      } else {
        dispatch(state.tr.addMark($from.pos, $to.pos, markType.create()).scrollIntoView())
      }
    }
    return
  }
  
  if (command === 'heading') {
    const nodeType = state.schema.nodes.heading
    if (nodeType) {
      dispatch(state.tr.setBlockType(state.selection.$from.pos, state.selection.$to.pos, nodeType, attrs).scrollIntoView())
    }
    return
  }
  
  if (command === 'paragraph') {
    const nodeType = state.schema.nodes.paragraph
    if (nodeType) {
      dispatch(state.tr.setBlockType(state.selection.$from.pos, state.selection.$to.pos, nodeType).scrollIntoView())
    }
    return
  }
  
  if (command === 'bullet_list' || command === 'ordered_list' || command === 'blockquote' || command === 'code_block') {
    const nodeType = state.schema.nodes[command]
    if (nodeType) {
      const { $from, $to } = state.selection
      const range = $from.blockRange($to)
      if (range) {
        dispatch(state.tr.wrap(range, [{ type: nodeType }]).scrollIntoView())
      }
    }
    return
  }
}

function insertClause() {
  if (!editorView.value) return
  const view = editorView.value
  const { state, dispatch } = view
  const clauseType = state.schema.nodes.clause
  if (clauseType) {
    const clause = clauseType.create({ title: '新条款' }, state.schema.text('在此输入条款内容...'))
    dispatch(state.tr.insert(state.selection.$from.pos, clause).scrollIntoView())
  }
}

function getSelectionInfo() {
  if (!editorView.value) return null
  const state = editorView.value.state
  const { $from, $to } = state.selection
  return {
    from: $from.pos,
    to: $to.pos,
    text: state.doc.textBetween($from.pos, $to.pos)
  }
}

function createRelativeAnchor(from, to, commentId) {
  if (!commentAnchorManager.value) return null
  return commentAnchorManager.value.createAnchor(from, to, commentId)
}

function resolveAnchor(encodedAnchor) {
  if (!commentAnchorManager.value || !encodedAnchor) return null
  
  const anchor = {
    relativeFrom: encodedAnchor.relativeFrom,
    relativeTo: encodedAnchor.relativeTo
  }
  
  return commentAnchorManager.value.getAbsoluteRange(anchor)
}

function highlightComment(commentId, encodedAnchor) {
  if (!editorView.value || !commentAnchorManager.value || !encodedAnchor) return
  
  const range = resolveAnchor(encodedAnchor)
  if (!range) return
  
  const { state, dispatch } = editorView.value
  const commentMark = state.schema.marks.comment
  
  if (!commentMark) return
  
  const { from, to } = range
  if (from >= to) return
  
  const tr = state.tr
  const currentMarks = state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isInline) {
      const marks = node.marks.filter(m => m.type.name !== 'comment' || m.attrs.commentId !== commentId)
      if (marks.length !== node.marks.length) {
        tr.removeMark(pos, pos + node.nodeSize, commentMark.create({ commentId }))
      }
    }
  })
  
  tr.addMark(from, to, commentMark.create({ commentId }))
  dispatch(tr)
}

function clearCommentHighlight(commentId) {
  if (!editorView.value) return
  
  const { state, dispatch } = editorView.value
  const commentMark = state.schema.marks.comment
  
  if (!commentMark) return
  
  const tr = state.tr
  state.doc.descendants((node, pos) => {
    if (node.isInline) {
      const commentMarks = node.marks.filter(m => m.type.name === 'comment' && m.attrs.commentId === commentId)
      if (commentMarks.length > 0) {
        tr.removeMark(pos, pos + node.nodeSize, commentMark.create({ commentId }))
      }
    }
  })
  
  dispatch(tr)
}

function scrollToComment(encodedAnchor) {
  if (!editorView.value || !commentAnchorManager.value || !encodedAnchor) return
  
  const range = resolveAnchor(encodedAnchor)
  if (!range) return
  
  const { from } = range
  
  editorView.value.dispatch(
    editorView.value.state.tr.setSelection(
      editorView.value.state.doc.resolve(from).node(1)
        ? editorView.value.state.selection.constructor.create(editorView.value.state.doc, from, from)
        : editorView.value.state.selection
    ).scrollIntoView()
  )
  
  const domPos = editorView.value.domAtPos(from)
  if (domPos && domPos.node) {
    domPos.node.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function updateAllCommentHighlights() {
  if (!editorView.value || !props.comments) return
  
  const { state, dispatch } = editorView.value
  const commentMark = state.schema.marks.comment
  if (!commentMark) return
  
  let tr = state.tr
  
  state.doc.descendants((node, pos) => {
    if (node.isInline) {
      const commentMarks = node.marks.filter(m => m.type.name === 'comment')
      if (commentMarks.length > 0) {
        commentMarks.forEach(mark => {
          tr.removeMark(pos, pos + node.nodeSize, mark)
        })
      }
    }
  })
  
  props.comments.forEach(comment => {
    if (!comment.position || !comment.position.relativeFrom || !comment.position.relativeTo) {
      return
    }
    
    const range = resolveAnchor({
      relativeFrom: comment.position.relativeFrom,
      relativeTo: comment.position.relativeTo
    })
    
    if (range) {
      const { from, to } = range
      if (from < to && from >= 0 && to <= state.doc.nodeSize) {
        tr.addMark(from, to, commentMark.create({ commentId: comment.id }))
      }
    }
  })
  
  dispatch(tr)
}

function getTextAtPosition(encodedAnchor) {
  if (!editorView.value || !commentAnchorManager.value || !encodedAnchor) return null
  
  const range = resolveAnchor(encodedAnchor)
  if (!range) return null
  
  const { from, to } = range
  if (from >= to) return null
  
  return editorView.value.state.doc.textBetween(from, to)
}

defineExpose({
  getSelectionInfo,
  editorView,
  createRelativeAnchor,
  resolveAnchor,
  highlightComment,
  clearCommentHighlight,
  scrollToComment,
  getTextAtPosition,
  updateAllCommentHighlights
})

watch(() => props.comments, () => {
  if (editorView.value) {
    setTimeout(() => updateAllCommentHighlights(), 100)
  }
}, { deep: true })

watch(() => props.activeCommentId, (newId, oldId) => {
  if (oldId) {
    const oldComment = props.comments.find(c => c.id === oldId)
    if (oldComment && oldComment.position) {
      clearCommentHighlight(oldId)
      if (oldComment.position.relativeFrom) {
        highlightComment(oldId, oldComment.position)
      }
    }
  }
}, { immediate: true })

onMounted(() => {
  collaborativeEditor.value = createCollaborativeEditor(props.docId, authStore.user)
  
  ydoc.value = collaborativeEditor.value.getYDoc()
  xmlFragment.value = collaborativeEditor.value.getXmlFragment()
  const awareness = collaborativeEditor.value.getAwareness()
  
  commentAnchorManager.value = createCommentAnchorManager(ydoc.value, xmlFragment.value)
  
  const state = EditorState.create({
    schema: legalSchema,
    plugins: [
      ySyncPlugin(xmlFragment.value),
      yCursorPlugin(awareness),
      yUndoPlugin(),
      buildInputRules(legalSchema),
      buildKeymap(legalSchema),
      history
    ]
  })
  
  editorView.value = new EditorView(editor.value, {
    state,
    editable: () => canEdit.value,
    dispatchTransaction: (transaction) => {
      const newState = editorView.value.state.apply(transaction)
      editorView.value.updateState(newState)
      currentState.value = newState
      
      if (transaction.selectionSet) {
        emit('selectionChange', getSelectionInfo())
      }
      
      if (transaction.docChanged) {
        setTimeout(() => updateAllCommentHighlights(), 50)
      }
    },
    handleClickOn: (view, pos, node, nodePos, event, direct) => {
      const marks = node.marks || []
      const commentMark = marks.find(m => m.type.name === 'comment')
      if (commentMark && commentMark.attrs.commentId) {
        emit('commentClick', commentMark.attrs.commentId)
        return true
      }
      return false
    }
  })
  
  collaborativeEditor.value.wsProvider.on('status', (event) => {
    isConnected.value = event.status === 'connected'
  })
  
  ydoc.value.on('update', () => {
    setTimeout(() => updateAllCommentHighlights(), 50)
  })
})

onBeforeUnmount(() => {
  if (editorView.value) {
    editorView.value.destroy()
  }
  if (collaborativeEditor.value) {
    collaborativeEditor.value.destroy()
  }
})
</script>

<style scoped>
.editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f5f7fa;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  background: white;
  border-bottom: 1px solid #e4e7ed;
  flex-wrap: wrap;
  gap: 4px;
}

.toolbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.mr-1 {
  margin-right: 4px;
}

.ml-2 {
  margin-left: 8px;
}

.editor-wrapper {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.prose-editor {
  max-width: 900px;
  margin: 0 auto;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  min-height: 100%;
}

:deep(.el-button.active) {
  background: #409eff;
  color: white;
  border-color: #409eff;
}

:deep(.el-button.active:hover) {
  background: #66b1ff;
  border-color: #66b1ff;
}
</style>