import { createInsert, createDelete, applyOperation, transform } from './ot.js'

console.log('=== 测试场景：A在开头插入Hello，B在开头插入World ===')
console.log('注意：手动设置不同的时间戳')
console.log('')

const doc = ''
const opA = createInsert(0, 'Hello', 'userA', 1000)  // 时间戳1000，较早
const opB = createInsert(0, 'World', 'userB', 2000)  // 时间戳2000，较晚

console.log('opA (insert Hello at 0, ts=1000):', JSON.stringify(opA))
console.log('opB (insert World at 0, ts=2000):', JSON.stringify(opB))
console.log('')

console.log('=== 服务器视角 ===')
console.log('1. 先收到opA，应用后:', applyOperation(doc, opA))
console.log('2. 后收到opB，需要transform(opA, opB)')
const [opAprime1, opBprime1] = transform(opA, opB)
console.log('   op1\' (opA经opB转换后):', JSON.stringify(opAprime1))
console.log('   op2\' (opB经opA转换后):', JSON.stringify(opBprime1))
console.log('3. 应用opB\'到服务器文档:', applyOperation(applyOperation(doc, opA), opBprime1))
console.log('')

console.log('=== 客户端B视角 ===')
console.log('1. 本地先应用opB:', applyOperation(doc, opB))
console.log('2. 收到服务器广播的opA，需要transform(opB, opA)')
const [opBprime2, opAprime2] = transform(opB, opA)
console.log('   op1\' (opB经opA转换后):', JSON.stringify(opBprime2))
console.log('   op2\' (opA经opB转换后):', JSON.stringify(opAprime2))
console.log('3. 应用opA\'到本地文档:', applyOperation(applyOperation(doc, opB), opAprime2))
console.log('')

console.log('=== 结果对比 ===')
const serverResult = applyOperation(applyOperation(doc, opA), opBprime1)
const clientBResult = applyOperation(applyOperation(doc, opB), opAprime2)
console.log('服务器最终:', `"${serverResult}"`)
console.log('客户端B最终:', `"${clientBResult}"`)
console.log('一致:', serverResult === clientBResult)
console.log('')

console.log('=== 实际系统中的流程 ===')
console.log('在我们的架构中：')
console.log('1. 服务器是权威来源')
console.log('2. 客户端发送操作给服务器')
console.log('3. 服务器转换并应用，然后广播给所有客户端')
console.log('4. 客户端应用服务器广播的操作')
console.log('5. 因此所有客户端最终都会与服务器一致')
