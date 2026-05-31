const DataLoader = require('dataloader');

class FederatedDataLoader {
  constructor() {
    this.loaders = new Map();
    this.batchMetrics = new Map();
  }

  getOrCreateLoader(serviceName, fieldName, batchLoadFn) {
    const key = `${serviceName}:${fieldName}`;
    
    if (!this.loaders.has(key)) {
      const loader = new DataLoader(async (keys) => {
        const startTime = Date.now();
        
        try {
          const results = await batchLoadFn(keys);
          const duration = Date.now() - startTime;
          
          this.recordBatchMetrics(key, keys.length, duration);
          
          return results;
        } catch (error) {
          console.error(`Batch load error for ${key}:`, error);
          return keys.map(() => error);
        }
      }, {
        maxBatchSize: 100,
        batchScheduleFn: (callback) => setTimeout(callback, 5),
      });
      
      this.loaders.set(key, loader);
    }
    
    return this.loaders.get(key);
  }

  recordBatchMetrics(key, batchSize, duration) {
    const existing = this.batchMetrics.get(key) || {
      totalBatches: 0,
      totalItems: 0,
      totalDuration: 0,
      maxBatchSize: 0,
    };
    
    existing.totalBatches++;
    existing.totalItems += batchSize;
    existing.totalDuration += duration;
    existing.maxBatchSize = Math.max(existing.maxBatchSize, batchSize);
    
    this.batchMetrics.set(key, existing);
  }

  clearAll() {
    this.loaders.forEach((loader) => loader.clearAll());
    this.loaders.clear();
  }

  getMetrics() {
    const metrics = {};
    
    this.batchMetrics.forEach((value, key) => {
      metrics[key] = {
        ...value,
        avgBatchSize: value.totalBatches > 0 ? Math.round(value.totalItems / value.totalBatches) : 0,
        avgDurationPerBatch: value.totalBatches > 0 ? Math.round(value.totalDuration / value.totalBatches) : 0,
      };
    });
    
    return metrics;
  }
}

const federatedDataLoader = new FederatedDataLoader();

module.exports = { federatedDataLoader, FederatedDataLoader };
