const client = require('prom-client');

const register = new client.Registry();

client.collectDefaultMetrics({ register });

const compressionDuration = new client.Histogram({
    name: 'lz4_compression_duration_seconds',
    help: 'Duration of LZ4 compression operations',
    labelNames: ['type', 'algorithm'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
});

const decompressionDuration = new client.Histogram({
    name: 'lz4_decompression_duration_seconds',
    help: 'Duration of LZ4 decompression operations',
    labelNames: ['type', 'algorithm'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
});

const compressionThroughput = new client.Gauge({
    name: 'lz4_compression_throughput_bytes_per_second',
    help: 'Compression throughput in bytes per second',
    labelNames: ['algorithm']
});

const decompressionThroughput = new client.Gauge({
    name: 'lz4_decompression_throughput_bytes_per_second',
    help: 'Decompression throughput in bytes per second',
    labelNames: ['algorithm']
});

const compressionRatio = new client.Gauge({
    name: 'lz4_compression_ratio',
    help: 'Compression ratio (uncompressed size / compressed size)',
    labelNames: ['algorithm']
});

const totalCompressedBytes = new client.Counter({
    name: 'lz4_total_compressed_bytes',
    help: 'Total bytes compressed',
    labelNames: ['algorithm']
});

const totalDecompressedBytes = new client.Counter({
    name: 'lz4_total_decompressed_bytes',
    help: 'Total bytes decompressed',
    labelNames: ['algorithm']
});

const activeConnections = new client.Gauge({
    name: 'lz4_active_connections',
    help: 'Number of active connections'
});

const dictionarySize = new client.Gauge({
    name: 'lz4_dictionary_size_bytes',
    help: 'Size of the compression dictionary in bytes'
});

const trainingFilesCount = new client.Gauge({
    name: 'lz4_training_files_count',
    help: 'Number of files used for dictionary training'
});

register.registerMetric(compressionDuration);
register.registerMetric(decompressionDuration);
register.registerMetric(compressionThroughput);
register.registerMetric(decompressionThroughput);
register.registerMetric(compressionRatio);
register.registerMetric(totalCompressedBytes);
register.registerMetric(totalDecompressedBytes);
register.registerMetric(activeConnections);
register.registerMetric(dictionarySize);
register.registerMetric(trainingFilesCount);

class Metrics {
    constructor() {
        this.register = register;
    }

    startCompressionTimer(type, algorithm) {
        const end = compressionDuration.startTimer({ type, algorithm });
        return end;
    }

    startDecompressionTimer(type, algorithm) {
        const end = decompressionDuration.startTimer({ type, algorithm });
        return end;
    }

    recordCompression(algorithm, uncompressedSize, compressedSize, durationMs) {
        const ratio = uncompressedSize / compressedSize;
        const throughput = uncompressedSize / (durationMs / 1000);

        compressionRatio.set({ algorithm }, ratio);
        compressionThroughput.set({ algorithm }, throughput);
        totalCompressedBytes.inc({ algorithm }, uncompressedSize);
    }

    recordDecompression(algorithm, compressedSize, decompressedSize, durationMs) {
        const throughput = decompressedSize / (durationMs / 1000);

        decompressionThroughput.set({ algorithm }, throughput);
        totalDecompressedBytes.inc({ algorithm }, decompressedSize);
    }

    incrementActiveConnections() {
        activeConnections.inc();
    }

    decrementActiveConnections() {
        activeConnections.dec();
    }

    setDictionarySize(size) {
        dictionarySize.set(size);
    }

    setTrainingFilesCount(count) {
        trainingFilesCount.set(count);
    }

    async getMetrics() {
        return this.register.metrics();
    }

    getContentType() {
        return this.register.contentType;
    }
}

module.exports = new Metrics();
