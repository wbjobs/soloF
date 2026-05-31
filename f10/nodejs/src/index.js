const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');

const lz4 = require('./lz4_wasm');
const metrics = require('./metrics');
const dictionary = require('./dictionary');
const benchmark = require('./benchmark');
const adaptive = require('./adaptive_compression');

const app = express();
const PORT = process.env.PORT || 3000;

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
    metrics.incrementActiveConnections();
    res.on('finish', () => {
        metrics.decrementActiveConnections();
    });
    next();
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'lz4-compression-service' });
});

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', metrics.getContentType());
    res.end(await metrics.getMetrics());
});

app.get('/api/memory/stats', (req, res) => {
    const memoryStats = process.memoryUsage();
    const lz4Stats = lz4.getMemoryStats();

    res.json({
        success: true,
        node: {
            rss: memoryStats.rss,
            heapTotal: memoryStats.heapTotal,
            heapUsed: memoryStats.heapUsed,
            external: memoryStats.external,
            arrayBuffers: memoryStats.arrayBuffers
        },
        lz4: lz4Stats,
        gcAvailable: typeof global.gc === 'function'
    });
});

app.post('/api/memory/gc', (req, res) => {
    if (global.gc) {
        global.gc();
        const memoryStats = process.memoryUsage();
        res.json({
            success: true,
            message: 'GC triggered',
            memoryAfter: {
                heapUsed: memoryStats.heapUsed,
                heapTotal: memoryStats.heapTotal
            }
        });
    } else {
        res.status(501).json({
            success: false,
            message: 'GC not available. Start Node with --expose-gc flag'
        });
    }
});

app.post('/api/memory/clear-pools', (req, res) => {
    lz4.clearPools();
    res.json({
        success: true,
        message: 'Memory pools cleared'
    });
});

app.post('/api/compress/adaptive', upload.single('data'), async (req, res) => {
    try {
        let inputData;
        const filename = req.file ? req.file.originalname : req.body.filename;
        const preferSpeed = req.body.preferSpeed === true || req.query.preferSpeed === 'true';
        const preferRatio = req.body.preferRatio === true || req.query.preferRatio === 'true';
        const explain = req.body.explain === true || req.query.explain === 'true';

        if (req.file) {
            inputData = req.file.buffer;
        } else if (req.body.data) {
            inputData = Buffer.isBuffer(req.body.data) ? req.body.data : Buffer.from(req.body.data);
        } else if (req.body instanceof Buffer) {
            inputData = req.body;
        } else {
            return res.status(400).json({ error: 'No data provided for compression' });
        }

        const history = [];
        const decision = adaptive.decideCompression(inputData, {
            filename,
            history,
            preferSpeed,
            preferRatio
        });

        if (decision.useDictionary && decision.trainDictionary) {
            const dict = await dictionary.trainDictionary();
            if (dict) {
                lz4.setDictionary(dict);
            }
        }

        const startTime = Date.now();
        const compressed = lz4.compress(inputData);
        const duration = Date.now() - startTime;

        metrics.recordCompression('lz4-wasm-adaptive', inputData.length, compressed.length, duration);

        await dictionary.addToHistory(inputData);

        const historyCount = await dictionary.getHistoryCount();
        metrics.setTrainingFilesCount(historyCount);

        const result = {
            success: true,
            originalSize: inputData.length,
            compressedSize: compressed.length,
            ratio: (inputData.length / compressed.length).toFixed(2),
            durationMs: duration,
            adaptive: {
                level: decision.level,
                levelName: decision.levelName,
                fileType: decision.fileType.type,
                fileTypeConfidence: (decision.fileType.confidence * 100).toFixed(0),
                estimatedRatio: decision.estimatedRatio.toFixed(2),
                dictionarySize: decision.dictionarySize,
                dictionaryStrategy: decision.strategy,
                chunked: decision.chunked,
                streaming: decision.streaming
            }
        };

        if (explain) {
            result.explanation = adaptive.explainDecision(decision);
        }

        if (req.query.download) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${filename ? path.basename(filename, path.extname(filename)) : 'data'}.lz4"`);
            return res.send(compressed);
        }

        result.compressed = compressed.toString('base64');
        res.json(result);
    } catch (err) {
        console.error('Adaptive compression error:', err);
        res.status(500).json({ error: 'Adaptive compression failed', message: err.message });
    }
});

app.post('/api/compress/explain', upload.single('data'), async (req, res) => {
    try {
        let inputData;
        const filename = req.file ? req.file.originalname : req.body.filename;
        const preferSpeed = req.body.preferSpeed === true || req.query.preferSpeed === 'true';
        const preferRatio = req.body.preferRatio === true || req.query.preferRatio === 'true';

        if (req.file) {
            inputData = req.file.buffer;
        } else if (req.body.data) {
            inputData = Buffer.isBuffer(req.body.data) ? req.body.data : Buffer.from(req.body.data);
        } else if (req.body instanceof Buffer) {
            inputData = req.body;
        } else {
            return res.status(400).json({ error: 'No data provided for analysis' });
        }

        const decision = adaptive.decideCompression(inputData, {
            filename,
            preferSpeed,
            preferRatio
        });

        res.json({
            success: true,
            ...adaptive.explainDecision(decision)
        });
    } catch (err) {
        console.error('Compression explain error:', err);
        res.status(500).json({ error: 'Failed to analyze compression strategy', message: err.message });
    }
});

app.post('/api/compress', upload.single('data'), async (req, res) => {
    try {
        let inputData;
        
        if (req.file) {
            inputData = req.file.buffer;
        } else if (req.body.data) {
            inputData = Buffer.isBuffer(req.body.data) ? req.body.data : Buffer.from(req.body.data);
        } else if (req.body instanceof Buffer) {
            inputData = req.body;
        } else {
            return res.status(400).json({ error: 'No data provided for compression' });
        }

        const startTime = Date.now();
        const compressed = lz4.compress(inputData);
        const duration = Date.now() - startTime;

        metrics.recordCompression('lz4-wasm', inputData.length, compressed.length, duration);

        await dictionary.addToHistory(inputData);

        const historyCount = await dictionary.getHistoryCount();
        metrics.setTrainingFilesCount(historyCount);

        if (req.query.download) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', 'attachment; filename="compressed.lz4"');
            return res.send(compressed);
        }

        res.json({
            success: true,
            originalSize: inputData.length,
            compressedSize: compressed.length,
            ratio: (inputData.length / compressed.length).toFixed(2),
            durationMs: duration,
            compressed: compressed.toString('base64')
        });
    } catch (err) {
        console.error('Compression error:', err);
        res.status(500).json({ error: 'Compression failed', message: err.message });
    }
});

app.post('/api/decompress', upload.single('data'), async (req, res) => {
    try {
        let inputData;
        const outputSize = parseInt(req.body.outputSize) || null;

        if (req.file) {
            inputData = req.file.buffer;
        } else if (req.body.data) {
            inputData = Buffer.from(req.body.data, 'base64');
        } else {
            return res.status(400).json({ error: 'No data provided for decompression' });
        }

        const startTime = Date.now();
        const decompressed = lz4.decompress(inputData, outputSize);
        const duration = Date.now() - startTime;

        metrics.recordDecompression('lz4-wasm', inputData.length, decompressed.length, duration);

        if (req.query.download) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', 'attachment; filename="decompressed.dat"');
            return res.send(decompressed);
        }

        res.json({
            success: true,
            compressedSize: inputData.length,
            decompressedSize: decompressed.length,
            durationMs: duration,
            decompressed: decompressed.toString('base64')
        });
    } catch (err) {
        console.error('Decompression error:', err);
        res.status(500).json({ error: 'Decompression failed', message: err.message });
    }
});

app.post('/api/compress/stream', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Transfer-Encoding', 'chunked');

        const compressStream = lz4.createCompressStream();
        let totalIn = 0;
        let totalOut = 0;
        const startTime = Date.now();

        compressStream.on('data', (chunk) => {
            totalOut += chunk.length;
            res.write(chunk);
        });

        req.on('data', (chunk) => {
            totalIn += chunk.length;
            compressStream.write(chunk);
        });

        req.on('end', () => {
            compressStream.end();
        });

        compressStream.on('end', () => {
            const duration = Date.now() - startTime;
            metrics.recordCompression('lz4-wasm-stream', totalIn, totalOut, duration);
            res.end();
        });

        compressStream.on('error', (err) => {
            console.error('Stream compression error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Stream compression failed' });
            }
        });

    } catch (err) {
        console.error('Stream compression error:', err);
        res.status(500).json({ error: 'Stream compression failed', message: err.message });
    }
});

app.post('/api/decompress/stream', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Transfer-Encoding', 'chunked');

        const decompressStream = lz4.createDecompressStream();
        let totalIn = 0;
        let totalOut = 0;
        const startTime = Date.now();

        decompressStream.on('data', (chunk) => {
            totalOut += chunk.length;
            res.write(chunk);
        });

        req.on('data', (chunk) => {
            totalIn += chunk.length;
            decompressStream.write(chunk);
        });

        req.on('end', () => {
            decompressStream.end();
        });

        decompressStream.on('end', () => {
            const duration = Date.now() - startTime;
            metrics.recordDecompression('lz4-wasm-stream', totalIn, totalOut, duration);
            res.end();
        });

        decompressStream.on('error', (err) => {
            console.error('Stream decompression error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Stream decompression failed' });
            }
        });

    } catch (err) {
        console.error('Stream decompression error:', err);
        res.status(500).json({ error: 'Stream decompression failed', message: err.message });
    }
});

app.post('/api/compress/chunk', async (req, res) => {
    try {
        const { chunks, mode = 'parallel' } = req.body;

        if (!Array.isArray(chunks) || chunks.length === 0) {
            return res.status(400).json({ error: 'No chunks provided' });
        }

        const startTime = Date.now();
        let compressedChunks;

        if (mode === 'parallel') {
            compressedChunks = chunks.map(chunk => {
                const buf = Buffer.from(chunk, 'base64');
                return lz4.compressChunk(buf).toString('base64');
            });
        } else {
            compressedChunks = [];
            for (const chunk of chunks) {
                const buf = Buffer.from(chunk, 'base64');
                compressedChunks.push(lz4.compressChunk(buf).toString('base64'));
            }
        }

        const duration = Date.now() - startTime;
        const totalIn = chunks.reduce((sum, c) => sum + Buffer.from(c, 'base64').length, 0);
        const totalOut = compressedChunks.reduce((sum, c) => sum + Buffer.from(c, 'base64').length, 0);

        metrics.recordCompression('lz4-wasm-chunk', totalIn, totalOut, duration);

        res.json({
            success: true,
            chunkCount: chunks.length,
            totalOriginalSize: totalIn,
            totalCompressedSize: totalOut,
            ratio: (totalIn / totalOut).toFixed(2),
            durationMs: duration,
            compressedChunks
        });
    } catch (err) {
        console.error('Chunk compression error:', err);
        res.status(500).json({ error: 'Chunk compression failed', message: err.message });
    }
});

app.post('/api/decompress/chunk', async (req, res) => {
    try {
        const { chunks, outputSizes, mode = 'parallel' } = req.body;

        if (!Array.isArray(chunks) || chunks.length === 0) {
            return res.status(400).json({ error: 'No chunks provided' });
        }

        const startTime = Date.now();
        let decompressedChunks;

        if (mode === 'parallel') {
            decompressedChunks = chunks.map((chunk, i) => {
                const buf = Buffer.from(chunk, 'base64');
                const outputSize = outputSizes ? outputSizes[i] : null;
                return lz4.decompressChunk(buf, outputSize).toString('base64');
            });
        } else {
            decompressedChunks = [];
            for (let i = 0; i < chunks.length; i++) {
                const buf = Buffer.from(chunks[i], 'base64');
                const outputSize = outputSizes ? outputSizes[i] : null;
                decompressedChunks.push(lz4.decompressChunk(buf, outputSize).toString('base64'));
            }
        }

        const duration = Date.now() - startTime;
        const totalIn = chunks.reduce((sum, c) => sum + Buffer.from(c, 'base64').length, 0);
        const totalOut = decompressedChunks.reduce((sum, c) => sum + Buffer.from(c, 'base64').length, 0);

        metrics.recordDecompression('lz4-wasm-chunk', totalIn, totalOut, duration);

        res.json({
            success: true,
            chunkCount: chunks.length,
            totalCompressedSize: totalIn,
            totalDecompressedSize: totalOut,
            durationMs: duration,
            decompressedChunks
        });
    } catch (err) {
        console.error('Chunk decompression error:', err);
        res.status(500).json({ error: 'Chunk decompression failed', message: err.message });
    }
});

app.get('/api/benchmark', async (req, res) => {
    try {
        const sizeMB = parseInt(req.query.size) || 1;
        const results = await benchmark.runFullBenchmark(sizeMB);
        
        res.json({
            success: true,
            ...results
        });
    } catch (err) {
        console.error('Benchmark error:', err);
        res.status(500).json({ error: 'Benchmark failed', message: err.message });
    }
});

app.get('/api/benchmark/text', async (req, res) => {
    try {
        const sizeMB = parseInt(req.query.size) || 1;
        const results = await benchmark.runFullBenchmark(sizeMB);
        const text = benchmark.formatResults(results);
        
        res.set('Content-Type', 'text/plain');
        res.send(text);
    } catch (err) {
        console.error('Benchmark error:', err);
        res.status(500).json({ error: 'Benchmark failed', message: err.message });
    }
});

app.post('/api/dictionary/train', async (req, res) => {
    try {
        const dict = await dictionary.trainDictionary();
        
        if (dict) {
            metrics.setDictionarySize(dict.length);
            lz4.setDictionary(dict);
            
            res.json({
                success: true,
                dictionarySize: dict.length,
                message: 'Dictionary trained and loaded successfully'
            });
        } else {
            res.json({
                success: false,
                message: 'No history data available for training'
            });
        }
    } catch (err) {
        console.error('Dictionary training error:', err);
        res.status(500).json({ error: 'Dictionary training failed', message: err.message });
    }
});

app.get('/api/dictionary/status', async (req, res) => {
    try {
        const dict = dictionary.getDictionary();
        const historyCount = await dictionary.getHistoryCount();
        
        res.json({
            success: true,
            hasDictionary: !!dict,
            dictionarySize: dict ? dict.length : 0,
            historyFiles: historyCount,
            maxHistoryFiles: 100
        });
    } catch (err) {
        console.error('Dictionary status error:', err);
        res.status(500).json({ error: 'Failed to get dictionary status', message: err.message });
    }
});

app.post('/api/dictionary/load', async (req, res) => {
    try {
        const { dictionary: dictData } = req.body;
        
        if (!dictData) {
            return res.status(400).json({ error: 'No dictionary data provided' });
        }
        
        const dictBuffer = Buffer.from(dictData, 'base64');
        lz4.setDictionary(dictBuffer);
        metrics.setDictionarySize(dictBuffer.length);
        
        res.json({
            success: true,
            dictionarySize: dictBuffer.length,
            message: 'Dictionary loaded successfully'
        });
    } catch (err) {
        console.error('Dictionary load error:', err);
        res.status(500).json({ error: 'Failed to load dictionary', message: err.message });
    }
});

async function startServer() {
    console.log('Initializing LZ4 WASM module...');
    await lz4.init();
    console.log('LZ4 WASM module initialized');

    console.log('Connecting to Redis...');
    await dictionary.connect();
    console.log('Redis connection established');

    const dict = dictionary.getDictionary();
    if (dict) {
        lz4.setDictionary(dict);
        metrics.setDictionarySize(dict.length);
        console.log(`Dictionary loaded, size: ${dict.length} bytes`);
    }

    const historyCount = await dictionary.getHistoryCount();
    metrics.setTrainingFilesCount(historyCount);

    app.listen(PORT, () => {
        console.log(`\nLZ4 Compression Service running on port ${PORT}`);
        console.log(`----------------------------------------`);
        console.log(`Health check: http://localhost:${PORT}/health`);
        console.log(`Metrics: http://localhost:${PORT}/metrics`);
        console.log(`API Documentation:`);
        console.log(`  POST /api/compress - Compress data`);
        console.log(`  POST /api/decompress - Decompress data`);
        console.log(`  POST /api/compress/stream - Stream compression`);
        console.log(`  POST /api/decompress/stream - Stream decompression`);
        console.log(`  GET /api/benchmark - Run performance benchmark`);
        console.log(`  POST /api/dictionary/train - Train compression dictionary`);
        console.log(`  GET /api/dictionary/status - Dictionary status`);
        console.log(`----------------------------------------\n`);
    });
}

startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
