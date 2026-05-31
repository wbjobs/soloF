import { keymap } from 'prosemirror-keymap'
import { history, undo, redo } from 'prosemirror-history'
import { baseKeymap } from 'prosemirror-commands'
import { inputRules, wrappingInputRule, textblockTypeInputRule, smartQuotes, emDash, ellipsis } from 'prosemirror-inputrules'
import { legalSchema } from './schema'
import { wrappingInputRule as listWrappingInputRule, textblockTypeInputRule as listTextblockInputRule } from 'prosemirror-schema-list'

function blockQuoteRule(nodeType) {
  return wrappingInputRule(/^\s*>\s$/, nodeType)
}

function orderedListRule(nodeType) {
  return wrappingInputRule(/^(\d+)\.\s$/, nodeType, match => ({ order: +match[1] }),
    (match, node) => node.childCount + node.attrs.order === +match[1])
}

function bulletListRule(nodeType) {
  return wrappingInputRule(/^\s*([-+*])\s$/, nodeType)
}

function codeBlockRule(nodeType) {
  return textblockTypeInputRule(/^```$/, nodeType)
}

function headingRule(nodeType, maxLevel) {
  return textblockTypeInputRule(new RegExp('^(#{1,' + maxLevel + '})\\s$'),
    nodeType, match => ({ level: match[1].length }))
}

const br = { tag: 'br' }
const em = { tag: 'em' }
const strong = { tag: 'strong' }

const emInputRule = {
  mark: legalSchema.marks.em,
  regex: /(?:^|\s)((?:\*)((?:[^*]+))(?:\*))$/,
  handler: (state, match, start, end) => {
    const mark = legalSchema.marks.em.create()
    const tr = state.tr
    const textStart = start + match[0].indexOf(match[2])
    const textEnd = textStart + match[2].length
    tr.delete(start, end)
    tr.insertText(match[2], start)
    tr.addMark(start, start + match[2].length, mark)
    return tr
  }
}

const strongInputRule = {
  mark: legalSchema.marks.strong,
  regex: /(?:^|\s)((?:\*\*)((?:[^*]+))(?:\*\*))$/,
  handler: (state, match, start, end) => {
    const mark = legalSchema.marks.strong.create()
    const tr = state.tr
    const textStart = start + match[0].indexOf(match[2])
    const textEnd = textStart + match[2].length
    tr.delete(start, end)
    tr.insertText(match[2], start)
    tr.addMark(start, start + match[2].length, mark)
    return tr
  }
}

export function buildInputRules(schema) {
  const rules = smartQuotes.concat(ellipsis, emDash)
  
  rules.push(blockQuoteRule(schema.nodes.blockquote))
  rules.push(orderedListRule(schema.nodes.ordered_list))
  rules.push(bulletListRule(schema.nodes.bullet_list))
  rules.push(codeBlockRule(schema.nodes.code_block))
  rules.push(headingRule(schema.nodes.heading, 6))
  
  return inputRules({ rules })
}

export function buildKeymap(schema) {
  const keys = {
    'Mod-z': undo,
    'Mod-y': redo,
    'Shift-Mod-z': redo
  }
  
  keys['Mod-b'] = (state, dispatch) => {
    const { $from, $to } = state.selection
    const mark = state.schema.marks.strong
    if (state.selection.empty) return false
    if (dispatch) {
      dispatch(state.tr.addMark($from.pos, $to.pos, mark.create()).scrollIntoView())
    }
    return true
  }
  
  keys['Mod-i'] = (state, dispatch) => {
    const { $from, $to } = state.selection
    const mark = state.schema.marks.em
    if (state.selection.empty) return false
    if (dispatch) {
      dispatch(state.tr.addMark($from.pos, $to.pos, mark.create()).scrollIntoView())
    }
    return true
  }
  
  Object.assign(keys, baseKeymap)
  return keymap(keys)
}

export { history }