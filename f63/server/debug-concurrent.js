import { createInsert, createDelete, applyOperation, transform } from './ot.js'

console.log('=== 复现用户描述的bug场景 ===\n')

console.log('场景：空文档')
console.log('用户A在开头插入"Hello"')
console.log('用户B在结尾插入"World"')
console.log('空文档的开头和结尾都是位置0\n')

const doc = ''

const opA = { type: 'insert', position: 0, text: 'Hello', userId: 'userA', timestamp: 1000 }
const opB = { type: 'insert', position: 0, text: 'World', userId: 'userB', timestamp: 2000 }

console.log('opA:', JSON.stringify(opA))
console.log('opB:', JSON.stringify(opB))
console.log('')

console.log('=== 分析transformInsertInsert函数 ===')
console.log('op1.position < op2.position?', opA.position < opB.position)
console.log('op1.position === op2.position?', opA.position === opB.position)
console.log('op1.timestamp < op2.timestamp?', opA.timestamp < opB.timestamp)
console.log('')

const [opAprime, opBprime] = transform(opA, opB)
console.log('transform(opA, opB) 返回:')
console.log('  opAprime:', JSON.stringify(opAprime))
console.log('  opBprime:', JSON.stringify(opBprime))
console.log('')

const result1 = applyOperation(applyOperation(doc, opA), opBprime)
const result2 = applyOperation(applyOperation(doc, opB), opAprime)
console.log('apply(apply(doc, opA), opBprime):', `"${result1}"`)
console.log('apply(apply(doc, opB), opAprime):', `"${result2}"`)
console.log('一致:', result1 === result2)
console.log('')

console.log('=== 检查客户端的OT转换 ===')
console.log('客户端B本地应用opB后，收到opA')
console.log('需要transform(opB, opA):')
const [opBprime2, opAprime2] = transform(opB, opA)
console.log('  opBprime2:', JSON.stringify(opBprime2))
console.log('  opAprime2:', JSON.stringify(opAprime2))
const resultB = applyOperation(applyOperation(doc, opB), opAprime2)
console.log('客户端B最终:', `"${resultB}"`)
console.log('')

console.log('=== 检查时间戳比较 ===')
console.log('opA.timestamp:', opA.timestamp)
console.log('opB.timestamp:', opB.timestamp)
console.log('opA.timestamp < opB.timestamp:', opA.timestamp < opB.timestamp)
console.log('')

console.log('=== 期望的正确行为 ===')
console.log('当两个插入在同一位置时，时间戳较早的应该在前')
console.log('opA时间戳较早(1000 < 2000)，所以结果应该是 "HelloWorld"')
console.log('但实际结果是:', `"${result1}"`)
console.log('')

if (result1 === 'WorldHello') {
  console.log('❌ BUG确认：时间戳判断逻辑反了！')
  console.log('op1.timestamp < op2.timestamp 应该让op1在前，但实际上op2在前了')
}
