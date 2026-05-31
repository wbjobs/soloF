const adaptive = require('../src/adaptive_compression');

function generateLogData(size = 10000) {
    const logs = [];
    const levels = ['INFO', 'WARN', 'ERROR', 'DEBUG'];
    const messages = [
        'User authenticated successfully',
        'Database connection established',
        'Request processed in 23ms',
        'Cache hit rate: 85%',
        'Memory usage: 512MB'
    ];

    for (let i = 0; i < 100; i++) {
        const date = new Date(Date.now() - i * 60000).toISOString();
        const level = levels[Math.floor(Math.random() * levels.length)];
        const message = messages[Math.floor(Math.random() * messages.length)];
        logs.push(`[${date}] [${level}] ${message}`);
    }

    return Buffer.from(logs.join('\n'));
}

function generateJsonData() {
    const data = [];
    for (let i = 0; i < 100; i++) {
        data.push({
            id: i,
            name: `User ${i}`,
            email: `user${i}@example.com`,
            createdAt: new Date().toISOString(),
            score: Math.random() * 1000
        });
    }
    return Buffer.from(JSON.stringify(data));
}

function generateBinaryData(size = 10000) {
    const buf = Buffer.alloc(size);
    for (let i = 0; i < size; i++) {
        buf[i] = Math.floor(Math.random() * 256);
    }
    return buf;
}

function generateTextData() {
    const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog',
        'hello', 'world', 'test', 'data', 'compression', 'algorithm', 'performance'];
    const lines = [];
    for (let i = 0; i < 500; i++) {
        const line = Array(10).fill(0).map(() =>
            words[Math.floor(Math.random() * words.length)]
        ).join(' ');
        lines.push(line);
    }
    return Buffer.from(lines.join('\n'));
}

function runTestCase(name, buffer, filename = null, options = {}) {
    console.log(`\n=== ${name} ===`);
    console.log(`File size: ${buffer.length} bytes`);
    console.log(`Filename hint: ${filename || '(none)'}`);

    const decision = adaptive.decideCompression(buffer, { filename, ...options });
    const explanation = adaptive.explainDecision(decision);

    console.log(`\n📁 File Type: ${explanation.file.type}`);
    console.log(`🎯 Type Confidence: ${explanation.file.typeConfidence}`);
    console.log(`\n⚡ Compression:`);
    console.log(`  Level: ${explanation.compression.level} (${explanation.compression.levelName})`);
    console.log(`  Estimated Ratio: ${explanation.compression.estimatedRatio}`);
    console.log(`  Estimated Speed: ${explanation.compression.estimatedSpeed}`);
    console.log(`\n📚 Dictionary:`);
    console.log(`  Strategy: ${explanation.dictionary.strategy}`);
    console.log(`  Use Dictionary: ${explanation.dictionary.useDictionary}`);
    console.log(`  Size: ${explanation.dictionary.size} bytes`);
    console.log(`  Train Dictionary: ${explanation.dictionary.train}`);
    console.log(`\n🔄 Processing:`);
    console.log(`  Chunked: ${explanation.processing.chunked}`);
    console.log(`  Streaming: ${explanation.processing.streaming}`);
    if (explanation.processing.chunked) {
        console.log(`  Chunk Size: ${explanation.processing.chunkSize} bytes`);
    }
    console.log(`\n💡 Reasoning:`);
    explanation.reasoning.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r}`);
    });
    console.log(`\n✅ Overall Confidence: ${explanation.overallConfidence}`);

    return decision;
}

console.log('='.repeat(70));
console.log('ADAPTIVE COMPRESSION TEST SUITE');
console.log('='.repeat(70));

const testCases = [
    {
        name: 'Log File (server.log)',
        buffer: generateLogData(),
        filename: 'server.log'
    },
    {
        name: 'JSON Data (data.json)',
        buffer: generateJsonData(),
        filename: 'data.json'
    },
    {
        name: 'Text File (document.txt)',
        buffer: generateTextData(),
        filename: 'document.txt'
    },
    {
        name: 'Binary Data (random.bin)',
        buffer: generateBinaryData(),
        filename: 'random.bin'
    },
    {
        name: 'Tiny File (config.json)',
        buffer: Buffer.from(JSON.stringify({ host: 'localhost', port: 3000, debug: true })),
        filename: 'config.json'
    },
    {
        name: 'Large Text File',
        buffer: Buffer.concat(Array(50).fill(generateTextData())),
        filename: 'large_document.txt'
    },
    {
        name: 'Log File with Speed Preference',
        buffer: generateLogData(),
        filename: 'server.log',
        options: { preferSpeed: true }
    },
    {
        name: 'Log File with Ratio Preference',
        buffer: generateLogData(),
        filename: 'server.log',
        options: { preferRatio: true }
    }
];

testCases.forEach(tc => runTestCase(tc.name, tc.buffer, tc.filename, tc.options));

console.log('\n' + '='.repeat(70));
console.log('TEST SUITE COMPLETE');
console.log('='.repeat(70));
