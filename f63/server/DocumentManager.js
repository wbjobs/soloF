import { applyOperation, transformOperationAgainstHistory } from './ot.js'

export class DocumentManager {
  constructor(initialContent = '') {
    this.content = initialContent
    this.version = 0
    this.history = []
    this.users = new Map()
  }

  getContent() {
    return this.content
  }

  getVersion() {
    return this.version
  }

  getHistory() {
    return [...this.history]
  }

  getHistorySince(sinceVersion) {
    return this.history.slice(sinceVersion)
  }

  addUser(userId, userName, color) {
    this.users.set(userId, { id: userId, name: userName, color, cursor: null })
    return this.getUsers()
  }

  removeUser(userId) {
    this.users.delete(userId)
    return this.getUsers()
  }

  updateCursor(userId, cursor) {
    const user = this.users.get(userId)
    if (user) {
      user.cursor = cursor
    }
    return this.getUsers()
  }

  getUsers() {
    return Array.from(this.users.values())
  }

  applyOperation(op, clientVersion) {
    const historySinceClient = this.getHistorySince(clientVersion)
    
    const transformedOp = transformOperationAgainstHistory(op, historySinceClient)
    
    if (!transformedOp) {
      return { applied: false, content: this.content, version: this.version }
    }

    this.content = applyOperation(this.content, transformedOp)
    this.version++
    
    const opWithVersion = { ...transformedOp, version: this.version }
    this.history.push(opWithVersion)

    return {
      applied: true,
      content: this.content,
      version: this.version,
      transformedOp: opWithVersion
    }
  }
}

export const documents = new Map()

export function getOrCreateDocument(docId, initialContent = '# 欢迎使用协同 Markdown 编辑器\n\n这是一个支持多人实时协同编辑的 Markdown 编辑器。\n\n## 功能特性\n\n- ✅ 实时协同编辑\n- ✅ 自动冲突解决 (OT 算法)\n- ✅ 多用户光标显示\n- ✅ Markdown 语法高亮\n\n开始编辑吧！') {
  if (!documents.has(docId)) {
    documents.set(docId, new DocumentManager(initialContent))
  }
  return documents.get(docId)
}
