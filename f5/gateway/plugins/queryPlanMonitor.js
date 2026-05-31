const { queryPlanOptimizer } = require('../queryPlanner/QueryPlanOptimizer');
const { batchEntityResolver } = require('../queryPlanner/BatchEntityResolver');

class QueryPlanMonitor {
  constructor() {
    this.queryHistory = [];
    this.maxHistorySize = 100;
    this.nPlusOneDetected = 0;
    this.optimizedQueries = 0;
  }

  requestDidStart(requestContext) {
    const startTime = Date.now();
    const query = requestContext.request.query;
    const operationName = requestContext.request.operationName || 'Anonymous';
    
    return {
      didResolveOperation: (context) => {
        try {
          const planAnalysis = queryPlanOptimizer.optimizeQueryPlan(query, context);
          context.queryPlanAnalysis = planAnalysis;
          
          this.recordQueryAnalysis(planAnalysis, operationName);
        } catch (e) {
          console.warn('Query plan analysis failed:', e.message);
        }
      },

      willSendResponse: (context) => {
        const duration = Date.now() - startTime;
        const analysis = context.queryPlanAnalysis;
        
        if (analysis) {
          this.recordExecutionMetrics(analysis, duration, context.response);
        }
      },
    };
  }

  recordQueryAnalysis(analysis, operationName) {
    const stats = analysis.statistics;
    
    if (stats.batchableEntities > 0) {
      this.optimizedQueries++;
    }
    
    if (stats.maxNestingDepth > 2) {
      this.nPlusOneDetected++;
    }
    
    this.queryHistory.unshift({
      operationName,
      timestamp: new Date().toISOString(),
      statistics: stats,
      plan: analysis.optimizedPlan,
    });
    
    if (this.queryHistory.length > this.maxHistorySize) {
      this.queryHistory.pop();
    }
  }

  recordExecutionMetrics(analysis, duration, response) {
    const latestEntry = this.queryHistory[0];
    if (latestEntry) {
      latestEntry.executionDuration = duration;
      latestEntry.hasErrors = !!response.errors;
    }
  }

  getMetrics() {
    const resolverMetrics = batchEntityResolver.getMetrics();
    
    return {
      totalQueriesAnalyzed: this.queryHistory.length,
      nPlusOneDetected: this.nPlusOneDetected,
      queriesOptimized: this.optimizedQueries,
      avgNestingDepth: this.calculateAvgNestingDepth(),
      resolverMetrics,
      recentQueries: this.queryHistory.slice(0, 10).map(q => ({
        operationName: q.operationName,
        timestamp: q.timestamp,
        executionDuration: q.executionDuration,
        statistics: q.statistics,
      })),
    };
  }

  calculateAvgNestingDepth() {
    if (this.queryHistory.length === 0) return 0;
    
    const total = this.queryHistory.reduce(
      (sum, q) => sum + q.statistics.maxNestingDepth, 
      0
    );
    
    return Math.round((total / this.queryHistory.length) * 100) / 100;
  }

  detectNPlusOnePatterns(query) {
    const patterns = [];
    
    const nestedListRegex = /\{\s*\w+\s*\{\s*\w+\s*\{/g;
    const nestedMatches = query.match(nestedListRegex);
    if (nestedMatches) {
      patterns.push({
        type: 'NESTED_LISTS',
        severity: 'HIGH',
        description: 'Deeply nested list fields detected - potential N+1 issue',
        matches: nestedMatches.length,
      });
    }
    
    const entityReferences = ['product', 'user', 'order'];
    entityReferences.forEach(entity => {
      const regex = new RegExp(`\\b${entity}\\s*\\{`, 'gi');
      const matches = query.match(regex);
      if (matches && matches.length > 3) {
        patterns.push({
          type: 'MULTIPLE_ENTITY_REFS',
          entity,
          severity: 'MEDIUM',
          description: `Multiple ${entity} references detected - batch resolution recommended`,
          count: matches.length,
        });
      }
    });
    
    return patterns;
  }

  generateOptimizationReport(query) {
    const nPlusOnePatterns = this.detectNPlusOnePatterns(query);
    const plan = queryPlanOptimizer.optimizeQueryPlan(query, {});
    
    return {
      query: query.substring(0, 500) + (query.length > 500 ? '...' : ''),
      detectedPatterns: nPlusOnePatterns,
      planStatistics: plan.statistics,
      recommendations: this.generateRecommendations(nPlusOnePatterns, plan),
    };
  }

  generateRecommendations(patterns, plan) {
    const recommendations = [];
    
    if (patterns.some(p => p.type === 'NESTED_LISTS')) {
      recommendations.push({
        priority: 'HIGH',
        type: 'BATCH_RESOLUTION',
        description: 'Use DataLoader batching for nested list fields to prevent N+1 queries',
        action: 'Enable federatedDataLoader for nested entity resolution',
      });
    }
    
    if (plan.statistics.batchableEntities > 0) {
      recommendations.push({
        priority: 'HIGH',
        type: 'ENTITY_BATCHING',
        description: `Batch ${plan.statistics.batchableEntities} entity references into single requests`,
        estimatedSaving: plan.statistics.potentialOptimization,
      });
    }
    
    if (plan.statistics.maxNestingDepth > 2) {
      recommendations.push({
        priority: 'MEDIUM',
        type: 'QUERY_FLATTENING',
        description: `Query depth of ${plan.statistics.maxNestingDepth} may cause performance issues`,
        action: 'Consider flattening query structure or using field-level caching',
      });
    }
    
    return recommendations;
  }
}

const queryPlanMonitor = new QueryPlanMonitor();

module.exports = { queryPlanMonitor, QueryPlanMonitor };
