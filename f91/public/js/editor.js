export function createTextEditor(container, crdt, mesh, { myName, myColor }) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';

  const textarea = document.createElement('textarea');
  textarea.className = 'editor';
  textarea.setAttribute('data-placeholder', '开始输入，或邀请他人加入本房间一起编辑...');
  textarea.spellcheck = false;
  textarea.style.width = '100%';
  textarea.style.minHeight = '60vh';
  textarea.style.background = 'transparent';
  textarea.style.color = 'inherit';
  textarea.style.border = 'none';
  textarea.style.outline = 'none';
  textarea.style.resize = 'none';
  textarea.style.padding = '0';
  textarea.style.font = 'inherit';
  textarea.style.lineHeight = '1.7';
  textarea.style.whiteSpace = 'pre-wrap';
  textarea.style.tabSize = '2';

  const cursorLayer = document.createElement('div');
  cursorLayer.className = 'cursor-layer';
  cursorLayer.style.position = 'absolute';
  cursorLayer.style.top = '0';
  cursorLayer.style.left = '0';
  cursorLayer.style.right = '0';
  cursorLayer.style.bottom = '0';
  cursorLayer.style.pointerEvents = 'none';
  cursorLayer.style.overflow = 'hidden';

  wrapper.appendChild(textarea);
  wrapper.appendChild(cursorLayer);
  container.appendChild(wrapper);

  let applyingRemote = false;
  let needsRender = false;
  let renderScheduled = false;

  textarea.value = crdt.getText();

  function scheduleRender() {
    needsRender = true;
    if (!renderScheduled) {
      renderScheduled = true;
      requestAnimationFrame(() => {
        renderScheduled = false;
        if (needsRender) renderFromCrdt();
      });
    }
  }

  function renderFromCrdt() {
    needsRender = false;
    const next = crdt.getText();
    if (next === textarea.value) return;

    const relStart = crdt.createRelativePosition(textarea.selectionStart);
    const relEnd = crdt.createRelativePosition(textarea.selectionEnd);

    applyingRemote = true;
    textarea.value = next;

    const newStart = crdt.fromRelativePosition(relStart);
    const newEnd = crdt.fromRelativePosition(relEnd);
    try { textarea.setSelectionRange(newStart, newEnd); } catch {}
    applyingRemote = false;

    updateCursorLayer();
  }

  crdt.onRemoteUpdate = () => {
    scheduleRender();
  };

  crdt.awareness.on('change', () => {
    updateCursorLayer();
  });

  textarea.addEventListener('input', () => {
    if (applyingRemote) return;
    const prev = crdt.getText();
    const next = textarea.value;
    const { commonPrefix, commonSuffix } = commonPrefixSuffix(prev, next);
    const delLen = prev.length - commonPrefix - commonSuffix;
    if (delLen > 0) crdt.delete(commonPrefix, delLen);
    const insertText = next.slice(commonPrefix, next.length - commonSuffix);
    if (insertText.length > 0) crdt.insert(commonPrefix, insertText);
    broadcastMyCursor();
  });

  textarea.addEventListener('keyup', broadcastMyCursor);
  textarea.addEventListener('click', broadcastMyCursor);
  textarea.addEventListener('focus', broadcastMyCursor);
  textarea.addEventListener('blur', broadcastMyCursor);
  textarea.addEventListener('select', broadcastMyCursor);

  function broadcastMyCursor() {
    if (document.activeElement !== textarea) {
      crdt.setLocalAwareness({ cursor: null, name: myName, color: myColor });
      return;
    }
    const relStart = crdt.createRelativePosition(textarea.selectionStart);
    const relEnd = crdt.createRelativePosition(textarea.selectionEnd);
    crdt.setLocalAwareness({
      cursor: {
        relStart: relStart,
        relEnd: relEnd,
      },
      name: myName,
      color: myColor,
    });
    const enc = crdt.awareness.encodeUpdate();
    const msg = JSON.stringify({ t: 'awareness', u: Array.from(enc) });
    mesh.broadcast(msg, { reliable: false });
  }

  function updateCursorLayer() {
    cursorLayer.innerHTML = '';
    const text = crdt.getText();
    const states = crdt.awareness.getStates();
    for (const [clientId, state] of states.entries()) {
      if (!state || !state.cursor) continue;
      if (clientId === crdt.awareness.clientID) continue;
      const color = state.color || '#6ea8fe';
      const name = state.name || ('u' + clientId.toString(36).slice(-4));

      let index = 0;
      if (state.cursor.relStart) {
        index = crdt.fromRelativePosition(state.cursor.relStart);
      } else if (typeof state.cursor.index === 'number') {
        index = state.cursor.index;
      }
      index = Math.min(Math.max(index, 0), text.length);

      const pos = measureCharPosition(textarea, index, text);
      const cursor = document.createElement('div');
      cursor.className = 'remote-cursor';
      cursor.style.setProperty('--c', color);
      cursor.style.left = '0px';
      cursor.style.top = '0px';
      cursor.style.transform = `translate(${pos.left}px, ${pos.top}px)`;
      cursor.style.height = `${pos.height}px`;
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = name;
      cursor.appendChild(label);
      cursorLayer.appendChild(cursor);
    }
  }

  function destroy() {
    container.removeChild(wrapper);
  }

  window.addEventListener('resize', updateCursorLayer);

  return {
    el: textarea,
    refresh: updateCursorLayer,
    focus: () => textarea.focus(),
    destroy,
  };
}

function commonPrefixSuffix(a, b) {
  let i = 0;
  const maxPrefix = Math.min(a.length, b.length);
  while (i < maxPrefix && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  let j = 0;
  const maxSuffix = Math.min(a.length, b.length) - i;
  while (j < maxSuffix && a.charCodeAt(a.length - 1 - j) === b.charCodeAt(b.length - 1 - j)) j++;
  return { commonPrefix: i, commonSuffix: j };
}

function measureCharPosition(textarea, index, text) {
  const mirror = document.createElement('div');
  const style = window.getComputedStyle(textarea);
  const props = [
    'boxSizing', 'width', 'height',
    'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderStyle',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch',
    'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily',
    'textAlign', 'textTransform', 'textIndent', 'textDecoration',
    'letterSpacing', 'wordSpacing', 'tabSize',
    'whiteSpace', 'wordBreak', 'overflowWrap',
  ];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  for (const p of props) {
    try { mirror.style[p] = style[p]; } catch {}
  }
  const rect = textarea.getBoundingClientRect();
  mirror.style.width = rect.width + 'px';

  const prefix = text.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.appendChild(document.createTextNode(prefix));
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  document.body.removeChild(mirror);

  const lineH = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
  return {
    left: markerRect.left - mirrorRect.left,
    top: markerRect.top - mirrorRect.top,
    height: lineH,
  };
}
