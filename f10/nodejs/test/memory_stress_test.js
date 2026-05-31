const lz4 = require('../src/lz4_wasm');
const { performance } = require('perf_hooks');

function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function generateTestData(sizeMB) {
    const size = sizeMB * 1024 * 1024;
    const buffer = Buffer.alloc(size);
    for (let i = 0; i < size; i++) {
        if (Math.random() > 0.3) {
            buffer[i] = 65 + Math.floor(Math.random() * 26);
        } else {
            buffer[i] = Math.floor(Math.random() * 256);
        }
    }
    return buffer;
}

class StressTest {
    constructor(options = {}) {
        this.iterations = options.iterations || 500;
        this.fileSizeMB = options.fileSizeMB || 10;
        this.checkInterval = options.checkInterval || 50;
        this.results = [];
        this.initialMemory = null;
        this.peakMemory = 0;
    }

    async init() {
        console.log('Initializing LZ4 WASM module...');
        await lz4.init();
        console.log('LZ4 WASM initialized');
    }

    getMemoryStats() {
        const mem = process.memoryUsage();
        const lz4Stats = lz4.getMemoryStats();
        return {
            timestamp: Date.now(),
            nodeHeapUsed: mem.heapUsed,
            nodeRss: mem.rss,
            external: mem.external,
            lz4: lz4Stats
        };
    }

    logMemoryStats(stats, iteration) {
        console.log(`\n[Iteration ${iteration}/${this.iterations}] Memory Stats:`);
        console.log(`  RSS: ${formatBytes(stats.nodeRss)}`);
        console.log(`  Heap Used: ${formatBytes(stats.nodeHeapUsed)}`);
        console.log(`  External: ${formatBytes(stats.external)}`);
        if (stats.lz4.memoryPool) {
            const mp = stats.lz4.memoryPool;
            console.log(`  WASM Pool: hits=${mp.poolHits}, misses=${mp.poolMisses}, inUse=${mp.currentInUse}`);
        }
    }

    async run() {
        await this.init();

        console.log(`\nStarting stress test:`);
        console.log(`  Iterations: ${this.iterations}`);
        console.log(`  File size: ${this.fileSizeMB} MB`);
        console.log(`  Total data: ${this.iterations * this.fileSizeMB} MB`);
        console.log(`  Check interval: every ${this.checkInterval} iterations`);
        console.log('=' .repeat(60));

        this.initialMemory = this.getMemoryStats();
        this.logMemoryStats(this.initialMemory, 0);

        const testData = generateTestData(this.fileSizeMB);
        console.log(`\nGenerated test data: ${formatBytes(testData.length)}`);

        const startTime = performance.now();
        let totalCompressedSize = 0;

        for (let i = 1; i <= this.iterations; i++) {
            const compressed = lz4.compress(testData);
            totalCompressedSize += compressed.length;

            const decompressed = lz4.decompress(compressed, testData.length);

            if (decompressed.length !== testData.length) {
                throw new Error(`Size mismatch! Expected ${testData.length}, got ${decompressed.length}`);
            }

            if (i % this.checkInterval === 0) {
                const stats = this.getMemoryStats();
                this.results.push(stats);
                this.logMemoryStats(stats, i);
                this.peakMemory = Math.max(this.peakMemory, stats.nodeRss);

                if (global.gc) {
                    global.gc();
                }
            }
        }

        const endTime = performance.now();
        const duration = endTime - startTime;

        console.log('\n' + '=' .repeat(60));
        console.log('STRESS TEST COMPLETE');
        console.log('=' .repeat(60));

        const finalStats = this.getMemoryStats();
        this.results.push(finalStats);

        const rssGrowth = finalStats.nodeRss - this.initialMemory.nodeRss;
        const heapGrowth = finalStats.nodeHeapUsed - this.initialMemory.nodeHeapUsed;

        console.log('\nPERFORMANCE:');
        console.log(`  Total time: ${(duration / 1000).toFixed(2)}s`);
        console.log(`  Average per file: ${(duration / this.iterations).toFixed(2)}ms`);
        console.log(`  Throughput: ${((this.iterations * this.fileSizeMB) / (duration / 1000)).toFixed(2)} MB/s`);

        console.log('\nCOMPRESSION:');
        console.log(`  Total compressed: ${formatBytes(totalCompressedSize)}`);
        console.log(`  Average ratio: ${((this.iterations * this.fileSizeMB * 1024 * 1024) / totalCompressedSize).toFixed(2)}x`);

        console.log('\nMEMORY:');
        console.log(`  Initial RSS: ${formatBytes(this.initialMemory.nodeRss)}`);
        console.log(`  Final RSS: ${formatBytes(finalStats.nodeRss)}`);
        console.log(`  Peak RSS: ${formatBytes(this.peakMemory)}`);
        console.log(`  RSS Growth: ${formatBytes(rssGrowth)}`);
        console.log(`  Heap Growth: ${formatBytes(heapGrowth)}`);

        if (finalStats.lz4.memoryPool) {
            const mp = finalStats.lz4.memoryPool;
            console.log('\nWASM MEMORY POOL:');
            console.log(`  Total allocations: ${mp.allocations}`);
            console.log(`  Pool hits: ${mp.poolHits} (${((mp.poolHits / mp.allocations) * 100).toFixed(1)}%)`);
            console.log(`  Pool misses: ${mp.poolMisses}`);
            console.log(`  Peak in use: ${mp.peakInUse}`);
        }

        const growthPerFile = rssGrowth / this.iterations;
        console.log('\nMEMORY LEAK ANALYSIS:');
        console.log(`  Growth per file: ${formatBytes(growthPerFile)}`);

        if (growthPerFile < 1024) {
            console.log('  ✓ NO MEMORY LEAK DETECTED - growth is negligible');
        } else if (growthPerFile < 100 * 1024) {
            console.log('  ⚠ MINOR GROWTH - possibly due to GC not running yet');
        } else {
            console.log('  ✗ POSSIBLE MEMORY LEAK - significant growth detected');
        }

        console.log('');
        return {
            success: growthPerFile < 100 * 1024,
            stats: finalStats,
            growthPerFile
        };
    }
}

async function main() {
    const args = process.argv.slice(2);
    const options = {
        iterations: parseInt(args[0]) || parseInt(process.env.ITERATIONS) || 100,
        fileSizeMB: parseInt(args[1]) || parseInt(process.env.FILE_SIZE) || 5,
        checkInterval: parseInt(args[2]) || parseInt(process.env.CHECK_INTERVAL) || 20
    };

    const test = new StressTest(options);
    const result = await test.run();

    process.exit(result.success ? 0 : 1);
}

if (require.main === module) {
    main().catch(err => {
        console.error('Test failed:', err);
        process.exit(1);
    });
}

module.exports = StressTest;
