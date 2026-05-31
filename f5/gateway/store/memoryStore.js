class QueryStore {
  constructor(maxSize = 1000) {
    this.queries = [];
    this.maxSize = maxSize;
    this.fingerprintCounts = new Map();
  }

  add(query) {
    this.queries.unshift(query);
    
    const fingerprint = query.queryFingerprint || query.queryHash;
    this.fingerprintCounts.set(
      fingerprint, 
      (this.fingerprintCounts.get(fingerprint) || 0) + 1
    );
    
    if (this.queries.length > this.maxSize) {
      this.queries.pop();
    }
  }

  getAll(options = {}) {
    let result = [...this.queries];
    
    if (options.type) {
      result = result.filter(q => q.type === options.type);
    }
    
    if (options.minDuration) {
      result = result.filter(q => q.duration >= options.minDuration);
    }
    
    if (options.limit) {
      result = result.slice(0, options.limit);
    }
    
    return result;
  }

  getByHash(queryHash) {
    return this.queries.filter(q => q.queryHash === queryHash);
  }

  getStats() {
    const totalQueries = this.queries.length;
    const slowQueries = this.queries.filter(q => q.duration > 500).length;
    const nPlusOneQueries = this.queries.filter(q => q.type === 'N+1').length;
    const avgDuration = totalQueries > 0 
      ? this.queries.reduce((sum, q) => sum + q.duration, 0) / totalQueries 
      : 0;
    
    const topFingerprints = Array.from(this.fingerprintCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([fingerprint, count]) => ({ fingerprint, count }));
    
    return {
      totalQueries,
      slowQueries,
      nPlusOneQueries,
      avgDuration: Math.round(avgDuration),
      topFingerprints,
    };
  }

  clear() {
    this.queries = [];
    this.fingerprintCounts.clear();
  }
}

class IndexRecommendationStore {
  constructor(maxSize = 500) {
    this.recommendations = [];
    this.maxSize = maxSize;
    this.appliedRecommendations = new Map();
  }

  add(recommendation) {
    const exists = this.recommendations.some(
      r => r.createStatement === recommendation.createStatement
    );
    
    if (!exists) {
      this.recommendations.unshift(recommendation);
      
      if (this.recommendations.length > this.maxSize) {
        this.recommendations.pop();
      }
    }
  }

  getAll(options = {}) {
    let result = [...this.recommendations];
    
    if (options.confidence) {
      result = result.filter(r => r.confidence === options.confidence);
    }
    
    if (options.tableName) {
      result = result.filter(r => r.tableName === options.tableName);
    }
    
    if (options.limit) {
      result = result.slice(0, options.limit);
    }
    
    return result;
  }

  getById(id) {
    return this.recommendations.find(r => r.id === id);
  }

  markAsApplied(id, appliedBy = 'system') {
    const rec = this.recommendations.find(r => r.id === id);
    if (rec) {
      rec.applied = true;
      rec.appliedAt = new Date().toISOString();
      rec.appliedBy = appliedBy;
      
      this.appliedRecommendations.set(id, {
        appliedAt: rec.appliedAt,
        appliedBy,
        recommendation: rec,
      });
    }
  }

  getAppliedRecommendations() {
    return Array.from(this.appliedRecommendations.values());
  }

  getStats() {
    const total = this.recommendations.length;
    const applied = this.appliedRecommendations.size;
    const highConfidence = this.recommendations.filter(r => r.confidence === 'HIGH').length;
    const mediumConfidence = this.recommendations.filter(r => r.confidence === 'MEDIUM').length;
    
    const avgImprovement = total > 0
      ? this.recommendations.reduce((sum, r) => sum + (r.expectedImprovement?.percentage || 0), 0) / total
      : 0;
    
    return {
      totalRecommendations: total,
      appliedRecommendations: applied,
      highConfidence,
      mediumConfidence,
      avgExpectedImprovement: Math.round(avgImprovement),
    };
  }

  clear() {
    this.recommendations = [];
    this.appliedRecommendations.clear();
  }
}

const slowQueryStore = new QueryStore();
const indexRecommendationStore = new IndexRecommendationStore();

module.exports = { slowQueryStore, indexRecommendationStore };
