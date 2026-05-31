import { createInsert, createDelete, applyOperation, transform } from './ot.js'

const doc = 'Hello World'
const op1 = createInsert(5, ' Beautiful', 'user1', 1000)
const op2 = createDelete(0, 5, 'user2', 2000)

console.log('=== 正确的transform语义 ===')
console.log('transform(op1, op2) 返回 [op1\', op2\']')
console.log('使得: apply(apply(doc, op1), op2\') == apply(apply(doc, op2), op1\')')
console.log('')

const [op1Prime, op2Prime] = transform(op1, op2)
console.log('op1\':', JSON.stringify(op1Prime))
console.log('op2\':', JSON.stringify(op2Prime))
console.log('')

const left = applyOperation(applyOperation(doc, op1), op2Prime)
const right = applyOperation(applyOperation(doc, op2), op1Prime)

console.log('左边 apply(apply(doc, op1), op2\'):', `"${left}"`)
console.log('右边 apply(apply(doc, op2), op1\'):', `"${right}"`)
console.log('一致:', left === right)
console.log('')

if (left !== right) {
  console.log('❌ 转换有问题，需要修复！')
  console.log('')
  console.log('期望的op1\'应该是: insert at 0 (因为删除了前5个字符)')
  console.log('期望的op2\'应该是: delete at 0 length 5 (因为插入在删除边界之后)')
} else {
  console.log('✅ 转换正确！')
}
