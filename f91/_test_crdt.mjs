import * as Y from 'yjs';

export class CRDTHandler {
  constructor(roomId) {
    this.ydoc = new Y.Doc();
    this.ydoc.guid = roomId;
    this.ytext = this.ydoc.getText('content');
    this.awareness = new Y.Awareness(this.ydoc);
    this._onUpdate = this._onUpdate.bind(this);
    this._onTextChange = this._onTextChange.bind(this);
    this.ydoc.on('update', this._onUpdate);
    this.ytext.observe(this._onTextChange);
    this.onRemoteUpdate = null;
    this.onTextDelta = null;
    this.onAwarenessChange = null;

    this.awareness.on('change', () => {
      const state = this.awareness.getStates();
      if (this.onAwarenessChange) this.onAwarenessChange(state);
    });
  }

  _onUpdate(update, origin) {
    if (origin === this) {
      if (this.onLocalUpdate) this.onLocalUpdate(update);
    } else {
      if (this.onRemoteUpdate) this.onRemoteUpdate(update);
    }
  }

  _onTextChange(event) {
    if (this.onTextDelta) this.onTextDelta(event.delta);
  }

  applyRemoteUpdate(update) {
    Y.applyUpdate(this.ydoc, update, this);
  }

  encodeStateVector() {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  getText() {
    return this.ytext.toString();
  }

  insert(index, text) {
    this.ytext.insert(index, text, this);
  }

  delete(index, length) {
    this.ytext.delete(index, length, this);
  }

  createRelativePosition(index) {
    return Y.createRelativePositionFromTypeIndex(this.ytext, index);
  }

  fromRelativePosition(relPos) {
    const abs = Y.createAbsolutePositionFromRelativePosition(relPos, this.ydoc);
    return abs ? abs.index : 0;
  }

  setLocalAwareness(fields) {
    const prev = this.awareness.getLocalState() || {};
    this.awareness.setLocalState({ ...prev, ...fields });
  }

  getAwarenessStates() {
    return this.awareness.getStates();
  }

  destroy() {
    this.ydoc.off('update', this._onUpdate);
    this.ytext.unobserve(this._onTextChange);
    this.awareness.destroy();
    this.ydoc.destroy();
  }
}
