const crypto = require('crypto');

class SlowQueryAnalyzer {
  constructor() {
    this.queryPatterns = new Map();
    this.threshold = 500;
  }

  analyze(queryLog) {
    const fingerprint = this.generateFingerprint(queryLog.query);
    
    const existing = this.queryPatterns.get(fingerprint) || {
      count: 0,
      totalDuration: 0,
      maxDuration: 0,
      minDuration: Infinity,
      lastSeen: null,
      operationName: queryLog.operationName,
      sampleQuery: queryLog.query.substring(0, 500),
    };
    
    existing.count++;
    existing.totalDuration += queryLog.duration;
    existing.maxDuration = Math.max(existing.maxDuration, queryLog.duration);
    existing.minDuration = Math.min(existing.minDuration, queryLog.duration);
    existing.lastSeen = new Date().toISOString();
    existing.avgDuration = Math.round(existing.totalDuration / existing.count);
    
    this.queryPatterns.set(fingerprint, existing);
    
    return {
      fingerprint,
      pattern: existing,
      isProblematic: existing.count > 10 && existing.avgDuration > this.threshold,
      severity: this.calculateSeverity(existing),
    };
  }

  generateFingerprint(query) {
    const normalized = query
      .replace(/"[^"]*"/g, '?')
      .replace(/\d+/g, '?')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    
    return crypto
      .createHash('md5')
      .update(normalized)
      .digest('hex');
  }

  calculateSeverity(pattern) {
    const durationScore = Math.min(100, pattern.avgDuration / 10);
    const frequencyScore = Math.min(100, pattern.count * 2);
    
    const totalScore = (durationScore + frequencyScore) / 2;
    
    if (totalScore >= 80) return 'CRITICAL';
    if (totalScore >= 60) return 'HIGH';
    if (totalScore >= 40) return 'MEDIUM';
    return 'LOW';
  }

  getTopPatterns(limit = 10) {
    return Array.from(this.queryPatterns.entries())
      .map(([fingerprint, pattern]) => ({
        fingerprint,
        ...pattern,
        severity: this.calculateSeverity(pattern),
      }))
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, limit);
  }

  getPatternsBySeverity(severity) {
    return Array.from(this.queryPatterns.entries())
      .map(([fingerprint, pattern]) => ({
        fingerprint,
        ...pattern,
        severity: this.calculateSeverity(pattern),
      }))
      .filter(p => p.severity === severity);
  }

  clear() {
    this.queryPatterns.clear();
  }
}

const slowQueryAnalyzer = new SlowQueryAnalyzer();

function analyzeSlowQueries(queryLog) {
  return slowQueryAnalyzer.analyze(queryLog);
}

module.exports = { analyzeSlowQueries, slowQueryAnalyzer };
