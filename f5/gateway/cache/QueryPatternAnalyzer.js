const { parse, visit } = require('graphql');
const { redisCacheManager } = require('./RedisCacheManager');

class QueryPatternAnalyzer {
  constructor() {
    this.queryPatterns = new Map();
    this.mutationPatterns = new Map();
    this.typeUpdateFrequency = new Map();
  }

  analyzeQuery(query, operationName, duration, variables = {}) {
    try {
      const ast = parse(query);
      const fingerprint = this.generateFingerprint(query);
      
      const analysis = {
        fingerprint,
        operationName,
        operationType: this.getOperationType(ast),
        types: this.extractTypes(ast),
        fields: this.extractFields(ast),
        variables: Object.keys(variables),
        hasArguments: this.hasArguments(ast),
        duration,
        timestamp: new Date().toISOString(),
      };

      this.storePattern(fingerprint, analysis);
      
      if (analysis.operationType === 'query') {
        this.updateTypeFrequency(analysis.types, 'read');
      } else if (analysis.operationType === 'mutation') {
        this.updateTypeFrequency(analysis.types, 'write');
      }

      return analysis;
    } catch (e) {
      console.error('[QueryPatternAnalyzer] Analysis error:', e.message);
      return null;
    }
  }

  generateFingerprint(query) {
    return query
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/"[^"]*"/g, '?')
      .replace(/\d+/g, '?');
  }

  getOperationType(ast) {
    const definition = ast.definitions.find(d => d.kind === 'OperationDefinition');
    return definition?.operation || 'query';
  }

  extractTypes(ast) {
    const types = new Set();
    
    visit(ast, {
      Field: (node) => {
        const typeName = this.inferTypeFromField(node.name.value);
        if (typeName) {
          types.add(typeName);
        }
      },
    });

    return Array.from(types);
  }

  inferTypeFromField(fieldName) {
    const typeMap = {
      user: 'User',
      users: 'User',
      order: 'Order',
      orders: 'Order',
      ordersByUser: 'Order',
      ordersByStatus: 'Order',
      recentOrders: 'Order',
      product: 'Product',
      products: 'Product',
      productsByCategory: 'Product',
      featuredProducts: 'Product',
      searchProducts: 'Product',
      searchUsers: 'User',
      createUser: 'User',
      updateUser: 'User',
      deleteUser: 'User',
      createOrder: 'Order',
      updateOrderStatus: 'Order',
      cancelOrder: 'Order',
      createProduct: 'Product',
      updateProduct: 'Product',
      deleteProduct: 'Product',
      updateStock: 'Product',
    };

    return typeMap[fieldName];
  }

  extractFields(ast) {
    const fields = [];
    
    visit(ast, {
      Field: (node) => {
        fields.push(node.name.value);
      },
    });

    return fields;
  }

  hasArguments(ast) {
    let hasArgs = false;
    
    visit(ast, {
      Field: (node) => {
        if (node.arguments && node.arguments.length > 0) {
          hasArgs = true;
        }
      },
    });

    return hasArgs;
  }

  storePattern(fingerprint, analysis) {
    const existing = this.queryPatterns.get(fingerprint) || {
      count: 0,
      totalDuration: 0,
      executions: [],
    };

    existing.count++;
    existing.totalDuration += analysis.duration;
    existing.avgDuration = existing.totalDuration / existing.count;
    existing.lastSeen = analysis.timestamp;
    existing.types = analysis.types;
    existing.fields = analysis.fields;
    existing.operationName = analysis.operationName;
    existing.operationType = analysis.operationType;
    
    existing.executions.push({
      timestamp: analysis.timestamp,
      duration: analysis.duration,
    });

    if (existing.executions.length > 100) {
      existing.executions = existing.executions.slice(-100);
    }

    this.queryPatterns.set(fingerprint, existing);
  }

  updateTypeFrequency(types, operation) {
    types.forEach(type => {
      const existing = this.typeUpdateFrequency.get(type) || {
        reads: 0,
        writes: 0,
        lastWrite: null,
        lastRead: null,
      };

      if (operation === 'read') {
        existing.reads++;
        existing.lastRead = new Date().toISOString();
      } else {
        existing.writes++;
        existing.lastWrite = new Date().toISOString();
      }

      existing.updateFrequency = existing.writes > 0 
        ? existing.reads / existing.writes 
        : existing.reads;

      this.typeUpdateFrequency.set(type, existing);
    });
  }

  getTopQueries(limit = 10, days = 7) {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    return Array.from(this.queryPatterns.entries())
      .filter(([_, pattern]) => new Date(pattern.lastSeen) > cutoffDate)
      .map(([fingerprint, pattern]) => ({
        fingerprint,
        ...pattern,
        executions: undefined,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getSlowQueries(limit = 10) {
    return Array.from(this.queryPatterns.entries())
      .map(([fingerprint, pattern]) => ({
        fingerprint,
        ...pattern,
        executions: undefined,
      }))
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, limit);
  }

  getTypeUpdateFrequency(typeName) {
    return this.typeUpdateFrequency.get(typeName);
  }

  calculateDynamicTTL(types) {
    if (!types || types.length === 0) {
      return 3600;
    }

    let avgWriteFrequency = 0;
    types.forEach(type => {
      const freq = this.typeUpdateFrequency.get(type);
      if (freq) {
        avgWriteFrequency += freq.writes;
      }
    });
    avgWriteFrequency /= types.length;

    if (avgWriteFrequency > 100) {
      return 300;
    }
    if (avgWriteFrequency > 50) {
      return 900;
    }
    if (avgWriteFrequency > 10) {
      return 1800;
    }
    if (avgWriteFrequency > 1) {
      return 3600;
    }

    return 7200;
  }

  getCacheableQueries(limit = 10, minCount = 5) {
    return Array.from(this.queryPatterns.entries())
      .filter(([_, pattern]) => 
        pattern.count >= minCount && 
        pattern.operationType === 'query' &&
        pattern.types.length > 0
      )
      .map(([fingerprint, pattern]) => ({
        fingerprint,
        ...pattern,
        recommendedTTL: this.calculateDynamicTTL(pattern.types),
        executions: undefined,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getStats() {
    return {
      totalPatterns: this.queryPatterns.size,
      totalQueries: Array.from(this.queryPatterns.values()).reduce((sum, p) => sum + p.count, 0),
      trackedTypes: this.typeUpdateFrequency.size,
      topTypes: Array.from(this.typeUpdateFrequency.entries())
        .map(([type, stats]) => ({ type, ...stats }))
        .sort((a, b) => b.reads - a.reads)
        .slice(0, 5),
    };
  }

  clear() {
    this.queryPatterns.clear();
    this.mutationPatterns.clear();
    this.typeUpdateFrequency.clear();
  }
}

const queryPatternAnalyzer = new QueryPatternAnalyzer();

module.exports = { queryPatternAnalyzer, QueryPatternAnalyzer };
