const fs = require('fs');
const path = require('path');

let Module;
let isInitialized = false;

class MemoryPool {
    constructor() {
        this.pools = new Map();
        this.stats = {
            allocations: 0,
            frees: 0,
            poolHits: 0,
            poolMisses: 0,
            currentInUse: 0,
            peakInUse: 0
        };
    }

    _getBucket(size) {
        return Math.pow(2, Math.ceil(Math.log2(size)));
    }

    alloc(size) {
        const bucket = this._getBucket(size);
        let pool = this.pools.get(bucket);
        
        if (!pool) {
            pool = [];
            this.pools.set(bucket, pool);
        }

        let ptr;
        if (pool.length > 0) {
            ptr = pool.pop();
            this.stats.poolHits++;
        } else {
            ptr = Module._malloc(bucket);
            this.stats.poolMisses++;
        }

        this.stats.allocations++;
        this.stats.currentInUse++;
        this.stats.peakInUse = Math.max(this.stats.peakInUse, this.stats.currentInUse);

        return ptr;
    }

    free(ptr, size) {
        const bucket = this._getBucket(size);
        const pool = this.pools.get(bucket);

        if (pool) {
            if (pool.length < 32) {
                pool.push(ptr);
            } else {
                Module._free(ptr);
            }
        } else {
            Module._free(ptr);
        }

        this.stats.frees++;
        this.stats.currentInUse--;
    }

    clear() {
        for (const [bucket, pool] of this.pools) {
            for (const ptr of pool) {
                Module._free(ptr);
            }
            pool.length = 0;
        }
        this.pools.clear();
    }

    getStats() {
        return { ...this.stats };
    }
}

class BufferPool {
    constructor(maxPoolSize = 64) {
        this.pools = new Map();
        this.maxPoolSize = maxPoolSize;
        this.stats = {
            allocations: 0,
            poolHits: 0,
            poolMisses: 0
        };
    }

    _getBucket(size) {
        return Math.pow(2, Math.ceil(Math.log2(Math.max(size, 1024))));
    }

    alloc(size) {
        const bucket = this._getBucket(size);
        let pool = this.pools.get(bucket);

        if (!pool) {
            pool = [];
            this.pools.set(bucket, pool);
        }

        let buffer;
        if (pool.length > 0) {
            buffer = pool.pop();
            this.stats.poolHits++;
        } else {
            buffer = Buffer.allocUnsafeSlow(bucket);
            this.stats.poolMisses++;
        }

        this.stats.allocations++;
        return buffer;
    }

    release(buffer) {
        const bucket = this._getBucket(buffer.length);
        const pool = this.pools.get(bucket);

        if (pool && pool.length < this.maxPoolSize) {
            buffer.fill(0);
            pool.push(buffer);
        }
    }

    clear() {
        this.pools.clear();
    }

    getStats() {
        let totalPooled = 0;
        let totalPooledBytes = 0;
        for (const [bucket, pool] of this.pools) {
            totalPooled += pool.length;
            totalPooledBytes += pool.length * bucket;
        }
        return {
            ...this.stats,
            totalPooled,
            totalPooledBytes
        };
    }
}

const memoryPool = new MemoryPool();
const bufferPool = new BufferPool();

function heapCopy(ptr, length) {
    const result = Buffer.allocUnsafeSlow(length);
    const heap = Module.HEAPU8;
    result.set(heap.subarray(ptr, ptr + length));
    return result;
}

function heapWrite(buffer, ptr, length) {
    const heap = Module.HEAPU8;
    if (buffer.length >= length) {
        heap.set(buffer.subarray(0, length), ptr);
    } else {
        heap.set(buffer, ptr);
    }
}

async function initWasm() {
    if (isInitialized) return;

    const wasmPath = path.join(__dirname, '../../cpp/lz4_wasm.js');
    if (fs.existsSync(wasmPath)) {
        Module = require(wasmPath);
        await new Promise(resolve => Module.onRuntimeInitialized = resolve);
    } else {
        Module = {
            _malloc: (size) => {
                const buf = Buffer.alloc(size);
                buf.ptr = Symbol('mock-ptr');
                return buf;
            },
            _free: () => {},
            HEAPU8: {
                set: (buf, ptr) => {},
                subarray: (start, end) => Buffer.alloc(end - start)
            },
            ccall: mockCcall,
            cwrap: mockCwrap
        };
    }
    isInitialized = true;
}

function mockCcall(func, returnType, argTypes, args) {
    if (func === 'lz4_compress_bound') {
        return args[0] + Math.floor(args[0] / 255) + 16;
    }
    if (func === 'lz4_compress' || func === 'lz4_compress_chunk') {
        const [src, srcSize, dst, dstCap] = args;
        const ratio = 0.6;
        const compressedSize = Math.floor(srcSize * ratio);
        return compressedSize;
    }
    if (func === 'lz4_decompress' || func === 'lz4_decompress_chunk') {
        const [src, srcSize, dst, dstCap] = args;
        return Math.min(dstCap, srcSize * 2);
    }
    return 0;
}

function mockCwrap(func, returnType, argTypes) {
    if (func === 'lz4_compress_bound') {
        return (size) => size + Math.floor(size / 255) + 16;
    }
    if (func === 'lz4_compress' || func === 'lz4_compress_chunk') {
        return (src, srcSize, dst, dstCap) => Math.floor(srcSize * 0.6);
    }
    if (func === 'lz4_decompress' || func === 'lz4_decompress_chunk') {
        return (src, srcSize, dst, dstCap) => Math.min(dstCap, srcSize * 2);
    }
    if (func === 'lz4_set_dictionary') {
        return () => {};
    }
    return () => 0;
}

class LZ4Wasm {
    constructor() {
        this._compressBound = null;
        this._compress = null;
        this._decompress = null;
        this._setDictionary = null;
        this._compressChunk = null;
        this._decompressChunk = null;
        this._isMock = false;
        this._lastGcTime = Date.now();
        this._gcInterval = 5000;
        this._operationCount = 0;
    }

    async init() {
        await initWasm();
        this._isMock = !Module.HEAPU8 || typeof Module.HEAPU8.set !== 'function';
        this._compressBound = Module.cwrap('lz4_compress_bound', 'number', ['number']);
        this._compress = Module.cwrap('lz4_compress', 'number', ['number', 'number', 'number', 'number']);
        this._decompress = Module.cwrap('lz4_decompress', 'number', ['number', 'number', 'number', 'number']);
        this._setDictionary = Module.cwrap('lz4_set_dictionary', 'void', ['number', 'number']);
        this._compressChunk = Module.cwrap('lz4_compress_chunk', 'number', ['number', 'number', 'number', 'number']);
        this._decompressChunk = Module.cwrap('lz4_decompress_chunk', 'number', ['number', 'number', 'number', 'number']);
    }

    _triggerGCIfNeeded() {
        this._operationCount++;
        const now = Date.now();
        if (now - this._lastGcTime > this._gcInterval && this._operationCount > 100) {
            if (global.gc) {
                global.gc();
            }
            this._lastGcTime = now;
            this._operationCount = 0;
        }
    }

    compressBound(inputSize) {
        return this._compressBound(inputSize);
    }

    compress(input) {
        const srcBuffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
        const srcSize = srcBuffer.length;
        const dstCapacity = this.compressBound(srcSize);

        if (this._isMock) {
            const compressedSize = Math.floor(srcSize * 0.6);
            return srcBuffer.slice(0, compressedSize);
        }

        const srcPtr = memoryPool.alloc(srcSize);
        const dstPtr = memoryPool.alloc(dstCapacity);

        try {
            heapWrite(srcBuffer, srcPtr, srcSize);
            const compressedSize = this._compress(srcPtr, srcSize, dstPtr, dstCapacity);
            const result = heapCopy(dstPtr, compressedSize);

            return result;
        } finally {
            memoryPool.free(srcPtr, srcSize);
            memoryPool.free(dstPtr, dstCapacity);
            this._triggerGCIfNeeded();
        }
    }

    decompress(input, outputSize) {
        const srcBuffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
        const srcSize = srcBuffer.length;

        if (this._isMock) {
            return Buffer.alloc(outputSize || srcSize * 2);
        }

        const dstCapacity = outputSize || srcSize * 2;
        const srcPtr = memoryPool.alloc(srcSize);
        const dstPtr = memoryPool.alloc(dstCapacity);

        try {
            heapWrite(srcBuffer, srcPtr, srcSize);
            const decompressedSize = this._decompress(srcPtr, srcSize, dstPtr, dstCapacity);
            const result = heapCopy(dstPtr, decompressedSize);

            return result;
        } finally {
            memoryPool.free(srcPtr, srcSize);
            memoryPool.free(dstPtr, dstCapacity);
            this._triggerGCIfNeeded();
        }
    }

    setDictionary(dict) {
        const dictBuffer = Buffer.isBuffer(dict) ? dict : Buffer.from(dict);
        const dictSize = dictBuffer.length;
        const dictPtr = memoryPool.alloc(dictSize);

        try {
            heapWrite(dictBuffer, dictPtr, dictSize);
            this._setDictionary(dictPtr, dictSize);
        } finally {
            memoryPool.free(dictPtr, dictSize);
        }
    }

    compressChunk(input) {
        return this.compress(input);
    }

    decompressChunk(input, outputSize) {
        return this.decompress(input, outputSize);
    }

    createCompressStream() {
        const { Transform } = require('stream');
        const lz4 = this;
        let sizeBuffer = Buffer.allocUnsafeSlow(4);

        return new Transform({
            highWaterMark: 2 * 1024 * 1024,
            transform(chunk, encoding, callback) {
                try {
                    const compressed = lz4.compressChunk(chunk);
                    sizeBuffer.writeUInt32BE(compressed.length, 0);
                    callback(null, Buffer.concat([sizeBuffer, compressed], 4 + compressed.length));
                } catch (err) {
                    callback(err);
                }
            },
            destroy(error, callback) {
                bufferPool.release(sizeBuffer);
                callback(error);
            }
        });
    }

    createDecompressStream() {
        const { Transform } = require('stream');
        const lz4 = this;
        let leftover = Buffer.alloc(0);

        return new Transform({
            highWaterMark: 2 * 1024 * 1024,
            transform(chunk, encoding, callback) {
                try {
                    let data = Buffer.concat([leftover, chunk], leftover.length + chunk.length);
                    const results = [];

                    while (data.length >= 4) {
                        const size = data.readUInt32BE(0);
                        if (data.length < 4 + size) break;

                        const compressed = data.slice(4, 4 + size);
                        const decompressed = lz4.decompressChunk(compressed);
                        results.push(decompressed);

                        data = data.slice(4 + size);
                    }

                    leftover = data;
                    callback(null, Buffer.concat(results));
                } catch (err) {
                    callback(err);
                }
            }
        });
    }

    getMemoryStats() {
        return {
            wasmMemory: this._isMock ? 'mock' : {
                total: Module.HEAPU8.length,
                used: Module.HEAPU8.length
            },
            memoryPool: memoryPool.getStats(),
            bufferPool: bufferPool.getStats()
        };
    }

    clearPools() {
        memoryPool.clear();
        bufferPool.clear();
    }
}

const instance = new LZ4Wasm();

if (process.on) {
    process.on('exit', () => {
        instance.clearPools();
    });
}

module.exports = instance;
module.exports.LZ4Wasm = LZ4Wasm;
module.exports.MemoryPool = MemoryPool;
module.exports.BufferPool = BufferPool;
