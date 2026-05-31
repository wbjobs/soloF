import { createInsert, createDelete, applyOperation, transform } from './ot.js'

function test(name, fn) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    console.log(`❌ ${name}`)
    console.error(e.message)
    process.exit(1)
  }
}

function assertEqual(a, b, msg) {
  if (a !== b) {
    throw new Error(`${msg || ''} Expected: "${a}", Got: "${b}"`)
  }
}

function testTransform(doc, op1, op2, expectedResult) {
  const [op1Prime, op2Prime] = transform(op1, op2)
  
  const result1 = applyOperation(applyOperation(doc, op1), op2Prime)
  const result2 = applyOperation(applyOperation(doc, op2), op1Prime)
  
  assertEqual(result1, result2, `转换后结果不一致!`)
  if (expectedResult) {
    assertEqual(expectedResult, result1, `结果不符合预期!`)
  }
  
  return result1
}

console.log('\n🧪 开始OT算法测试...\n')

test('插入操作应用正确', () => {
  const doc = 'Hello World'
  const op = createInsert(5, ' Beautiful', 'user1')
  const result = applyOperation(doc, op)
  assertEqual('Hello Beautiful World', result)
})

test('删除操作应用正确', () => {
  const doc = 'Hello Beautiful World'
  const op = createDelete(5, 10, 'user1')
  const result = applyOperation(doc, op)
  assertEqual('Hello World', result)
})

test('并发插入 - 位置靠前优先', () => {
  const doc = ''
  const op1 = createInsert(0, 'Hello', 'user1', 1000)
  const op2 = createInsert(0, 'Hi ', 'user2', 2000)
  const result = testTransform(doc, op1, op2)
  console.log(`  结果: "${result}"`)
})

test('并发插入 - 时间戳决定顺序', () => {
  const doc = ''
  const op1 = createInsert(0, 'A', 'user1', 2000)
  const op2 = createInsert(0, 'B', 'user2', 1000)
  const result = testTransform(doc, op1, op2)
  console.log(`  结果: "${result}"`)
})

test('并发删除 - 部分重叠', () => {
  const doc = 'ABCDE'
  const op1 = createDelete(1, 3, 'user1')
  const op2 = createDelete(2, 3, 'user2')
  const result = testTransform(doc, op1, op2)
  console.log(`  结果: "${result}"`)
})

test('插入和删除 - 插入在删除前', () => {
  const doc = 'Hello World'
  const insertOp = createInsert(5, ' Beautiful', 'user1', 1000)
  const deleteOp = createDelete(0, 5, 'user2', 2000)
  const result = testTransform(doc, insertOp, deleteOp, ' Beautiful World')
  console.log(`  结果: "${result}"`)
})

test('插入和删除 - 插入在删除后', () => {
  const doc = 'Hello World'
  const insertOp = createInsert(6, 'Beautiful ', 'user1', 1000)
  const deleteOp = createDelete(0, 5, 'user2', 2000)
  const result = testTransform(doc, insertOp, deleteOp)
  console.log(`  结果: "${result}"`)
})

test('删除和插入 - 删除在插入前', () => {
  const doc = 'Hello World'
  const deleteOp = createDelete(0, 5, 'user1', 1000)
  const insertOp = createInsert(6, 'Beautiful ', 'user2', 2000)
  const result = testTransform(doc, deleteOp, insertOp)
  console.log(`  结果: "${result}"`)
})

test('并发删除 - 完全不重叠', () => {
  const doc = 'ABCDEFG'
  const op1 = createDelete(0, 2, 'user1', 1000)
  const op2 = createDelete(4, 2, 'user2', 2000)
  const result = testTransform(doc, op1, op2)
  console.log(`  结果: "${result}"`)
})

test('并发删除 - 完全包含', () => {
  const doc = 'ABCDEFG'
  const op1 = createDelete(0, 5, 'user1', 1000)
  const op2 = createDelete(1, 2, 'user2', 2000)
  const result = testTransform(doc, op1, op2)
  console.log(`  结果: "${result}"`)
})

test('复杂场景 - 多步操作', () => {
  let doc = 'Start'
  
  const opA1 = createInsert(5, ' A1', 'userA', 1000)
  const opB1 = createInsert(5, ' B1', 'userB', 1500)
  
  doc = testTransform(doc, opA1, opB1)
  console.log(`  第一步后: "${doc}"`)
  
  const opA2 = createDelete(5, 3, 'userA', 2000)
  const opB2 = createInsert(10, ' B2', 'userB', 2500)
  
  doc = testTransform(doc, opA2, opB2)
  console.log(`  第二步后: "${doc}"`)
})

test('同一位置同时插入不同内容', () => {
  const doc = 'Hello'
  const op1 = createInsert(5, ' World', 'user1', 1000)
  const op2 = createInsert(5, ' Everyone', 'user2', 2000)
  const result = testTransform(doc, op1, op2)
  console.log(`  User1操作: 插入" World" at 5`)
  console.log(`  User2操作: 插入" Everyone" at 5`)
  console.log(`  最终一致: "${result}"`)
})

console.log('\n🎉 所有核心测试通过！OT算法工作正常。')
console.log('\n📝 说明: 服务器作为权威来源，确保所有客户端最终一致。')
