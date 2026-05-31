const Redis = require('ioredis');
const crypto = require('crypto');

const REDIS_KEY = 'lz4:compression:dictionary';
const HISTORY_KEY = 'lz4:compression:history';
const MAX_HISTORY_FILES = 100;
const DICT_SIZE = 65536;

class DictionaryManager {
    constructor() {
        this.redis = null;
        this.currentDictionary = null;
        this.isConnected = false;
    }

    async connect(redisOptions = {}) {
        try {
            this.redis = new Redis({
                host: redisOptions.host || 'localhost',
                port: redisOptions.port || 6379,
                password: redisOptions.password,
                db: redisOptions.db || 0,
                lazyConnect: true
            });
            
            await this.redis.connect();
            this.isConnected = true;
            
            await this.loadDictionary();
            await this.pruneHistory();
            
            return true;
        } catch (err) {
            console.warn('Redis connection failed, using in-memory dictionary:', err.message);
            this.isConnected = false;
            return false;
        }
    }

    async loadDictionary() {
        if (!this.isConnected) return null;
        
        try {
            const dictData = await this.redis.get(REDIS_KEY);
            if (dictData) {
                this.currentDictionary = Buffer.from(dictData, 'base64');
                console.log(`Loaded dictionary from Redis, size: ${this.currentDictionary.length} bytes`);
                return this.currentDictionary;
            }
        } catch (err) {
            console.error('Error loading dictionary:', err);
        }
        
        return null;
    }

    async saveDictionary(dict) {
        this.currentDictionary = dict;
        
        if (!this.isConnected) return false;
        
        try {
            await this.redis.set(REDIS_KEY, dict.toString('base64'));
            console.log(`Saved dictionary to Redis, size: ${dict.length} bytes`);
            return true;
        } catch (err) {
            console.error('Error saving dictionary:', err);
            return false;
        }
    }

    async addToHistory(data) {
        if (!this.isConnected) return;
        
        try {
            const hash = crypto.createHash('sha256').update(data).digest('hex');
            const timestamp = Date.now();
            
            await this.redis.zadd(HISTORY_KEY, timestamp, hash);
            await this.redis.set(`lz4:history:${hash}`, data.toString('base64'));
            
            await this.pruneHistory();
        } catch (err) {
            console.error('Error adding to history:', err);
        }
    }

    async pruneHistory() {
        if (!this.isConnected) return;
        
        try {
            const count = await this.redis.zcard(HISTORY_KEY);
            if (count > MAX_HISTORY_FILES) {
                const removeCount = count - MAX_HISTORY_FILES;
                const toRemove = await this.redis.zrange(HISTORY_KEY, 0, removeCount - 1);
                
                for (const hash of toRemove) {
                    await this.redis.del(`lz4:history:${hash}`);
                }
                
                await this.redis.zremrangebyrank(HISTORY_KEY, 0, removeCount - 1);
                console.log(`Pruned ${removeCount} old history entries`);
            }
        } catch (err) {
            console.error('Error pruning history:', err);
        }
    }

    async getHistory() {
        if (!this.isConnected) return [];
        
        try {
            const hashes = await this.redis.zrange(HISTORY_KEY, 0, -1);
            const history = [];
            
            for (const hash of hashes) {
                const data = await this.redis.get(`lz4:history:${hash}`);
                if (data) {
                    history.push(Buffer.from(data, 'base64'));
                }
            }
            
            return history;
        } catch (err) {
            console.error('Error getting history:', err);
            return [];
        }
    }

    async trainDictionary() {
        const history = await this.getHistory();
        
        if (history.length === 0) {
            console.log('No history data for dictionary training');
            return null;
        }
        
        console.log(`Training dictionary from ${history.length} files...`);
        
        const allData = Buffer.concat(history);
        
        if (allData.length <= DICT_SIZE) {
            this.currentDictionary = allData;
        } else {
            const samples = [];
            const step = Math.floor(allData.length / 1000);
            
            for (let i = 0; i < allData.length - 64; i += step) {
                samples.push(allData.slice(i, i + 64));
            }
            
            const freq = new Map();
            for (const sample of samples) {
                for (let i = 0; i < sample.length - 4; i++) {
                    const key = sample.readUInt32BE(i);
                    freq.set(key, (freq.get(key) || 0) + 1);
                }
            }
            
            const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
            const dictParts = [];
            let totalSize = 0;
            
            for (const [key] of sorted) {
                if (totalSize >= DICT_SIZE) break;
                const buf = Buffer.alloc(4);
                buf.writeUInt32BE(key);
                dictParts.push(buf);
                totalSize += 4;
            }
            
            this.currentDictionary = Buffer.concat(dictParts);
        }
        
        await this.saveDictionary(this.currentDictionary);
        console.log(`Dictionary trained, size: ${this.currentDictionary.length} bytes`);
        
        return this.currentDictionary;
    }

    getDictionary() {
        return this.currentDictionary;
    }

    async getHistoryCount() {
        if (!this.isConnected) return 0;
        try {
            return await this.redis.zcard(HISTORY_KEY);
        } catch {
            return 0;
        }
    }

    async disconnect() {
        if (this.redis) {
            await this.redis.disconnect();
            this.isConnected = false;
        }
    }
}

module.exports = new DictionaryManager();
