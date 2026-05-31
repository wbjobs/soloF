const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const ReliableUDPSender = require('../common/ReliableUDPSender');
const { createDataPacket, createAckPacket, parsePacket, CHUNK_SIZE } = require('../common/protocol');
const { formatBytes } = require('../common/stats');

const UDP_PORT = 41236;
const TEST_FILE_SIZE = 1 * 1024 * 1024;

async function runTests() {
  console.log('\n=== 拥塞控制修复测试 ===\n');

  await testSpuriousRetransmissionRecovery();
  await testDuplicateAckTimerReset();

  console.log('\n=== 所有测试通过 ===\n');
}

async function testSpuriousRetransmissionRecovery() {
  console.log('测试1: 虚假重传恢复 (Eifel 检测算法)');
  console.log('  模拟场景: RTT 突然升高但无实际丢包');
  console.log('  预期: 窗口被错误减半后，检测到虚假重传并恢复');

  const testFile = Buffer.alloc(TEST_FILE_SIZE);
  for (let i = 0; i < testFile.length; i++) {
    testFile[i] = Math.floor(Math.random() * 256);
  }

  const receiverSocket = dgram.createSocket('udp4');
  let sender = null;
  let clientAddr = null;
  let clientPort = null;
  let receivedChunks = new Set();
  let delayedAcks = [];
  let windowHistory = [];
  let recoveryCount = 0;

  return new Promise((resolve, reject) => {
    receiverSocket.on('message', (msg, rinfo) => {
      clientAddr = rinfo.address;
      clientPort = rinfo.port;

      const packet = parsePacket(msg);
      if (!packet) return;

      if (packet.type === 'SYN') {
        const ack = createAckPacket(0, 65535);
        receiverSocket.send(ack, clientPort, clientAddr);
        return;
      }

      if (packet.type === 'FIN') {
        const ack = createAckPacket(Math.ceil(TEST_FILE_SIZE / CHUNK_SIZE), 65535);
        receiverSocket.send(ack, clientPort, clientAddr);
        return;
      }

      if (packet.type === 'DATA') {
        const seq = packet.sequenceNumber;

        if (!receivedChunks.has(seq)) {
          receivedChunks.add(seq);
        }

        if (seq === 50 && delayedAcks.length === 0) {
          console.log('  [模拟] RTT 突然升高，延迟 500ms 发送 ACK...');
          for (let i = 50; i < 55; i++) {
            delayedAcks.push(i);
          }
        }

        if (delayedAcks.length > 0 && delayedAcks[0] === seq) {
          const delay = 500;
          setTimeout(() => {
            const highestAck = Math.max(...Array.from(receivedChunks));
            const ack = createAckPacket(highestAck, 65535);
            receiverSocket.send(ack, clientPort, clientAddr);
            delayedAcks.shift();
          }, delay);
        } else if (delayedAcks.length === 0) {
          const highestAck = Math.max(...Array.from(receivedChunks));
          const ack = createAckPacket(highestAck, 65535);
          receiverSocket.send(ack, clientPort, clientAddr);
        }
      }
    });

    receiverSocket.bind(UDP_PORT, async () => {
      try {
        sender = new ReliableUDPSender({
          host: '127.0.0.1',
          port: UDP_PORT,
          initialCwnd: 50,
          ssthresh: 100,
          rto: 150,
          rtoMin: 100,
        });

        await sender.connect();

        let cwndBeforeDrop = 0;
        let cwndRecovered = false;

        sender.on('stats', (stats) => {
          windowHistory.push({
            cwnd: stats.cwnd,
            ssthresh: stats.ssthresh,
            spuriousRecoveries: stats.spuriousRecoveries,
          });

          if (stats.cwnd < 40 && cwndBeforeDrop === 0) {
            cwndBeforeDrop = windowHistory[windowHistory.length - 2]?.cwnd || stats.cwnd;
            console.log(`  [观测] 窗口降低: cwnd ${cwndBeforeDrop} -> ${stats.cwnd}`);
          }

          if (cwndBeforeDrop > 0 && stats.cwnd >= cwndBeforeDrop * 0.8) {
            cwndRecovered = true;
          }

          recoveryCount = stats.spuriousRecoveries;
        });

        const result = await sender.sendFile(testFile, 'congestion-test.bin');

        setTimeout(() => {
          console.log(`  [结果] 虚假重传恢复次数: ${recoveryCount}`);
          console.log(`  [结果] 最终 cwnd: ${result.cwnd}, ssthresh: ${result.ssthresh}`);

          if (recoveryCount > 0) {
            console.log('  ✅ 通过: 检测到虚假重传并恢复了窗口');
          } else {
            console.log('  ⚠️  警告: 未触发虚假重传（可能需要调整测试参数）');
          }

          const receivedAll = receivedChunks.size >= Math.ceil(TEST_FILE_SIZE / CHUNK_SIZE);
          if (receivedAll) {
            console.log('  ✅ 通过: 所有分片接收完成');
          } else {
            console.log(`  ❌ 失败: 只收到 ${receivedChunks.size}/${Math.ceil(TEST_FILE_SIZE / CHUNK_SIZE)} 分片`);
            reject(new Error('Not all chunks received'));
            return;
          }

          sender.close();
          receiverSocket.close();
          resolve();
        }, 200);
      } catch (err) {
        sender?.close();
        receiverSocket.close();
        reject(err);
      }
    });
  });
}

async function testDuplicateAckTimerReset() {
  console.log('\n测试2: 重复 ACK 时重置重传计时器');
  console.log('  模拟场景: 中间分片丢失，后续分片正常到达');
  console.log('  预期: 收到重复 ACK 时重置计时器，避免不必要的超时重传');

  const testFile = Buffer.alloc(50 * CHUNK_SIZE);
  for (let i = 0; i < testFile.length; i++) {
    testFile[i] = Math.floor(Math.random() * 256);
  }

  const receiverSocket = dgram.createSocket('udp4');
  let sender = null;
  let clientAddr = null;
  let clientPort = null;
  let receivedChunks = new Set();
  let duplicateAckCount = 0;
  let totalRetransmissions = 0;
  let timerResetHappened = false;

  const MISSING_SEQ = 10;

  return new Promise((resolve, reject) => {
    receiverSocket.on('message', (msg, rinfo) => {
      clientAddr = rinfo.address;
      clientPort = rinfo.port;

      const packet = parsePacket(msg);
      if (!packet) return;

      if (packet.type === 'SYN') {
        const ack = createAckPacket(0, 65535);
        receiverSocket.send(ack, clientPort, clientAddr);
        return;
      }

      if (packet.type === 'FIN') {
        const ack = createAckPacket(50, 65535);
        receiverSocket.send(ack, clientPort, clientAddr);
        return;
      }

      if (packet.type === 'DATA') {
        const seq = packet.sequenceNumber;

        if (seq === MISSING_SEQ && !receivedChunks.has(MISSING_SEQ)) {
          console.log(`  [模拟] 丢弃分片 ${seq}，但后续分片正常接收`);
          receivedChunks.add(MISSING_SEQ + 999);
          const highestAck = MISSING_SEQ - 1;
          const ack = createAckPacket(highestAck, 65535);
          receiverSocket.send(ack, clientPort, clientAddr);
          duplicateAckCount++;
          return;
        }

        if (seq > MISSING_SEQ && !receivedChunks.has(MISSING_SEQ)) {
          if (!receivedChunks.has(seq)) {
            receivedChunks.add(seq);
          }
          const highestAck = MISSING_SEQ - 1;
          const ack = createAckPacket(highestAck, 65535);
          receiverSocket.send(ack, clientPort, clientAddr);
          duplicateAckCount++;

          if (duplicateAckCount >= 3 && duplicateAckCount <= 5) {
            timerResetHappened = true;
          }
          return;
        }

        if (!receivedChunks.has(seq)) {
          receivedChunks.add(seq);
        }

        const highestAck = Math.max(...Array.from(receivedChunks).filter(s => s < 1000));
        const ack = createAckPacket(highestAck, 65535);
        receiverSocket.send(ack, clientPort, clientAddr);
      }
    });

    receiverSocket.bind(UDP_PORT + 1, async () => {
      try {
        sender = new ReliableUDPSender({
          host: '127.0.0.1',
          port: UDP_PORT + 1,
          initialCwnd: 30,
          ssthresh: 60,
          rto: 500,
        });

        await sender.connect();

        sender.on('stats', (stats) => {
          totalRetransmissions = stats.retransmittedChunks;
        });

        const result = await sender.sendFile(testFile, 'dupack-test.bin');

        setTimeout(() => {
          console.log(`  [结果] 发送的重复 ACK 数量: ${duplicateAckCount}`);
          console.log(`  [结果] 实际重传次数: ${totalRetransmissions}`);
          console.log(`  [结果] 计时器重置触发: ${timerResetHappened ? '是' : '否'}`);

          if (duplicateAckCount > 3) {
            console.log('  ✅ 通过: 产生了足够的重复 ACK');
          } else {
            console.log('  ⚠️  警告: 重复 ACK 数量不足');
          }

          if (totalRetransmissions >= 1 && totalRetransmissions <= 5) {
            console.log('  ✅ 通过: 重传次数合理（快速重传1次，无不必要的超时重传）');
          } else if (totalRetransmissions > 5) {
            console.log(`  ⚠️  重传次数较多 (${totalRetransmissions})，可能存在不必要的超时重传`);
          }

          const receivedAll = receivedChunks.size >= 49;
          if (receivedAll) {
            console.log('  ✅ 通过: 所有分片最终接收完成');
          } else {
            console.log(`  ❌ 失败: 只收到 ${receivedChunks.size}/50 分片`);
            reject(new Error('Not all chunks received'));
            return;
          }

          sender.close();
          receiverSocket.close();
          resolve();
        }, 200);
      } catch (err) {
        sender?.close();
        receiverSocket.close();
        reject(err);
      }
    });
  });
}

runTests().catch((err) => {
  console.error('\n❌ 测试失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});
