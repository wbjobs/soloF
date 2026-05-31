import * as Y from 'yjs'
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition } from 'y-prosemirror'

export class CommentAnchorManager {
  constructor(ydoc, xmlFragment) {
    this.ydoc = ydoc
    this.xmlFragment = xmlFragment
  }

  createRelativePosition(pos) {
    if (typeof pos !== 'number' || pos < 0) return null
    try {
      return absolutePositionToRelativePosition(pos, this.xmlFragment, this.ydoc)
    } catch (e) {
      console.error('Failed to create relative position:', e)
      return null
    }
  }

  resolveRelativePosition(relPos) {
    if (!relPos) return null
    try {
      const absPos = relativePositionToAbsolutePosition(this.ydoc, this.xmlFragment, relPos)
      return absPos
    } catch (e) {
      console.error('Failed to resolve relative position:', e)
      return null
    }
  }

  createAnchor(from, to, commentId) {
    const relFrom = this.createRelativePosition(from)
    const relTo = this.createRelativePosition(to)
    
    if (!relFrom || !relTo) return null
    
    return {
      commentId,
      relativeFrom: relFrom,
      relativeTo: relTo
    }
  }

  getAbsoluteRange(anchor) {
    if (!anchor || !anchor.relativeFrom || !anchor.relativeTo) return null
    
    const from = this.resolveRelativePosition(anchor.relativeFrom)
    const to = this.resolveRelativePosition(anchor.relativeTo)
    
    if (from === null || to === null) {
      return null
    }
    
    return { from, to }
  }

  static encodeRelativePosition(relPos) {
    if (!relPos) return null
    try {
      const encoded = Y.encodeRelativePosition(relPos)
      return btoa(String.fromCharCode.apply(null, encoded))
    } catch (e) {
      console.error('Failed to encode relative position:', e)
      return null
    }
  }

  static decodeRelativePosition(base64Str) {
    if (!base64Str) return null
    try {
      const binaryString = atob(base64Str)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      return Y.decodeRelativePosition(bytes)
    } catch (e) {
      console.error('Failed to decode relative position:', e)
      return null
    }
  }

  static encodeAnchor(anchor) {
    if (!anchor) return null
    return {
      commentId: anchor.commentId,
      relativeFrom: CommentAnchorManager.encodeRelativePosition(anchor.relativeFrom),
      relativeTo: CommentAnchorManager.encodeRelativePosition(anchor.relativeTo)
    }
  }

  static decodeAnchor(encoded) {
    if (!encoded) return null
    return {
      commentId: encoded.commentId,
      relativeFrom: CommentAnchorManager.decodeRelativePosition(encoded.relativeFrom),
      relativeTo: CommentAnchorManager.decodeRelativePosition(encoded.relativeTo)
    }
  }
}

export function createCommentAnchorManager(ydoc, xmlFragment) {
  return new CommentAnchorManager(ydoc, xmlFragment)
}