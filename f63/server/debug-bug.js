import { createInsert, createDelete, applyOperation, transform } from './ot.js'

console.log('=== 场景1: 空文档，A在开头插入Hello，B在结尾插入World ===')
console.log('注意：空文档的开头和结尾都是位置0')
const doc1 = ''
const opA1 = createInsert(0, 'Hello', 'userA', 1000)
const opB1 = createInsert(0, 'World', 'userB', 2000)

console.log('opA (insert Hello at 0):', JSON.stringify(opA1))
console.log('opB (insert World at 0):', JSON.stringify(opB1))

const [opA1Prime, opB1Prime] = transform(opA1, opB1)
console.log('opA\':', JSON.stringify(opA1Prime))
console.log('opB\':', JSON.stringify(opB1Prime))

const resultA1 = applyOperation(applyOperation(doc1, opA1), opB1Prime)
const resultB1 = applyOperation(applyOperation(doc1, opB1), opA1Prime)
console.log('A看到的结果:', `"${resultA1}"`)
console.log('B看到的结果:', `"${resultB1}"`)
console.log('一致:', resultA1 === resultB1)
console.log('')

console.log('=== 场景2: 文档内容为"Test"，A在开头插入Hello，B在结尾插入World ===')
const doc2 = 'Test'
const opA2 = createInsert(0, 'Hello', 'userA', 1000)
const opB2 = createInsert(4, 'World', 'userB', 2000)

console.log('opA (insert Hello at 0):', JSON.stringify(opA2))
console.log('opB (insert World at 4):', JSON.stringify(opB2))

const [opA2Prime, opB2Prime] = transform(opA2, opB2)
console.log('opA\':', JSON.stringify(opA2Prime))
console.log('opB\':', JSON.stringify(opB2Prime))

const resultA2 = applyOperation(applyOperation(doc2, opA2), opB2Prime)
const resultB2 = applyOperation(applyOperation(doc2, opB2), opA2Prime)
console.log('A看到的结果:', `"${resultA2}"`)
console.log('B看到的结果:', `"${resultB2}"`)
console.log('一致:', resultA2 === resultB2)
console.log('')

console.log('=== 场景3: 可能出现错乱的场景 ===')
console.log('让我们模拟实际的网络延迟场景')
const doc3 = ''
console.log('初始文档: ""')
console.log('')
console.log('时间线:')
console.log('1. A本地插入Hello at 0 -> A本地文档: "Hello"')
console.log('2. B本地插入World at 0 -> B本地文档: "World"')
console.log('3. A的操作先到达服务器，版本变为1')
console.log('4. B的操作后到达，需要针对A的操作进行转换')
console.log('')

const opA = createInsert(0, 'Hello', 'userA', 1000)
const opB = createInsert(0, 'World', 'userB', 2000)

console.log('服务器收到A的操作，应用后文档:', applyOperation(doc3, opA))
console.log('')

console.log('服务器收到B的操作，需要先转换:')
const [opBPrimeForServer, opAPrimeForB] = transform(opA, opB)
console.log('转换后的B操作:', JSON.stringify(opBPrimeForServer))
console.log('')

console.log('服务器应用转换后的B操作:', applyOperation(applyOperation(doc3, opA), opBPrimeForServer))
console.log('')

console.log('B收到A的操作，需要转换:')
const [opBPrime, opAPrime] = transform(opB, opA)
console.log('转换后的A操作:', JSON.stringify(opAPrime))
console.log('B应用转换后的A操作:', applyOperation(applyOperation(doc3, opB), opAPrime))
