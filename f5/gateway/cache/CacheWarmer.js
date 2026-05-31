const schedule = require('node-schedule');
const { queryPatternAnalyzer } = require('./QueryPatternAnalyzer');
const { redisCacheManager } = require('./RedisCacheManager');
const { fetch } = require('@apollo/utils.fetch');

class CacheWarmer {
  constructor() {
    this.isRunning = false;
    this.warmupJob = null;
    this.warmupHistory = [];
    this.gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:4000/graphql';
    this.commonVariables = this.generateCommonVariables();
  }

  start() {
    console.log('[CacheWarmer] Starting cache warmer service...');
    
    const warmupTime = process.env.WARMUP_TIME || '0 3 * * *';
    console.log(`[CacheWarmer] Scheduled warmup time: ${warmupTime}`);
    
    this.warmupJob = schedule.scheduleJob(warmupTime, async () => {
      console.log('[CacheWarmer] Starting scheduled warmup...');
      await this.performWarmup();
    });

    redisCacheManager.connect().then(() => {
      console.log('[CacheWarmer] Redis cache manager connected');
    });

    console.log('[CacheWarmer] Cache warmer service started');
  }

  async performWarmup(topN = 10, days = 7) {
    if (this.isRunning) {
      console.log('[CacheWarmer] Warmup already in progress, skipping...');
      return null;
    }

    this.isRunning = true;
    const startTime = Date.now();
    const results = {
      startedAt: new Date().toISOString(),
      totalQueries: 0,
      successful: 0,
      failed: 0,
      warmedQueries: [],
    };

    try {
      const topQueries = queryPatternAnalyzer.getTopQueries(topN, days);
      
      if (topQueries.length === 0) {
        console.log('[CacheWarmer] No query patterns found for warmup');
        return results;
      }

      console.log(`[CacheWarmer] Found ${topQueries.length} top queries to warmup`);

      for (const queryInfo of topQueries) {
        const warmupResult = await this.warmupQuery(queryInfo);
        results.warmedQueries.push(warmupResult);
        results.totalQueries++;
        
        if (warmupResult.success) {
          results.successful++;
        } else {
          results.failed++;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      results.duration = Date.now() - startTime;
      results.completedAt = new Date().toISOString();

      this.warmupHistory.unshift(results);
      if (this.warmupHistory.length > 10) {
        this.warmupHistory.pop();
      }

      console.log(`[CacheWarmer] Warmup completed: ${results.successful}/${results.totalQueries} successful in ${results.duration}ms`);

    } catch (e) {
      console.error('[CacheWarmer] Warmup error:', e.message);
      results.error = e.message;
    }

    this.isRunning = false;
    return results;
  }

  async warmupQuery(queryInfo) {
    const ttl = queryPatternAnalyzer.calculateDynamicTTL(queryInfo.types);
    
    const variables = this.getVariablesForQuery(queryInfo);

    const result = {
      operationName: queryInfo.operationName,
      types: queryInfo.types,
      count: queryInfo.count,
      avgDuration: queryInfo.avgDuration,
      recommendedTTL: ttl,
      success: false,
    };

    try {
      const query = this.generateQueryFromInfo(queryInfo);
      
      const response = await fetch(this.gatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables,
          operationName: queryInfo.operationName,
        }),
      });

      const data = await response.json();
      
      if (data.errors) {
        result.error = data.errors.map(e => e.message).join(', ');
      } else {
        const cached = await redisCacheManager.warmupEntry(
          query,
          variables,
          data.data,
          ttl,
          {
            operationName: queryInfo.operationName,
            types: queryInfo.types,
            source: 'warmup',
            originalAvgDuration: queryInfo.avgDuration,
          }
        );
        
        result.success = cached;
        result.dataSize = JSON.stringify(data.data).length;
      }
    } catch (e) {
      result.error = e.message;
    }

    return result;
  }

  generateCommonVariables() {
    return {
      user: { id: '1' },
      users: { limit: 10, offset: 0 },
      order: { id: '1' },
      orders: { limit: 10, offset: 0 },
      ordersByUser: { userId: '1', limit: 10 },
      product: { id: '1' },
      products: { limit: 20, offset: 0, category: 'electronics' },
      searchProducts: { query: 'test' },
      featuredProducts: { limit: 10 },
      recentOrders: { limit: 20 },
    };
  }

  getVariablesForQuery(queryInfo) {
    const variables = {};
    
    queryInfo.fields.forEach(field => {
      if (this.commonVariables[field]) {
        Object.assign(variables, this.commonVariables[field]);
      }
    });

    return variables;
  }

  generateQueryFromInfo(queryInfo) {
    const fields = queryInfo.fields.slice(0, 5).join('\n');
    
    if (queryInfo.operationName === 'GetUserWithOrders') {
      return `
        query GetUserWithOrders($userId: ID!) {
          user(id: $userId) {
            id
            name
            email
            orders {
              id
              status
              total
              items {
                product {
                  id
                  name
                  price
                }
                quantity
              }
            }
          }
        }
      `;
    }

    if (queryInfo.operationName === 'GetProducts') {
      return `
        query GetProducts($limit: Int, $offset: Int) {
          products(limit: $limit, offset: $offset) {
            id
            name
            price
            category
            stock
          }
        }
      `;
    }

    if (queryInfo.types.includes('Product')) {
      return `
        query GetProducts {
          products(limit: 20) {
            id
            name
            price
            category
            stock
          }
        }
      `;
    }

    if (queryInfo.types.includes('Order')) {
      return `
        query GetOrders {
          recentOrders(limit: 20) {
            id
            status
            total
            userId
          }
        }
      `;
    }

    return `
      query GetData {
        ${fields}
      }
    `;
  }

  async triggerManualWarmup(topN = 10) {
    console.log(`[CacheWarmer] Manual warmup triggered for top ${topN} queries`);
    return this.performWarmup(topN, 7);
  }

  getWarmupHistory(limit = 10) {
    return this.warmupHistory.slice(0, limit);
  }

  getNextWarmupTime() {
    if (!this.warmupJob) {
      return null;
    }
    return this.warmupJob.nextInvocation().toString();
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      nextWarmup: this.getNextWarmupTime(),
      historyCount: this.warmupHistory.length,
      lastWarmup: this.warmupHistory[0] || null,
    };
  }

  stop() {
    if (this.warmupJob) {
      this.warmupJob.cancel();
      console.log('[CacheWarmer] Warmup job cancelled');
    }
  }
}

const cacheWarmer = new CacheWarmer();

module.exports = { cacheWarmer, CacheWarmer };
