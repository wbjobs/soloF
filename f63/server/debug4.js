import { createInsert, createDelete, applyOperation, transform } from './ot.js'

const doc = 'ABCDE'
const op1 = createInsert(2, 'X', 'user1', 1000)
const op2 = createDelete(1, 3, 'user2', 2000)

console.log('文档:', doc)
console.log('op1 (insert):', JSON.stringify(op1))
console.log('op2 (delete):', JSON.stringify(op2))
console.log('')

const [op1Prime, op2Prime] = transform(op1, op2)
console.log('op1\':', JSON.stringify(op1Prime))
console.log('op2\':', JSON.stringify(op2Prime))
console.log('')

const left1 = applyOperation(doc, op1)
console.log('apply(doc, op1):', `"${left1}"`)
const left2 = applyOperation(left1, op2Prime)
console.log('apply(..., op2\'):', `"${left2}"`)
console.log('')

const right1 = applyOperation(doc, op2)
console.log('apply(doc, op2):', `"${right1}"`)
const right2 = applyOperation(right1, op1Prime)
console.log('apply(..., op1\'):', `"${right2}"`)
console.log('')

console.log('一致:', left2 === right2)
