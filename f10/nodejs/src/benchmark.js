const zlib = require('zlib');
const { promisify } = require('util');
const lz4 = require('./lz4_wasm');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const deflate = promisify(zlib.deflate);
const inflate = promisify(zlib.inflate);

class Benchmark {
    generateTestData(sizeMB) {
        const size = sizeMB * 1024 * 1024;
        const buffer = Buffer.alloc(size);
        
        for (let i = 0; i < size; i++) {
            if (Math.random() > 0.7) {
                buffer[i] = Math.floor(Math.random() * 256);
            } else {
                buffer[i] = 65 + Math.floor(Math.random() * 26);
            }
        }
        
        return buffer;
    }

    async runLZ4Compress(data) {
        const start = process.hrtime.bigint();
        const compressed = lz4.compress(data);
        const end = process.hrtime.bigint();
        
        const durationMs = Number(end - start) / 1e6;
        
        return {
            algorithm: 'lz4-wasm',
            operation: 'compress',
            originalSize: data.length,
            compressedSize: compressed.length,
            ratio: data.length / compressed.length,
            durationMs,
            throughputMBps: (data.length / 1024 / 1024) / (durationMs / 1000)
        };
    }

    async runLZ4Decompress(compressedData, originalSize) {
        const start = process.hrtime.bigint();
        const decompressed = lz4.decompress(compressedData, originalSize);
        const end = process.hrtime.bigint();
        
        const durationMs = Number(end - start) / 1e6;
        
        return {
            algorithm: 'lz4-wasm',
            operation: 'decompress',
            compressedSize: compressedData.length,
            decompressedSize: decompressed.length,
            durationMs,
            throughputMBps: (decompressed.length / 1024 / 1024) / (durationMs / 1000)
        };
    }

    async runGzipCompress(data) {
        const start = process.hrtime.bigint();
        const compressed = await gzip(data);
        const end = process.hrtime.bigint();
        
        const durationMs = Number(end - start) / 1e6;
        
        return {
            algorithm: 'gzip',
            operation: 'compress',
            originalSize: data.length,
            compressedSize: compressed.length,
            ratio: data.length / compressed.length,
            durationMs,
            throughputMBps: (data.length / 1024 / 1024) / (durationMs / 1000)
        };
    }

    async runGzipDecompress(compressedData) {
        const start = process.hrtime.bigint();
        const decompressed = await gunzip(compressedData);
        const end = process.hrtime.bigint();
        
        const durationMs = Number(end - start) / 1e6;
        
        return {
            algorithm: 'gzip',
            operation: 'decompress',
            compressedSize: compressedData.length,
            decompressedSize: decompressed.length,
            durationMs,
            throughputMBps: (decompressed.length / 1024 / 1024) / (durationMs / 1000)
        };
    }

    async runDeflateCompress(data) {
        const start = process.hrtime.bigint();
        const compressed = await deflate(data);
        const end = process.hrtime.bigint();
        
        const durationMs = Number(end - start) / 1e6;
        
        return {
            algorithm: 'deflate',
            operation: 'compress',
            originalSize: data.length,
            compressedSize: compressed.length,
            ratio: data.length / compressed.length,
            durationMs,
            throughputMBps: (data.length / 1024 / 1024) / (durationMs / 1000)
        };
    }

    async runDeflateDecompress(compressedData) {
        const start = process.hrtime.bigint();
        const decompressed = await inflate(compressedData);
        const end = process.hrtime.bigint();
        
        const durationMs = Number(end - start) / 1e6;
        
        return {
            algorithm: 'deflate',
            operation: 'decompress',
            compressedSize: compressedData.length,
            decompressedSize: decompressed.length,
            durationMs,
            throughputMBps: (decompressed.length / 1024 / 1024) / (durationMs / 1000)
        };
    }

    async runFullBenchmark(sizeMB = 1) {
        console.log(`Running benchmark with ${sizeMB}MB test data...`);
        
        const data = this.generateTestData(sizeMB);
        
        const results = {
            testDataSizeMB: sizeMB,
            timestamp: new Date().toISOString(),
            compressions: [],
            decompressions: []
        };
        
        const lz4Compress = await this.runLZ4Compress(data);
        results.compressions.push(lz4Compress);
        
        const gzipCompress = await this.runGzipCompress(data);
        results.compressions.push(gzipCompress);
        
        const deflateCompress = await this.runDeflateCompress(data);
        results.compressions.push(deflateCompress);
        
        const lz4Decompress = await this.runLZ4Decompress(lz4Compress.compressed, data.length);
        results.decompressions.push(lz4Decompress);
        
        const gzipDecompress = await this.runGzipDecompress(gzipCompress.compressed);
        results.decompressions.push(gzipDecompress);
        
        const deflateDecompress = await this.runDeflateDecompress(deflateCompress.compressed);
        results.decompressions.push(deflateDecompress);
        
        results.comparison = {
            compressionSpeed: {
                'lz4-vs-gzip': lz4Compress.throughputMBps / gzipCompress.throughputMBps,
                'lz4-vs-deflate': lz4Compress.throughputMBps / deflateCompress.throughputMBps
            },
            decompressionSpeed: {
                'lz4-vs-gzip': lz4Decompress.throughputMBps / gzipDecompress.throughputMBps,
                'lz4-vs-deflate': lz4Decompress.throughputMBps / deflateDecompress.throughputMBps
            },
            compressionRatio: {
                'lz4-vs-gzip': lz4Compress.ratio / gzipCompress.ratio,
                'lz4-vs-deflate': lz4Compress.ratio / deflateCompress.ratio
            }
        };
        
        return results;
    }

    formatResults(results) {
        let output = `\n=== LZ4 WASM Benchmark Results (${results.testDataSizeMB}MB) ===\n\n`;
        
        output += 'Compression Performance:\n';
        output += '------------------------\n';
        
        for (const res of results.compressions) {
            output += `${res.algorithm.toUpperCase()}:\n`;
            output += `  Ratio: ${res.ratio.toFixed(2)}x\n`;
            output += `  Speed: ${res.throughputMBps.toFixed(2)} MB/s\n`;
            output += `  Time: ${res.durationMs.toFixed(2)} ms\n\n`;
        }
        
        output += 'Decompression Performance:\n';
        output += '--------------------------\n';
        
        for (const res of results.decompressions) {
            output += `${res.algorithm.toUpperCase()}:\n`;
            output += `  Speed: ${res.throughputMBps.toFixed(2)} MB/s\n`;
            output += `  Time: ${res.durationMs.toFixed(2)} ms\n\n`;
        }
        
        output += 'LZ4 Speed Comparison (vs others):\n';
        output += '----------------------------------\n';
        output += `Compression: ${results.comparison.compressionSpeed['lz4-vs-gzip'].toFixed(1)}x faster than gzip\n`;
        output += `Compression: ${results.comparison.compressionSpeed['lz4-vs-deflate'].toFixed(1)}x faster than deflate\n`;
        output += `Decompression: ${results.comparison.decompressionSpeed['lz4-vs-gzip'].toFixed(1)}x faster than gzip\n`;
        output += `Decompression: ${results.comparison.decompressionSpeed['lz4-vs-deflate'].toFixed(1)}x faster than deflate\n`;
        
        return output;
    }
}

module.exports = new Benchmark();
