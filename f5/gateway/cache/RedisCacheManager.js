const { createClient } = require('redis');
const crypto = require('crypto');

class RedisCacheManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.cacheStats = {
      hits: 0,
      misses: 0,
      warmups: 0,
      evictions: 0,
    };
  }

  async connect() {
    try {
      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        password: process.env.REDIS_PASSWORD,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              return new Error('Too many retries');
            }
            return Math.min(retries * 50, 500);
          },
        },
      });

      this.client.on('error', (err) => {
        console.error('[RedisCache] Redis Client Error:', err.message);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('[RedisCache] Redis Client Connected');
        this.isConnected = true;
      });

      this.client.on('end', () => {
        console.log('[RedisCache] Redis Client Disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
      return true;
    } catch (e) {
      console.error('[RedisCache] Failed to connect to Redis:', e.message);
      return false;
    }
  }

  generateCacheKey(query, variables = {}) {
    const normalizedQuery = query
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    
    const normalizedVariables = JSON.stringify(variables, Object.keys(variables).sort());
    
    const hash = crypto
      .createHash('md5')
      .update(normalizedQuery + normalizedVariables)
      .digest('hex');
    
    return `gql:cache:${hash}`;
  }

  async get(query, variables = {}) {
    if (!this.isConnected) {
      return null;
    }

    try {
      const key = this.generateCacheKey(query, variables);
      const data = await this.client.get(key);
      
      if (data) {
        this.cacheStats.hits++;
        return JSON.parse(data);
      }
      
      this.cacheStats.misses++;
      return null;
    } catch (e) {
      console.error('[RedisCache] Get error:', e.message);
      return null;
    }
  }

  async set(query, variables = {}, data, ttl = 3600) {
    if (!this.isConnected) {
      return false;
    }

    try {
      const key = this.generateCacheKey(query, variables);
      const value = JSON.stringify(data);
      
      await this.client.setEx(key, ttl, value);
      return true;
    } catch (e) {
      console.error('[RedisCache] Set error:', e.message);
      return false;
    }
  }

  async setByKey(key, data, ttl = 3600) {
    if (!this.isConnected) {
      return false;
    }

    try {
      const value = JSON.stringify(data);
      await this.client.setEx(key, ttl, value);
      return true;
    } catch (e) {
      console.error('[RedisCache] SetByKey error:', e.message);
      return false;
    }
  }

  async getByKey(key) {
    if (!this.isConnected) {
      return null;
    }

    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('[RedisCache] GetByKey error:', e.message);
      return null;
    }
  }

  async delete(query, variables = {}) {
    if (!this.isConnected) {
      return false;
    }

    try {
      const key = this.generateCacheKey(query, variables);
      await this.client.del(key);
      this.cacheStats.evictions++;
      return true;
    } catch (e) {
      console.error('[RedisCache] Delete error:', e.message);
      return false;
    }
  }

  async deleteByPattern(pattern) {
    if (!this.isConnected) {
      return 0;
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
        this.cacheStats.evictions += keys.length;
      }
      return keys.length;
    } catch (e) {
      console.error('[RedisCache] DeleteByPattern error:', e.message);
      return 0;
    }
  }

  async invalidateServiceCache(serviceName) {
    return this.deleteByPattern(`gql:cache:*:${serviceName}:*`);
  }

  async invalidateTypeCache(typeName) {
    return this.deleteByPattern(`gql:cache:*:${typeName}:*`);
  }

  async getStats() {
    const hitRate = this.cacheStats.hits + this.cacheStats.misses > 0
      ? (this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100).toFixed(2)
      : 0;

    let dbStats = {};
    if (this.isConnected) {
      try {
        const info = await this.client.info();
        const usedMemory = info.match(/used_memory_human:([^\r\n]+)/)?.[1];
        const keysCount = info.match(/db\d+:keys=(\d+)/)?.[1];
        
        dbStats = {
          usedMemory,
          keysCount: keysCount || '0',
        };
      } catch (e) {}
    }

    return {
      ...this.cacheStats,
      hitRate: `${hitRate}%`,
      ...dbStats,
      isConnected: this.isConnected,
    };
  }

  async clearStats() {
    this.cacheStats = {
      hits: 0,
      misses: 0,
      warmups: 0,
      evictions: 0,
    };
  }

  async getCacheSize() {
    if (!this.isConnected) {
      return 0;
    }

    try {
      const keys = await this.client.keys('gql:cache:*');
      return keys.length;
    } catch (e) {
      return 0;
    }
  }

  async warmupEntry(query, variables, data, ttl, metadata = {}) {
    const key = this.generateCacheKey(query, variables);
    
    const entry = {
      data,
      metadata: {
        ...metadata,
        warmedAt: new Date().toISOString(),
        ttl,
      },
    };

    const success = await this.setByKey(key, entry, ttl);
    if (success) {
      this.cacheStats.warmups++;
    }
    return success;
  }

  async storeQueryPattern(queryHash, metadata) {
    if (!this.isConnected) {
      return false;
    }

    try {
      const key = `gql:pattern:${queryHash}`;
      const existing = await this.getByKey(key) || { count: 0, history: [] };
      
      existing.count++;
      existing.lastSeen = new Date().toISOString();
      existing.history.push({
        timestamp: new Date().toISOString(),
        duration: metadata.duration,
      });
      
      if (existing.history.length > 100) {
        existing.history = existing.history.slice(-100);
      }
      
      existing.avgDuration = existing.history.reduce((sum, h) => sum + h.duration, 0) / existing.history.length;
      
      await this.setByKey(key, existing, 7 * 24 * 60 * 60);
      return true;
    } catch (e) {
      console.error('[RedisCache] StoreQueryPattern error:', e.message);
      return false;
    }
  }

  async getTopQueries(limit = 10, days = 7) {
    if (!this.isConnected) {
      return [];
    }

    try {
      const keys = await this.client.keys('gql:pattern:*');
      const patterns = [];
      
      for (const key of keys) {
        const pattern = await this.getByKey(key);
        if (pattern) {
          patterns.push({
            hash: key.replace('gql:pattern:', ''),
            ...pattern,
          });
        }
      }
      
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      
      return patterns
        .filter(p => new Date(p.lastSeen) > cutoffDate)
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    } catch (e) {
      console.error('[RedisCache] GetTopQueries error:', e.message);
      return [];
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
    }
  }
}

const redisCacheManager = new RedisCacheManager();

module.exports = { redisCacheManager, RedisCacheManager };
