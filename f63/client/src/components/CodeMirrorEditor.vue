<template>
  <div class="editor-container" ref="containerRef">
    <div ref="editorRef"></div>
    <div
      v-for="cursor in remoteCursors"
      :key="cursor.userId"
      class="remote-cursor"
      :style="{
        left: cursor.left + 'px',
        top: cursor.top + 'px',
        height: cursor.height + 'px',
        background: cursor.color
      }"
    >
      <div class="remote-cursor-label" :style="{ background: cursor.color }">
        {{ cursor.userName }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { createInsert, createDelete, applyOperation, OP_INSERT, OP_DELETE } from '../ot.js'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  userId: {
    type: String,
    required: true
  },
  remoteCursors: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update:modelValue', 'operation', 'cursor-change'])

const containerRef = ref(null)
const editorRef = ref(null)
let view = null
let isApplyingRemote = false
let lastContent = ''

const updateListener = EditorView.updateListener.of((update) => {
  if (update.docChanged && !isApplyingRemote) {
    const changes = update.changes
    const newContent = update.state.doc.toString()
    
    changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      const insertedText = inserted.toString()
      
      if (toA > fromA) {
        const deleteOp = createDelete(fromA, toA - fromA, props.userId)
        emit('operation', deleteOp)
      }
      
      if (insertedText.length > 0) {
        const insertOp = createInsert(fromA, insertedText, props.userId)
        emit('operation', insertOp)
      }
    })
    
    lastContent = newContent
    emit('update:modelValue', newContent)
  }
  
  if (update.selectionSet) {
    const sel = update.state.selection.main
    emit('cursor-change', {
      anchor: sel.anchor,
      head: sel.head,
      from: sel.from,
      to: sel.to
    })
  }
})

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px'
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', monospace"
  },
  '.cm-content': {
    padding: '16px 0'
  },
  '.cm-line': {
    padding: '0 16px'
  },
  '.cm-gutters': {
    paddingRight: '8px'
  }
})

function initEditor(initialContent) {
  const state = EditorState.create({
    doc: initialContent,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      closeBrackets(),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      syntaxHighlighting(defaultHighlightStyle),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap
      ]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      updateListener,
      editorTheme
    ]
  })
  
  view = new EditorView({
    state,
    parent: editorRef.value
  })
  
  lastContent = initialContent
}

function applyRemoteOp(op) {
  if (!view) return
  
  isApplyingRemote = true
  
  try {
    const currentContent = view.state.doc.toString()
    const newContent = applyOperation(currentContent, op)
    
    view.dispatch({
      changes: {
        from: 0,
        to: currentContent.length,
        insert: newContent
      }
    })
    
    lastContent = newContent
    emit('update:modelValue', newContent)
  } finally {
    isApplyingRemote = false
  }
}

function setContent(content) {
  if (!view) return
  
  isApplyingRemote = true
  try {
    const currentContent = view.state.doc.toString()
    if (currentContent !== content) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: content
        }
      })
      lastContent = content
    }
  } finally {
    isApplyingRemote = false
  }
}

function getCaretCoordinates(position) {
  if (!view) return { top: 0, left: 0, height: 20 }
  
  const coords = view.coordsAtPos(position)
  const editorRect = editorRef.value.getBoundingClientRect()
  const containerRect = containerRef.value.getBoundingClientRect()
  
  if (coords) {
    return {
      top: coords.top - containerRect.top,
      left: coords.left - containerRect.left,
      height: coords.bottom - coords.top
    }
  }
  
  return { top: 0, left: 0, height: 20 }
}

defineExpose({
  applyRemoteOp,
  setContent,
  getCaretCoordinates
})

onMounted(() => {
  initEditor(props.modelValue)
})

onUnmounted(() => {
  if (view) {
    view.destroy()
    view = null
  }
})

watch(() => props.modelValue, (newVal) => {
  if (view && newVal !== lastContent && !isApplyingRemote) {
    setContent(newVal)
  }
})
</script>
