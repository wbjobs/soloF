export class YTextBinding {
  constructor(yText, textareaElement) {
    this.yText = yText
    this.textarea = textareaElement
    this.isComposing = false
    this._observer = this._onYTextChange.bind(this)
    
    this.yText.observe(this._observer)
    this.textarea.addEventListener('input', this._onInput.bind(this))
    this.textarea.addEventListener('compositionstart', () => { this.isComposing = true })
    this.textarea.addEventListener('compositionend', (e) => { 
      this.isComposing = false
      this._onInput(e)
    })
    
    this._syncFromYText()
  }

  _syncFromYText() {
    const cursorPos = this.textarea.selectionStart
    const yTextContent = this.yText.toString()
    
    if (this.textarea.value !== yTextContent) {
      this.textarea.value = yTextContent
      this.textarea.selectionStart = Math.min(cursorPos, yTextContent.length)
      this.textarea.selectionEnd = Math.min(cursorPos, yTextContent.length)
    }
  }

  _onYTextChange(event, transaction) {
    if (transaction.origin === this) return
    
    this._syncFromYText()
    
    this.textarea.dispatchEvent(new CustomEvent('y-update', {
      detail: { changes: event.changes }
    }))
  }

  _onInput(e) {
    if (this.isComposing) return
    
    const newValue = this.textarea.value
    const oldValue = this.yText.toString()
    
    if (newValue === oldValue) return
    
    let start = 0
    while (start < newValue.length && start < oldValue.length && newValue[start] === oldValue[start]) {
      start++
    }
    
    let oldEnd = oldValue.length
    let newEnd = newValue.length
    
    while (oldEnd > start && newEnd > start && oldValue[oldEnd - 1] === newValue[newEnd - 1]) {
      oldEnd--
      newEnd--
    }
    
    const deleteCount = oldEnd - start
    const insertText = newValue.slice(start, newEnd)
    
    this.yText.doc.transact(() => {
      if (deleteCount > 0) {
        this.yText.delete(start, deleteCount)
      }
      if (insertText.length > 0) {
        this.yText.insert(start, insertText)
      }
    }, this)
  }

  destroy() {
    this.yText.unobserve(this._observer)
  }
}
