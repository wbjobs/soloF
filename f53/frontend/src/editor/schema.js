import { Schema } from 'prosemirror-model'
import { schema } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'

export const legalSchema = new Schema({
  nodes: addListNodes(schema.spec.nodes, 'paragraph block*', 'block').append({
    clause: {
      content: 'inline*',
      group: 'block',
      attrs: {
        clauseId: { default: null },
        title: { default: '' }
      },
      parseDOM: [
        {
          tag: 'div.clause',
          getAttrs(dom) {
            return {
              clauseId: dom.getAttribute('data-clause-id'),
              title: dom.getAttribute('data-title')
            }
          }
        }
      ],
      toDOM(node) {
        return [
          'div',
          {
            class: 'clause',
            'data-clause-id': node.attrs.clauseId,
            'data-title': node.attrs.title
          },
          node.attrs.title ? ['div', { class: 'clause-title' }, node.attrs.title] : [],
          0
        ]
      }
    },
    definition: {
      content: 'inline*',
      group: 'block',
      parseDOM: [
        { tag: 'div.definition' }
      ],
      toDOM() {
        return ['div', { class: 'definition' }, 0]
      }
    },
    table: {
      content: 'table_row+',
      group: 'block',
      tableRole: 'table',
      isolating: true,
      parseDOM: [{ tag: 'table' }],
      toDOM() { return ['table', ['tbody', 0]] }
    },
    table_row: {
      content: 'table_cell+',
      tableRole: 'row',
      parseDOM: [{ tag: 'tr' }],
      toDOM() { return ['tr', 0] }
    },
    table_cell: {
      content: 'block+',
      tableRole: 'cell',
      isolating: true,
      parseDOM: [{ tag: 'td' }, { tag: 'th', getAttrs: () => ({ header: true }) }],
      toDOM(node) { return [node.attrs.header ? 'th' : 'td', 0] }
    }
  }),
  marks: schema.spec.marks.append({
    important: {
      parseDOM: [
        { tag: 'span.important' }
      ],
      toDOM() { return ['span', { class: 'important' }] }
    },
    comment: {
      attrs: {
        commentId: { default: null }
      },
      parseDOM: [
        {
          tag: 'span.comment-marker',
          getAttrs(dom) {
            return { commentId: dom.getAttribute('data-comment-id') }
          }
        }
      ],
      toDOM(node) {
        return ['span', {
          class: 'comment-marker',
          'data-comment-id': node.attrs.commentId
        }]
      }
    }
  })
})