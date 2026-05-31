import { createInsert, createDelete, applyOperation, transform } from './ot.js'

console.log('=== 测试场景 ===')
console.log('原始文档: "Hello World"')
console.log('User1: insert " Beautiful" at position 5')
console.log('User2: delete 5 chars at position 0')
console.log('')

console.log('=== 如果按顺序执行（无并发） ===')
const doc = 'Hello World'
const insertOp = createInsert(5, ' Beautiful', 'user1', 1000)
const deleteOp = createDelete(0, 5, 'user2', 2000)

console.log('1. User1先插入:')
const afterInsert = applyOperation(doc, insertOp)
console.log(`   "${afterInsert}"`)
console.log('2. 然后User2删除:')
const final1 = applyOperation(afterInsert, deleteOp)
console.log(`   "${final1}"`)
console.log('')

console.log('=== 如果User2先执行 ===')
console.log('1. User2先删除:')
const afterDelete = applyOperation(doc, deleteOp)
console.log(`   "${afterDelete}"`)
console.log('2. 然后User1插入（需要调整位置）:')
const adjustedInsert = { ...insertOp, position: insertOp.position - 5 }
const final2 = applyOperation(afterDelete, adjustedInsert)
console.log(`   "${final2}"`)
console.log('')

console.log('=== 我们期望OT转换后的结果 ===')
console.log('无论执行顺序，最终结果应该一致')
console.log('期望结果: " Beautiful World"')
console.log('')

console.log('=== 当前OT转换结果 ===')
const [insertAfter, deleteAfter] = transform(insertOp, deleteOp)
console.log('insertAfter:', JSON.stringify(insertAfter))
console.log('deleteAfter:', JSON.stringify(deleteAfter))
console.log('')

const result1 = applyOperation(applyOperation(doc, insertAfter), deleteAfter)
const result2 = applyOperation(applyOperation(doc, deleteAfter), insertAfter)
console.log('先insertAfter后deleteAfter:', `"${result1}"`)
console.log('先deleteAfter后insertAfter:', `"${result2}"`)
console.log('一致:', result1 === result2)
