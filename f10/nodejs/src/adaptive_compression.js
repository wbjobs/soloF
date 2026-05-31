const crypto = require('crypto');

const FILE_TYPES = {
    TEXT: 'text',
    BINARY: 'binary',
    LOG: 'log',
    JSON: 'json',
    XML: 'xml',
    IMAGE: 'image',
    ARCHIVE: 'archive',
    EXECUTABLE: 'executable'
};

const COMPRESSION_LEVELS = {
    FASTEST: 1,
    FAST: 3,
    BALANCED: 6,
    GOOD: 9,
    BEST: 12
};

const DICTIONARY_STRATEGIES = {
    NONE: 'none',
    SMALL: 'small',
    MEDIUM: 'medium',
    LARGE: 'large',
    ADAPTIVE: 'adaptive'
};

const MAGIC_NUMBERS = {
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/gif': [0x47, 0x49, 0x46],
    'application/zip': [0x50, 0x4B, 0x03, 0x04],
    'application/gzip': [0x1F, 0x8B],
    'application/pdf': [0x25, 0x50, 0x44, 0x46],
    'application/exe': [0x4D, 0x5A],
    'application/elf': [0x7F, 0x45, 0x4C, 0x46]
};

const LOG_PATTERNS = [
    /^\d{4}-\d{2}-\d{2}/,
    /^\[\d{4}-\d{2}-\d{2}/,
    /^\d{2}:\d{2}:\d{2}/,
    /ERROR|WARN|INFO|DEBUG|TRACE/,
    /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/
];

class FileTypeDetector {
    constructor(sampleSize = 4096) {
        this.sampleSize = sampleSize;
    }

    detect(buffer, filename = null) {
        const results = {
            type: null,
            confidence: 0,
            isText: false,
            isBinary: false,
            isLog: false,
            details: {},
            mimeType: null
        };

        const sample = buffer.slice(0, Math.min(this.sampleSize, buffer.length));
        const sampleStr = sample.toString('utf8', 0, Math.min(1000, sample.length));

        const magicResult = this.detectMagicNumber(sample);
        if (magicResult) {
            results.mimeType = magicResult;
            results.details.magicMatch = magicResult;
        }

        const textScore = this.calculateTextScore(sample, sampleStr);
        results.details.textScore = textScore;

        const logScore = this.calculateLogScore(sampleStr);
        results.details.logScore = logScore;

        const jsonScore = this.calculateJsonScore(sampleStr);
        results.details.jsonScore = jsonScore;

        const xmlScore = this.calculateXmlScore(sampleStr);
        results.details.xmlScore = xmlScore;

        if (results.mimeType && results.mimeType.startsWith('image/')) {
            results.type = FILE_TYPES.IMAGE;
            results.isBinary = true;
            results.confidence = 0.95;
        } else if (results.mimeType && (results.mimeType.includes('zip') || results.mimeType.includes('gzip'))) {
            results.type = FILE_TYPES.ARCHIVE;
            results.isBinary = true;
            results.confidence = 0.9;
        } else if (results.mimeType && (results.mimeType.includes('exe') || results.mimeType.includes('elf'))) {
            results.type = FILE_TYPES.EXECUTABLE;
            results.isBinary = true;
            results.confidence = 0.95;
        } else if (logScore > 0.5) {
            results.type = FILE_TYPES.LOG;
            results.isLog = true;
            results.isText = true;
            results.confidence = logScore;
        } else if (jsonScore > 0.7) {
            results.type = FILE_TYPES.JSON;
            results.isText = true;
            results.confidence = jsonScore;
        } else if (xmlScore > 0.5) {
            results.type = FILE_TYPES.XML;
            results.isText = true;
            results.confidence = xmlScore;
        } else if (textScore > 0.7) {
            results.type = FILE_TYPES.TEXT;
            results.isText = true;
            results.confidence = textScore;
        } else {
            results.type = FILE_TYPES.BINARY;
            results.isBinary = true;
            results.confidence = Math.max(0.5, 1 - textScore);
        }

        if (filename) {
            const extResults = this.checkExtension(filename);
            if (extResults.confidence > results.confidence) {
                results.type = extResults.type;
                results.confidence = extResults.confidence;
                results.isText = extResults.isText;
                results.isBinary = extResults.isBinary;
                results.isLog = extResults.isLog;
            }
        }

        return results;
    }

    detectMagicNumber(sample) {
        for (const [mimeType, magic] of Object.entries(MAGIC_NUMBERS)) {
            if (sample.length >= magic.length) {
                let match = true;
                for (let i = 0; i < magic.length; i++) {
                    if (sample[i] !== magic[i]) {
                        match = false;
                        break;
                    }
                }
                if (match) return mimeType;
            }
        }
        return null;
    }

    calculateTextScore(sample, sampleStr) {
        let textBytes = 0;
        const printableChars = new Set([9, 10, 13]);

        for (let i = 0; i < sample.length; i++) {
            const byte = sample[i];
            if ((byte >= 32 && byte <= 126) || printableChars.has(byte)) {
                textBytes++;
            }
        }

        const textRatio = textBytes / sample.length;

        let nullBytes = 0;
        for (let i = 0; i < sample.length; i++) {
            if (sample[i] === 0) nullBytes++;
        }

        if (nullBytes > sample.length * 0.1) {
            return 0;
        }

        return textRatio;
    }

    calculateLogScore(sampleStr) {
        let matches = 0;
        for (const pattern of LOG_PATTERNS) {
            if (pattern.test(sampleStr)) {
                matches++;
            }
        }
        return matches / LOG_PATTERNS.length;
    }

    calculateJsonScore(sampleStr) {
        const trimmed = sampleStr.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            return 0;
        }

        let braces = 0;
        let brackets = 0;
        let quotes = 0;

        for (const char of trimmed) {
            if (char === '{') braces++;
            if (char === '}') braces--;
            if (char === '[') brackets++;
            if (char === ']') brackets--;
            if (char === '"') quotes++;
        }

        const hasStructure = (braces === 0 || brackets === 0) && quotes > 0;
        const hasKeywords = /"[a-zA-Z_]+":/.test(trimmed);

        return (hasStructure ? 0.5 : 0) + (hasKeywords ? 0.3 : 0);
    }

    calculateXmlScore(sampleStr) {
        const trimmed = sampleStr.trim();
        const hasXmlDecl = trimmed.startsWith('<?xml');
        const hasOpenTag = /<[a-zA-Z_][a-zA-Z0-9_.-]*>/.test(trimmed);
        const hasCloseTag = /<\/[a-zA-Z_][a-zA-Z0-9_.-]*>/.test(trimmed);

        let score = 0;
        if (hasXmlDecl) score += 0.4;
        if (hasOpenTag) score += 0.3;
        if (hasCloseTag) score += 0.3;

        return score;
    }

    checkExtension(filename) {
        const ext = filename.toLowerCase().split('.').pop();

        const extensions = {
            text: ['txt', 'md', 'rst', 'csv', 'tsv', 'conf', 'cfg', 'ini', 'yaml', 'yml'],
            log: ['log', 'out', 'err', 'access', 'error', 'debug', 'trace'],
            json: ['json', 'jsonl', 'geojson'],
            xml: ['xml', 'html', 'xhtml', 'svg', 'rss', 'atom'],
            image: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'],
            archive: ['zip', 'gz', 'tar', 'bz2', 'xz', '7z', 'rar'],
            executable: ['exe', 'dll', 'so', 'bin', 'elf', 'dylib']
        };

        for (const [type, exts] of Object.entries(extensions)) {
            if (exts.includes(ext)) {
                return {
                    type: FILE_TYPES[type.toUpperCase()],
                    confidence: 0.85,
                    isText: ['text', 'log', 'json', 'xml'].includes(type),
                    isBinary: ['image', 'archive', 'executable'].includes(type),
                    isLog: type === 'log'
                };
            }
        }

        return { confidence: 0 };
    }
}

class CompressionLevelDecider {
    constructor() {
        this.fileTypeDetector = new FileTypeDetector();
        this.levelRatios = {};
    }

    decide(buffer, options = {}) {
        const {
            filename = null,
            history = null,
            preferSpeed = false,
            preferRatio = false,
            maxLevel = 12,
            minLevel = 1
        } = options;

        const decision = {
            level: COMPRESSION_LEVELS.BALANCED,
            levelName: 'BALANCED',
            strategy: DICTIONARY_STRATEGIES.MEDIUM,
            useDictionary: true,
            dictionarySize: 65536,
            trainDictionary: false,
            trainFromHistory: false,
            trainSampleSize: 0,
            chunked: false,
            chunkSize: 1024 * 1024,
            streaming: false,
            estimatedRatio: 2.0,
            estimatedSpeed: 100,
            confidence: 0.7,
            reasoning: [],
            fileType: null,
            fileSize: buffer.length
        };

        const fileType = this.fileTypeDetector.detect(buffer, filename);
        decision.fileType = fileType;
        decision.reasoning.push(`File type detected: ${fileType.type} (confidence: ${(fileType.confidence * 100).toFixed(0)}%)`);

        const sizeBucket = this.getSizeBucket(buffer.length);
        decision.reasoning.push(`File size bucket: ${sizeBucket}`);

        this.applySizeRules(decision, buffer.length, sizeBucket);
        this.applyFileTypeRules(decision, fileType);
        this.applyPreferenceRules(decision, preferSpeed, preferRatio);

        decision.level = Math.max(minLevel, Math.min(maxLevel, decision.level));
        decision.levelName = this.getLevelName(decision.level);

        if (history && history.length > 0) {
            this.applyHistoryRules(decision, history, fileType);
        }

        this.calculateEstimates(decision, fileType);
        decision.confidence = this.calculateConfidence(decision, fileType);

        return decision;
    }

    getSizeBucket(size) {
        if (size < 64 * 1024) return 'tiny';
        if (size < 512 * 1024) return 'small';
        if (size < 5 * 1024 * 1024) return 'medium';
        if (size < 50 * 1024 * 1024) return 'large';
        return 'huge';
    }

    getLevelName(level) {
        if (level <= 2) return 'FASTEST';
        if (level <= 4) return 'FAST';
        if (level <= 7) return 'BALANCED';
        if (level <= 10) return 'GOOD';
        return 'BEST';
    }

    applySizeRules(decision, size, sizeBucket) {
        switch (sizeBucket) {
            case 'tiny':
                decision.level = Math.max(decision.level, 9);
                decision.strategy = DICTIONARY_STRATEGIES.SMALL;
                decision.dictionarySize = 8192;
                decision.trainDictionary = true;
                decision.chunked = false;
                decision.reasoning.push('Tiny file (<64KB): Use higher compression level, small dictionary');
                break;
            case 'small':
                decision.level = Math.max(decision.level, 7);
                decision.strategy = DICTIONARY_STRATEGIES.MEDIUM;
                decision.dictionarySize = 32768;
                decision.trainDictionary = true;
                decision.chunked = false;
                decision.reasoning.push('Small file (<512KB): Balanced-high compression, medium dictionary');
                break;
            case 'medium':
                decision.level = Math.max(decision.level, 6);
                decision.strategy = DICTIONARY_STRATEGIES.MEDIUM;
                decision.dictionarySize = 65536;
                decision.chunked = false;
                decision.reasoning.push('Medium file (<5MB): Balanced compression, standard dictionary');
                break;
            case 'large':
                decision.level = Math.min(decision.level, 5);
                decision.strategy = DICTIONARY_STRATEGIES.LARGE;
                decision.dictionarySize = 131072;
                decision.chunked = true;
                decision.chunkSize = 4 * 1024 * 1024;
                decision.reasoning.push('Large file (<50MB): Lower compression level, larger dictionary, chunked mode');
                break;
            case 'huge':
                decision.level = Math.min(decision.level, 3);
                decision.strategy = DICTIONARY_STRATEGIES.ADAPTIVE;
                decision.dictionarySize = 262144;
                decision.chunked = true;
                decision.chunkSize = 8 * 1024 * 1024;
                decision.streaming = true;
                decision.reasoning.push('Huge file (>=50MB): Fastest compression, adaptive dictionary, streaming mode');
                break;
        }
    }

    applyFileTypeRules(decision, fileType) {
        const type = fileType.type;

        switch (type) {
            case FILE_TYPES.LOG:
                decision.level = Math.min(decision.level + 2, 12);
                decision.useDictionary = true;
                decision.trainDictionary = true;
                decision.trainSampleSize = 100;
                decision.reasoning.push('Log file: Use higher compression level with dictionary training for repeated patterns');
                break;
            case FILE_TYPES.TEXT:
                decision.level = Math.min(decision.level + 1, 12);
                decision.useDictionary = true;
                decision.reasoning.push('Text file: Slightly higher compression level, dictionary enabled');
                break;
            case FILE_TYPES.JSON:
            case FILE_TYPES.XML:
                decision.level = Math.min(decision.level + 2, 11);
                decision.useDictionary = true;
                decision.trainDictionary = true;
                decision.reasoning.push('Structured text (JSON/XML): Good compression potential with dictionary');
                break;
            case FILE_TYPES.BINARY:
                decision.level = Math.max(decision.level - 1, 1);
                decision.useDictionary = fileType.confidence < 0.8;
                decision.reasoning.push('Binary file: Use faster compression, dictionary only if format unknown');
                break;
            case FILE_TYPES.IMAGE:
            case FILE_TYPES.ARCHIVE:
            case FILE_TYPES.EXECUTABLE:
                decision.level = 2;
                decision.useDictionary = false;
                decision.trainDictionary = false;
                decision.reasoning.push('Already compressed format (image/archive/exe): Fastest level, no dictionary');
                break;
        }
    }

    applyPreferenceRules(decision, preferSpeed, preferRatio) {
        if (preferSpeed) {
            decision.level = Math.max(decision.level - 3, 1);
            decision.chunked = true;
            decision.streaming = true;
            decision.reasoning.push('Speed preference: Reduced level by 3, enabled streaming');
        }

        if (preferRatio) {
            decision.level = Math.min(decision.level + 2, 12);
            decision.trainDictionary = true;
            decision.reasoning.push('Ratio preference: Increased level by 2, forced dictionary training');
        }
    }

    applyHistoryRules(decision, history, fileType) {
        const similarFiles = history.filter(h => h.fileType === fileType.type);

        if (similarFiles.length >= 5) {
            const avgRatio = similarFiles.reduce((sum, f) => sum + f.ratio, 0) / similarFiles.length;
            decision.trainFromHistory = true;
            decision.trainSampleSize = Math.min(similarFiles.length, 100);
            decision.reasoning.push(`History: Found ${similarFiles.length} similar files, will train dictionary from history`);

            if (avgRatio > 3.5) {
                decision.level = Math.min(decision.level + 1, 12);
                decision.reasoning.push('History: Good average ratio detected, increasing level');
            } else if (avgRatio < 1.5) {
                decision.level = Math.max(decision.level - 2, 1);
                decision.reasoning.push('History: Poor average ratio detected, decreasing level for speed');
            }
        }
    }

    calculateEstimates(decision, fileType) {
        const baseRatios = {
            [FILE_TYPES.LOG]: 8.0,
            [FILE_TYPES.TEXT]: 4.0,
            [FILE_TYPES.JSON]: 3.5,
            [FILE_TYPES.XML]: 3.0,
            [FILE_TYPES.BINARY]: 2.0,
            [FILE_TYPES.IMAGE]: 1.05,
            [FILE_TYPES.ARCHIVE]: 1.01,
            [FILE_TYPES.EXECUTABLE]: 1.2
        };

        const baseSpeeds = {
            1: 450,
            3: 350,
            6: 250,
            9: 150,
            12: 80
        };

        const baseRatio = baseRatios[fileType.type] || 2.0;
        const levelFactor = 1 + (decision.level - 6) * 0.08;
        const dictFactor = decision.useDictionary ? 1.3 : 1.0;

        decision.estimatedRatio = baseRatio * levelFactor * dictFactor;

        const nearestLevel = Object.keys(baseSpeeds)
            .map(Number)
            .reduce((a, b) => Math.abs(b - decision.level) < Math.abs(a - decision.level) ? b : a);

        decision.estimatedSpeed = baseSpeeds[nearestLevel] * (decision.streaming ? 1.2 : 1.0);
    }

    calculateConfidence(decision, fileType) {
        let confidence = 0.5;
        confidence += fileType.confidence * 0.3;
        confidence += decision.level > 2 && decision.level < 11 ? 0.1 : 0;
        confidence += decision.dictionarySize === 65536 ? 0.1 : 0;

        return Math.min(1.0, confidence);
    }

    explain(decision) {
        return {
            summary: `Level ${decision.level} (${decision.levelName}) with ${decision.strategy} dictionary`,
            compression: {
                level: decision.level,
                levelName: decision.levelName,
                estimatedRatio: `${decision.estimatedRatio.toFixed(2)}x`,
                estimatedSpeed: `${decision.estimatedSpeed.toFixed(0)} MB/s`
            },
            dictionary: {
                strategy: decision.strategy,
                useDictionary: decision.useDictionary,
                size: decision.dictionarySize,
                train: decision.trainDictionary,
                trainFromHistory: decision.trainFromHistory,
                trainSampleSize: decision.trainSampleSize
            },
            processing: {
                chunked: decision.chunked,
                chunkSize: decision.chunkSize,
                streaming: decision.streaming
            },
            file: {
                type: decision.fileType.type,
                size: decision.fileSize,
                typeConfidence: `${(decision.fileType.confidence * 100).toFixed(0)}%`
            },
            reasoning: decision.reasoning,
            overallConfidence: `${(decision.confidence * 100).toFixed(0)}%`
        };
    }
}

const fileTypeDetector = new FileTypeDetector();
const decider = new CompressionLevelDecider();

module.exports = {
    FILE_TYPES,
    COMPRESSION_LEVELS,
    DICTIONARY_STRATEGIES,
    FileTypeDetector,
    CompressionLevelDecider,
    detectFileType: (buffer, filename) => fileTypeDetector.detect(buffer, filename),
    decideCompression: (buffer, options) => decider.decide(buffer, options),
    explainDecision: (decision) => decider.explain(decision)
};
