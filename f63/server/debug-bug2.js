import { createInsert, createDelete, applyOperation, transform } from './ot.js'

console.log('=== 分析transform函数的语义 ===')
console.log('transform(op1, op2) 返回 [op1\', op2\']')
console.log('语义: apply(apply(doc, op1), op2\') == apply(apply(doc, op2), op1\')')
console.log('')

const doc = ''
const opA = createInsert(0, 'Hello', 'userA', 1000)
const opB = createInsert(0, 'World', 'userB', 2000)

console.log('opA:', JSON.stringify(opA))
console.log('opB:', JSON.stringify(opB))
console.log('')

const [opAprime, opBprime] = transform(opA, opB)
console.log('transform(opA, opB) 返回:')
console.log('  opA\' (第一个返回值, op1\'):', JSON.stringify(opAprime))
console.log('  opB\' (第二个返回值, op2\'):', JSON.stringify(opBprime))
console.log('')

const result1 = applyOperation(applyOperation(doc, opA), opBprime)
const result2 = applyOperation(applyOperation(doc, opB), opAprime)
console.log('apply(apply(doc, opA), opB\'):', `"${result1}"`)
console.log('apply(apply(doc, opB), opA\'):', `"${result2}"`)
console.log('一致:', result1 === result2)
console.log('')

console.log('=== 正确的服务器端流程 ===')
console.log('服务器先收到opA，应用后文档:', applyOperation(doc, opA))
console.log('然后收到opB，需要计算transform(opA, opB)得到opB\'')
console.log('opB\'是转换后的B操作，应该应用到服务器文档')
console.log('服务器最终文档:', applyOperation(applyOperation(doc, opA), opBprime))
console.log('')

console.log('=== 正确的客户端B流程 ===')
console.log('B先应用opB，文档:', applyOperation(doc, opB))
console.log('然后收到opA，需要计算transform(opB, opA)得到opA\'')
const [opBprime2, opAprime2] = transform(opB, opA)
console.log('transform(opB, opA) 返回的opA\':', JSON.stringify(opAprime2))
console.log('B应用转换后的opA:', applyOperation(applyOperation(doc, opB), opAprime2))
console.log('')

console.log('=== 验证两边是否一致 ===')
const serverDoc = applyOperation(applyOperation(doc, opA), opBprime)
const clientBDoc = applyOperation(applyOperation(doc, opB), opAprime2)
console.log('服务器文档:', `"${serverDoc}"`)
console.log('客户端B文档:', `"${clientBDoc}"`)
console.log('一致:', serverDoc === clientBDoc)
