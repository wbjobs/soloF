const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
    PacketType,
    CHUNK_SIZE,
    serializeData,
    deserializeAck,
    serializeSyn,
    deserializeSynAck,
    serializeFin,
    deserializeFinAck,
} = require('../common/protocol');

const TransferStats = require('../common/stats');
const ReliableUDPSender = require('../common/ReliableUDPSender');
const { MultiPathScheduler, PathStats } = require('../common/PathManager');

const RECEIVER_HOST = '127.0.0.1';
const RECEIVER_PORTS = [41234, 41235];
const TEST_FILE_SIZE = 2 * 1024 * 1024;
const TEST_FILE_PATH = path.join(__dirname, 'test-multipath.bin');

function generateTestFile(filePath, size) {
    const buffer = crypto.randomBytes(size);
    fs.writeFileSync(filePath, buffer);
    console.log(`✅ 测试文件已生成: ${filePath} (${(size / 1024 / 1024).toFixed(2)} MB)`);
    return buffer;
}

async function runMultiPathTest() {
    console.log('\n========================================');
    console.log('  多路径 UDP 传输测试');
    console.log('========================================\n');

    const testData = generateTestFile(TEST_FILE_PATH, TEST_FILE_SIZE);
    const expectedHash = crypto.createHash('sha256').update(testData).digest('hex');

    const paths = [
        { id: 'wifi', name: 'WiFi 网络', host: RECEIVER_HOST, port: RECEIVER_PORTS[0], enabled: true, weight: 1, color: '#3498db' },
        { id: 'ethernet', name: '有线网络', host: RECEIVER_HOST, port: RECEIVER_PORTS[1], enabled: true, weight: 1, color: '#2ecc71' },
    ];

    const sender = new ReliableUDPSender({
        host: RECEIVER_HOST,
        port: RECEIVER_PORTS[0],
        multiPath: true,
        pathsConfig: paths,
        schedulingAlgorithm: 'dynamicWeighted',
    });

    console.log('📡 正在连接接收端...');

    try {
        await sender.connect();
        console.log('✅ 连接成功！\n');

        console.log('🌐 路径配置:');
        paths.forEach(p => {
            console.log(`   • ${p.id === 'wifi' ? '📶' : '🔌'} ${p.name} - ${p.host}:${p.port}`);
        });
        console.log();

        console.log(`📤 开始传输文件 (${(TEST_FILE_SIZE / 1024 / 1024).toFixed(2)} MB)...\n`);

        let lastStats = null;
        const startTime = Date.now();

        sender.on('stats', (stats) => {
            lastStats = stats;
            const elapsed = (Date.now() - startTime) / 1000;
            console.log(`\r📊 进度: ${stats.progress.toFixed(1)}% | ` +
                `吞吐量: ${stats.throughputStr} | ` +
                `RTT: ${stats.rtt}ms | ` +
                `丢包: ${stats.lossRate.toFixed(2)}% | ` +
                `cwnd: ${stats.cwnd} | ` +
                `重传: ${stats.retransmittedChunks}`,
            );

            if (stats.pathStats) {
                Object.entries(stats.pathStats).forEach(([pathId, pathStats]) => {
                    console.log(`   ${pathId === 'wifi' ? '📶' : '🔌'} ${pathId}: ` +
                        `RTT=${pathStats.rtt.toFixed(0)}ms, ` +
                        `丢包=${pathStats.lossRate.toFixed(2)}%, ` +
                        `发送=${pathStats.sentPackets}, ` +
                        `健康=${(pathStats.healthScore * 100).toFixed(0)}%`);
                });
            }
        });

        sender.on('path:scheduled', (info) => {
        });

        const fileBuffer = fs.readFileSync(TEST_FILE_PATH);
        const result = await sender.sendFile(fileBuffer, 'test-multipath.bin');

        console.log('\n========================================');
        console.log('✅ 传输完成！');
        console.log('========================================\n');

        console.log(`📈 传输统计:`);
        console.log(`   文件大小: ${(TEST_FILE_SIZE / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   总耗时: ${(result.elapsedMs / 1000).toFixed(2)} 秒`);
        console.log(`   平均吞吐量: ${result.throughputStr}`);
        console.log();

        const finalStats = sender.getStats();
        console.log(`📦 分片统计:`);
        console.log(`   总分片数: ${finalStats.totalChunks}`);
        console.log(`   已发送分片: ${finalStats.sentChunks}`);
        console.log(`   已确认分片: ${finalStats.ackedChunks}`);
        console.log(`   重传分片: ${finalStats.retransmittedChunks}`);
        console.log(`   重传率: ${finalStats.retransmissionRate.toFixed(2)}%`);
        console.log(`   丢包率: ${finalStats.lossRate.toFixed(2)}%`);
        console.log(`   虚假重传恢复: ${finalStats.spuriousRecoveries}`);
        console.log();

        console.log(`🌐 路径统计:`);
        if (finalStats.pathStats) {
            Object.entries(finalStats.pathStats).forEach(([pathId, pathStats]) => {
                console.log(`   ${pathId === 'wifi' ? '📶' : '🔌'} ${pathId}:`);
                console.log(`     发送包数: ${pathStats.sentPackets}`);
                console.log(`     接收包数: ${pathStats.receivedPackets || 0}`);
                console.log(`     平均 RTT: ${pathStats.rtt.toFixed(2)} ms`);
                console.log(`     平均丢包率: ${pathStats.lossRate.toFixed(2)}%`);
                console.log(`     健康度: ${(pathStats.healthScore * 100).toFixed(0)}%`);
                console.log();
            });
        }

        console.log('✅ 多路径测试通过！\n');

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await sender.close();
        if (fs.existsSync(TEST_FILE_PATH)) {
            fs.unlinkSync(TEST_FILE_PATH);
            console.log('🧹 测试文件已清理');
        }
    }
}

async function testSchedulingAlgorithms() {
    console.log('\n========================================');
    console.log('  调度算法测试');
    console.log('========================================\n');

    const paths = [
        { id: 'wifi', name: 'WiFi 网络', host: RECEIVER_HOST, port: RECEIVER_PORTS[0], enabled: true, weight: 1, color: '#3498db' },
        { id: 'ethernet', name: '有线网络', host: RECEIVER_HOST, port: RECEIVER_PORTS[1], enabled: true, weight: 1, color: '#2ecc71' },
    ];

    const scheduler = new MultiPathScheduler(paths, 'dynamicWeighted');

    const pathStats = scheduler.pathStats;

    console.log('🧪 模拟不同路径状况:');
    console.log();

    for (let i = 0; i < 5; i++) {
        const wifiRtt = 20 + Math.random() * 80;
        const wifiLoss = Math.random() * 5;
        const ethRtt = 5 + Math.random() * 20;
        const ethLoss = Math.random() * 1;

        pathStats.get('wifi').updateRtt(wifiRtt);
        if (wifiLoss > 2) pathStats.get('wifi').recordLoss();
        pathStats.get('ethernet').updateRtt(ethRtt);
        if (ethLoss > 0.5) pathStats.get('ethernet').recordLoss();

        console.log(`迭代 ${i + 1}:`);
        console.log(`   📶 WiFi: RTT=${wifiRtt.toFixed(1)}ms, 丢包=${wifiLoss.toFixed(1)}%, 健康=${(pathStats.get('wifi').getHealthScore() * 100).toFixed(0)}%`);
        console.log(`   🔌 有线: RTT=${ethRtt.toFixed(1)}ms, 丢包=${ethLoss.toFixed(1)}%, 健康=${(pathStats.get('ethernet').getHealthScore() * 100).toFixed(0)}%`);

        const distribution = { wifi: 0, ethernet: 0 };
        for (let j = 0; j < 100; j++) {
            const selected = scheduler.scheduleNext(i * 100 + j);
            distribution[selected.id]++;
        }
        console.log(`   📊 调度分布: WiFi=${distribution.wifi}%, 有线=${distribution.ethernet}%`);
        console.log();
    }

    console.log('✅ 调度算法测试完成！\n');
}

async function main() {
    try {
        await testSchedulingAlgorithms();
        await runMultiPathTest();
    } catch (error) {
        console.error('测试失败:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { runMultiPathTest, testSchedulingAlgorithms };
