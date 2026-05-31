const fs = require('fs');
const path = require('path');
const ReliableUDPSender = require('../common/ReliableUDPSender');
const ReliableUDPReceiver = require('../common/ReliableUDPReceiver');
const { formatBytes } = require('../common/stats');

const UDP_PORT = 41235;
const TEST_FILE_SIZE = 2 * 1024 * 1024;
const TEST_FILE_PATH = path.join(__dirname, 'test-file.bin');
const OUTPUT_DIR = path.join(__dirname, 'test-output');

async function createTestFile() {
  console.log(`Creating test file (${formatBytes(TEST_FILE_SIZE)})...`);
  const buffer = Buffer.alloc(TEST_FILE_SIZE);
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = Math.floor(Math.random() * 256);
  }
  fs.writeFileSync(TEST_FILE_PATH, buffer);
  console.log('Test file created:', TEST_FILE_PATH);
  return buffer;
}

async function runTest() {
  console.log('\n=== UDP Reliable File Transfer - Speed Test ===\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const originalBuffer = await createTestFile();

  console.log('\nStarting receiver...');
  const receiver = new ReliableUDPReceiver({
    port: UDP_PORT,
    outputDir: OUTPUT_DIR,
  });

  await receiver.start();

  receiver.on('start', (info) => {
    console.log(`Receiver: Started receiving ${info.fileName} (${formatBytes(info.fileSize)})`);
  });

  receiver.on('stats', (stats) => {
    process.stdout.write(
      `\rProgress: ${stats.progress.toFixed(1)}% | ` +
      `Throughput: ${stats.throughputStr} | ` +
      `Received: ${stats.receivedChunks}/${stats.totalChunks} | ` +
      `cwnd: ${stats.cwnd} | ssthresh: ${stats.ssthresh}`
    );
  });

  receiver.on('complete', (result) => {
    console.log('\n\n=== Receiver Complete ===');
    console.log(`File: ${result.fileName}`);
    console.log(`Size: ${formatBytes(result.fileSize)}`);
    console.log(`Time: ${(result.stats.elapsedMs / 1000).toFixed(2)}s`);
    console.log(`Throughput: ${result.stats.throughputStr}`);
    console.log(`Retransmitted: ${result.stats.retransmittedChunks} chunks (${result.stats.retransmissionRate.toFixed(2)}%)`);
    console.log(`Lost packets: ${result.stats.lostPackets} (${result.stats.lossRate.toFixed(2)}%)`);
    console.log(`Final cwnd: ${result.stats.cwnd}, ssthresh: ${result.stats.ssthresh}`);
    console.log(`RTT: ${result.stats.rtt.toFixed(0)}ms, RTO: ${result.stats.rto}ms`);
  });

  console.log('\nStarting sender...');
  const sender = new ReliableUDPSender({
    host: '127.0.0.1',
    port: UDP_PORT,
    initialCwnd: 20,
    ssthresh: 128,
    rto: 200,
  });

  await sender.connect();

  sender.on('start', (info) => {
    console.log(`Sender: Started sending ${info.fileName} (${formatBytes(info.fileSize)})`);
    console.log(`Total chunks: ${info.totalChunks}`);
    console.log('');
  });

  sender.on('stats', (stats) => {
  });

  const startTime = Date.now();
  const result = await sender.sendFile(originalBuffer, 'test-file.bin');

  console.log('\n=== Sender Complete ===');
  console.log(`Time: ${(result.elapsedMs / 1000).toFixed(2)}s`);
  console.log(`Throughput: ${result.throughputStr}`);
  console.log(`Sent: ${result.sentChunks} chunks`);
  console.log(`Acked: ${result.ackedChunks} chunks`);
  console.log(`Retransmitted: ${result.retransmittedChunks} chunks`);

  await new Promise(resolve => setTimeout(resolve, 500));

  const receivedPath = path.join(OUTPUT_DIR, 'test-file.bin');
  if (fs.existsSync(receivedPath)) {
    const receivedBuffer = fs.readFileSync(receivedPath);
    const isMatch = Buffer.compare(originalBuffer, receivedBuffer) === 0;
    console.log('\n=== Verification ===');
    console.log(`Original size: ${formatBytes(originalBuffer.length)}`);
    console.log(`Received size: ${formatBytes(receivedBuffer.length)}`);
    console.log(`Files match: ${isMatch ? '✅ YES' : '❌ NO'}`);

    if (!isMatch) {
      console.error('ERROR: File content mismatch!');
      process.exit(1);
    }
  } else {
    console.error('ERROR: Received file not found!');
    process.exit(1);
  }

  sender.close();
  receiver.close();

  if (fs.existsSync(TEST_FILE_PATH)) fs.unlinkSync(TEST_FILE_PATH);
  if (fs.existsSync(receivedPath)) fs.unlinkSync(receivedPath);
  if (fs.existsSync(OUTPUT_DIR)) fs.rmdirSync(OUTPUT_DIR, { recursive: true });

  console.log('\n=== Test Passed ===');
  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`Total test time: ${totalTime.toFixed(2)}s`);
  console.log(`Average throughput: ${formatBytes(TEST_FILE_SIZE / totalTime)}/s\n`);
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
