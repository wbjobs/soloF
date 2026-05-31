export const OP_INSERT = 'insert'
export const OP_DELETE = 'delete'
export const OP_RETAIN = 'retain'

export function createInsert(position, text, userId, timestamp = null) {
  return { type: OP_INSERT, position, text, userId, timestamp: timestamp || Date.now() }
}

export function createDelete(position, length, userId, timestamp = null) {
  return { type: OP_DELETE, position, length, userId, timestamp: timestamp || Date.now() }
}

export function createRetain(length) {
  return { type: OP_RETAIN, length }
}

export function applyOperation(doc, op) {
  switch (op.type) {
    case OP_INSERT:
      return doc.slice(0, op.position) + op.text + doc.slice(op.position)
    case OP_DELETE:
      return doc.slice(0, op.position) + doc.slice(op.position + op.length)
    case OP_RETAIN:
      return doc
    default:
      return doc
  }
}

export function transform(op1, op2) {
  if (op1.type === OP_INSERT && op2.type === OP_INSERT) {
    return transformInsertInsert(op1, op2)
  }
  if (op1.type === OP_INSERT && op2.type === OP_DELETE) {
    return transformInsertDelete(op1, op2)
  }
  if (op1.type === OP_DELETE && op2.type === OP_INSERT) {
    return transformDeleteInsert(op1, op2)
  }
  if (op1.type === OP_DELETE && op2.type === OP_DELETE) {
    return transformDeleteDelete(op1, op2)
  }
  return [op1, op2]
}

function transformInsertInsert(op1, op2) {
  if (op1.position < op2.position || (op1.position === op2.position && op1.timestamp < op2.timestamp)) {
    return [
      op1,
      { ...op2, position: op2.position + op1.text.length }
    ]
  } else {
    return [
      { ...op1, position: op1.position + op2.text.length },
      op2
    ]
  }
}

function transformInsertDelete(op1, op2) {
  if (op1.position <= op2.position) {
    return [
      op1,
      { ...op2, position: op2.position + op1.text.length }
    ]
  } else if (op1.position >= op2.position + op2.length) {
    return [
      { ...op1, position: op1.position - op2.length },
      op2
    ]
  } else {
    return [
      { ...op1, position: op2.position },
      { ...op2, length: op1.position - op2.position }
    ]
  }
}

function transformDeleteInsert(op1, op2) {
  if (op1.position >= op2.position) {
    return [
      { ...op1, position: op1.position + op2.text.length },
      op2
    ]
  } else if (op1.position + op1.length <= op2.position) {
    return [
      op1,
      { ...op2, position: op2.position - op1.length }
    ]
  } else {
    return [
      { ...op1, length: op2.position - op1.position },
      { ...op2, position: op1.position }
    ]
  }
}

function transformDeleteDelete(op1, op2) {
  const op1End = op1.position + op1.length
  const op2End = op2.position + op2.length

  if (op1End <= op2.position) {
    return [
      op1,
      { ...op2, position: op2.position - op1.length }
    ]
  }
  if (op2End <= op1.position) {
    return [
      { ...op1, position: op1.position - op2.length },
      op2
    ]
  }

  if (op1.position <= op2.position && op1End >= op2End) {
    return [
      { ...op1, length: op1.length - op2.length },
      { ...op2, length: 0, position: op1.position }
    ]
  }

  if (op2.position <= op1.position && op2End >= op1End) {
    return [
      { ...op1, length: 0, position: op2.position },
      { ...op2, length: op2.length - op1.length }
    ]
  }

  if (op1.position < op2.position) {
    return [
      { ...op1, length: op2.position - op1.position },
      { ...op2, position: op1.position, length: op2End - op1End }
    ]
  }

  return [
    { ...op1, position: op2.position, length: op1End - op2End },
    { ...op2, length: op1.position - op2.position }
  ]
}

export function transformOperationAgainstHistory(op, history) {
  let transformedOp = { ...op }
  for (const historyOp of history) {
    const [, newOp] = transform(historyOp, transformedOp)
    transformedOp = newOp
    if (transformedOp.type === OP_DELETE && transformedOp.length <= 0) {
      return null
    }
  }
  return transformedOp
}
