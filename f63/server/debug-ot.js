import { createInsert, createDelete, applyOperation, transform } from './ot.js'

const doc = 'Hello World'

const insertOp = createInsert(5, ' Beautiful', 'user1')
const deleteOp = createDelete(0, 5, 'user2')

console.log('原始文档:', doc)
console.log('insertOp:', JSON.stringify(insertOp))
console.log('deleteOp:', JSON.stringify(deleteOp))

const [insertAfter, deleteAfter] = transform(insertOp, deleteOp)

console.log('\n转换后:')
console.log('insertAfter:', JSON.stringify(insertAfter))
console.log('deleteAfter:', JSON.stringify(deleteAfter))

const result1 = applyOperation(applyOperation(doc, insertAfter), deleteAfter)
const result2 = applyOperation(applyOperation(doc, deleteAfter), insertAfter)

console.log('\n结果:')
console.log('先insert后delete:', result1)
console.log('先delete后insert:', result2)
console.log('是否一致:', result1 === result2)
