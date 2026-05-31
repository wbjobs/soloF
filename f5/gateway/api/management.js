const express = require('express');
const { slowQueryStore, indexRecommendationStore } = require('../store/memoryStore');
const { pgStatementsAnalyzer } = require('../analyzers/pgStatementsAnalyzer');
const { clickhouseLogger } = require('../plugins/clickhouseLogger');
const { queryPlanMonitor } = require('../plugins/queryPlanMonitor');
const { batchEntityResolver } = require('../queryPlanner/BatchEntityResolver');
const { federatedDataLoader } = require('../queryPlanner/FederatedDataLoader');
const { redisCacheManager } = require('../cache/RedisCacheManager');
const { queryPatternAnalyzer } = require('../cache/QueryPatternAnalyzer');
const { cacheWarmer } = require('../cache/CacheWarmer');

const managementApi = express.Router();

managementApi.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

managementApi.get('/slow-queries', async (req, res) => {
  try {
    const { limit = 50, type, minDuration } = req.query;
    
    const queries = slowQueryStore.getAll({
      type,
      minDuration: minDuration ? parseInt(minDuration) : undefined,
      limit: parseInt(limit),
    });
    
    const stats = slowQueryStore.getStats();
    
    let clickhouseData = { trends: [], topSlow: [] };
    try {
      clickhouseData.trends = await clickhouseLogger.getQueryTrends(24);
      clickhouseData.topSlow = await clickhouseLogger.getTopSlowQueries(10);
    } catch (e) {
    }
    
    res.json({
      success: true,
      data: {
        queries,
        stats,
        clickhouse: clickhouseData,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/slow-queries/:hash', (req, res) => {
  try {
    const queries = slowQueryStore.getByHash(req.params.hash);
    res.json({ success: true, data: queries });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/index-recommendations', (req, res) => {
  try {
    const { limit = 50, confidence, tableName } = req.query;
    
    const recommendations = indexRecommendationStore.getAll({
      confidence,
      tableName,
      limit: parseInt(limit),
    });
    
    const stats = indexRecommendationStore.getStats();
    const applied = indexRecommendationStore.getAppliedRecommendations();
    
    res.json({
      success: true,
      data: {
        recommendations,
        stats,
        appliedRecommendations: applied,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.post('/index-recommendations/:id/apply', async (req, res) => {
  try {
    const { id } = req.params;
    const { appliedBy = 'api' } = req.body;
    
    const recommendation = indexRecommendationStore.getById(id);
    if (!recommendation) {
      return res.status(404).json({ success: false, error: 'Recommendation not found' });
    }
    
    indexRecommendationStore.markAsApplied(id, appliedBy);
    
    clickhouseLogger.logRecommendation(recommendation);
    
    res.json({
      success: true,
      data: {
        message: 'Recommendation marked as applied',
        recommendation,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/index-recommendations/evaluation', (req, res) => {
  try {
    const allRecs = indexRecommendationStore.getAll();
    
    const totalExpectedImprovement = allRecs.reduce(
      (sum, r) => sum + (r.expectedImprovement?.percentage || 0), 
      0
    );
    
    const avgImprovement = allRecs.length > 0 
      ? totalExpectedImprovement / allRecs.length 
      : 0;
    
    const highImpactRecs = allRecs.filter(
      r => r.confidence === 'HIGH' && (r.expectedImprovement?.percentage || 0) > 40
    );
    
    const byTable = allRecs.reduce((acc, rec) => {
      const table = rec.tableName;
      if (!acc[table]) {
        acc[table] = { count: 0, avgImprovement: 0 };
      }
      acc[table].count++;
      acc[table].avgImprovement += rec.expectedImprovement?.percentage || 0;
      return acc;
    }, {});
    
    Object.keys(byTable).forEach(table => {
      byTable[table].avgImprovement = Math.round(
        byTable[table].avgImprovement / byTable[table].count
      );
    });
    
    res.json({
      success: true,
      data: {
        totalRecommendations: allRecs.length,
        avgExpectedImprovement: Math.round(avgImprovement),
        highImpactRecommendations: highImpactRecs.length,
        estimatedTotalImpact: `Applying all recommendations could improve query performance by approximately ${Math.round(avgImprovement)}%`,
        byTable,
        topRecommendations: highImpactRecs.slice(0, 10),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/postgres/stats/:service', async (req, res) => {
  try {
    const { service } = req.params;
    const { limit = 10 } = req.query;
    
    const topQueries = await pgStatementsAnalyzer.getTopQueries(service, parseInt(limit));
    const missingIndexes = await pgStatementsAnalyzer.getMissingIndexes(service);
    const indexUsage = await pgStatementsAnalyzer.getIndexUsage(service);
    
    res.json({
      success: true,
      data: {
        topQueries,
        missingIndexes,
        indexUsage,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/analytics/trends', async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const trends = await clickhouseLogger.getQueryTrends(parseInt(hours));
    
    res.json({
      success: true,
      data: { trends },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/dashboard', async (req, res) => {
  try {
    const queryStats = slowQueryStore.getStats();
    const indexStats = indexRecommendationStore.getStats();
    const trends = await clickhouseLogger.getQueryTrends(24);
    const topSlow = await clickhouseLogger.getTopSlowQueries(5);
    
    res.json({
      success: true,
      data: {
        queryStats,
        indexStats,
        trends,
        topSlowQueries: topSlow,
        systemStatus: {
          gateway: 'running',
          clickhouse: clickhouseLogger.isInitialized ? 'connected' : 'disconnected',
        },
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.delete('/cache', (req, res) => {
  try {
    slowQueryStore.clear();
    indexRecommendationStore.clear();
    batchEntityResolver.clearCache();
    
    res.json({
      success: true,
      message: 'Cache cleared successfully',
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/query-optimizer/metrics', (req, res) => {
  try {
    const metrics = queryPlanMonitor.getMetrics();
    
    res.json({
      success: true,
      data: metrics,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/query-optimizer/batch-metrics', (req, res) => {
  try {
    const loaderMetrics = federatedDataLoader.getMetrics();
    const resolverMetrics = batchEntityResolver.getMetrics();
    
    res.json({
      success: true,
      data: {
        dataLoaderMetrics: loaderMetrics,
        batchResolverMetrics: resolverMetrics,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/query-optimizer/analyze', (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({ 
        success: false, 
        error: 'Query parameter is required' 
      });
    }
    
    const analysis = queryPlanMonitor.generateOptimizationReport(query);
    
    res.json({
      success: true,
      data: analysis,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.post('/query-optimizer/optimize', (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ 
        success: false, 
        error: 'Query is required in request body' 
      });
    }
    
    const report = queryPlanMonitor.generateOptimizationReport(query);
    
    const optimizationSteps = [];
    
    if (report.detectedPatterns.some(p => p.type === 'NESTED_LISTS')) {
      optimizationSteps.push({
        type: 'DATALOADER_ENABLE',
        description: 'Enable DataLoader batching for nested entity resolution',
        priority: 'HIGH',
        expectedSavings: '60-80% reduction in database calls',
      });
    }
    
    if (report.detectedPatterns.some(p => p.type === 'MULTIPLE_ENTITY_REFS')) {
      optimizationSteps.push({
        type: 'BATCH_RESOLUTION',
        description: 'Use batch entity resolution for multiple references',
        priority: 'MEDIUM',
        expectedSavings: '40-60% reduction in service calls',
      });
    }
    
    optimizationSteps.push({
      type: 'QUERY_PLAN_CACHING',
      description: 'Enable query plan caching for repeated queries',
      priority: 'MEDIUM',
      expectedSavings: '20-30% reduction in query planning time',
    });
    
    res.json({
      success: true,
      data: {
        analysis: report,
        optimizationSteps,
        recommendations: report.recommendations,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/query-optimizer/status', (req, res) => {
  try {
    const optimizerStatus = {
      dataLoaderEnabled: true,
      batchEntityResolution: true,
      queryPlanMonitoring: true,
      nPlusOneDetection: true,
      slowQueryAnalysis: true,
    };
    
    const recentActivity = queryPlanMonitor.getMetrics().recentQueries.slice(0, 5);
    
    res.json({
      success: true,
      data: {
        status: optimizerStatus,
        recentActivity,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/cache/stats', async (req, res) => {
  try {
    const cacheStats = await redisCacheManager.getStats();
    const patternStats = queryPatternAnalyzer.getStats();
    const warmupStatus = cacheWarmer.getStatus();
    
    res.json({
      success: true,
      data: {
        cache: cacheStats,
        patterns: patternStats,
        warmup: warmupStatus,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/cache/top-queries', (req, res) => {
  try {
    const { limit = 10, days = 7 } = req.query;
    const topQueries = queryPatternAnalyzer.getTopQueries(parseInt(limit), parseInt(days));
    
    res.json({
      success: true,
      data: {
        topQueries,
        total: topQueries.length,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/cache/cacheable-queries', (req, res) => {
  try {
    const { limit = 10, minCount = 5 } = req.query;
    const cacheableQueries = queryPatternAnalyzer.getCacheableQueries(
      parseInt(limit),
      parseInt(minCount)
    );
    
    res.json({
      success: true,
      data: {
        cacheableQueries,
        total: cacheableQueries.length,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.post('/cache/warmup', async (req, res) => {
  try {
    const { topN = 10 } = req.body;
    const results = await cacheWarmer.triggerManualWarmup(parseInt(topN));
    
    res.json({
      success: true,
      data: results,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/cache/warmup-history', (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const history = cacheWarmer.getWarmupHistory(parseInt(limit));
    
    res.json({
      success: true,
      data: {
        history,
        nextWarmup: cacheWarmer.getNextWarmupTime(),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/cache/warmup-status', (req, res) => {
  try {
    const status = cacheWarmer.getStatus();
    
    res.json({
      success: true,
      data: status,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.get('/cache/type-frequency', (req, res) => {
  try {
    const { type } = req.query;
    const allTypes = queryPatternAnalyzer.typeUpdateFrequency || new Map();
    
    let result = {};
    
    if (type) {
      const freq = queryPatternAnalyzer.getTypeUpdateFrequency(type);
      result[type] = freq;
    } else {
      allTypes.forEach((value, key) => {
        result[key] = value;
      });
    }
    
    res.json({
      success: true,
      data: result,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.delete('/cache/clear', async (req, res) => {
  try {
    slowQueryStore.clear();
    indexRecommendationStore.clear();
    batchEntityResolver.clearCache();
    queryPatternAnalyzer.clear();
    
    const cacheCount = await redisCacheManager.getCacheSize();
    await redisCacheManager.deleteByPattern('*');
    
    res.json({
      success: true,
      message: `All caches cleared successfully. Removed approximately ${cacheCount} cache entries.`,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

managementApi.post('/cache/invalidate-type', async (req, res) => {
  try {
    const { type } = req.body;
    
    if (!type) {
      return res.status(400).json({
        success: false,
        error: 'Type parameter is required',
      });
    }
    
    const count = await redisCacheManager.invalidateTypeCache(type);
    
    res.json({
      success: true,
      data: {
        type,
        invalidatedCount: count,
        message: `Invalidated cache for type: ${type}`,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = { managementApi };
