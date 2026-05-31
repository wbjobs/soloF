const { pgStatementsAnalyzer } = require('./pgStatementsAnalyzer');

const indexRecommender = {
  async analyzeAndRecommend(queryLog, fingerprint) {
    const recommendations = [];
    
    try {
      const pgAnalysis = await pgStatementsAnalyzer.analyzeFingerprint(fingerprint);
      
      if (pgAnalysis.frequentQueries) {
        pgAnalysis.frequentQueries.forEach(q => {
          const rec = generateIndexRecommendation(q, queryLog);
          if (rec) {
            recommendations.push(rec);
          }
        });
      }
      
      const heuristicRecs = generateHeuristicRecommendations(queryLog, fingerprint);
      recommendations.push(...heuristicRecs);
      
    } catch (e) {
      console.error('Error in index recommendation:', e);
    }
    
    return recommendations;
  },
};

function generateIndexRecommendation(pgQuery, queryLog) {
  const { query, calls, total_time, mean_time } = pgQuery;
  
  const whereColumns = extractWhereColumns(query);
  const joinColumns = extractJoinColumns(query);
  const orderColumns = extractOrderColumns(query);
  
  const candidateColumns = [...new Set([...whereColumns, ...joinColumns, ...orderColumns])];
  
  if (candidateColumns.length === 0) return null;
  
  const tableName = extractTableName(query);
  if (!tableName) return null;
  
  const expectedImprovement = calculateExpectedImprovement(calls, mean_time, candidateColumns.length);
  
  return {
    id: `idx_rec_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    tableName,
    columns: candidateColumns,
    indexType: determineIndexType(query, candidateColumns),
    createStatement: generateCreateIndexStatement(tableName, candidateColumns),
    analysis: {
      queryCalls: calls,
      totalTimeMs: total_time,
      meanTimeMs: mean_time,
      detectedPattern: detectQueryPattern(query),
    },
    expectedImprovement,
    confidence: calculateConfidence(calls, mean_time, candidateColumns),
    source: 'pg_stat_statements',
  };
}

function generateHeuristicRecommendations(queryLog, fingerprint) {
  const recommendations = [];
  const query = queryLog.query.toLowerCase();
  
  const commonPatterns = [
    { pattern: /where\s+(\w+)\s*=\s*\?/g, type: 'equality' },
    { pattern: /where\s+(\w+)\s+like/g, type: 'like' },
    { pattern: /order\s+by\s+(\w+)/g, type: 'order' },
    { pattern: /join\s+\w+\s+on\s+(\w+)\.(\w+)\s*=/g, type: 'join' },
  ];
  
  commonPatterns.forEach(({ pattern, type }) => {
    const matches = [...fingerprint.matchAll(pattern)];
    matches.forEach(match => {
      const tableName = match[1] || 'unknown_table';
      const columnName = match[2] || match[1];
      
      if (columnName && columnName !== 'unknown_table') {
        recommendations.push({
          id: `heur_idx_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          tableName,
          columns: [columnName],
          indexType: type === 'like' ? 'GIN' : 'BTREE',
          createStatement: `CREATE INDEX idx_${tableName}_${columnName} ON ${tableName} (${columnName});`,
          analysis: {
            detectedPattern: type,
            heuristic: true,
          },
          expectedImprovement: {
            percentage: type === 'join' ? 40 : 25,
            description: `Estimated ${type === 'join' ? 40 : 25}% improvement based on query pattern`,
          },
          confidence: 'MEDIUM',
          source: 'heuristic_analysis',
        });
      }
    });
  });
  
  return recommendations;
}

function extractWhereColumns(query) {
  const columns = [];
  const wherePattern = /WHERE\s+(\w+)\.(\w+)\s*[=<>]|WHERE\s+(\w+)\s*[=<>]/gi;
  let match;
  
  while ((match = wherePattern.exec(query)) !== null) {
    if (match[2]) columns.push(match[2]);
    else if (match[3]) columns.push(match[3]);
  }
  
  return columns;
}

function extractJoinColumns(query) {
  const columns = [];
  const joinPattern = /JOIN\s+\w+\s+ON\s+(\w+)\.(\w+)\s*=/gi;
  let match;
  
  while ((match = joinPattern.exec(query)) !== null) {
    if (match[2]) columns.push(match[2]);
  }
  
  return columns;
}

function extractOrderColumns(query) {
  const columns = [];
  const orderPattern = /ORDER\s+BY\s+(\w+)\.(\w+)|ORDER\s+BY\s+(\w+)/gi;
  let match;
  
  while ((match = orderPattern.exec(query)) !== null) {
    if (match[2]) columns.push(match[2]);
    else if (match[3]) columns.push(match[3]);
  }
  
  return columns;
}

function extractTableName(query) {
  const fromMatch = query.match(/FROM\s+(\w+)/i);
  return fromMatch ? fromMatch[1] : null;
}

function determineIndexType(query, columns) {
  if (query.toLowerCase().includes('like') || query.toLowerCase().includes('@@')) {
    return 'GIN';
  }
  if (columns.length > 1) {
    return 'COMPOSITE_BTREE';
  }
  return 'BTREE';
}

function generateCreateIndexStatement(table, columns) {
  const indexName = `idx_${table}_${columns.join('_')}`.toLowerCase();
  return `CREATE INDEX CONCURRENTLY ${indexName} ON ${table} (${columns.join(', ')});`;
}

function calculateExpectedImprovement(calls, meanTime, numColumns) {
  const baseImprovement = Math.min(80, (meanTime / 100) * 30);
  const callFactor = Math.min(2, Math.log10(calls + 1));
  const columnFactor = numColumns > 2 ? 0.8 : 1;
  
  const percentage = Math.round(baseImprovement * callFactor * columnFactor);
  
  return {
    percentage: Math.min(95, percentage),
    description: `Estimated ${percentage}% improvement in query execution time`,
    callFrequency: calls,
    currentLatencyMs: meanTime,
  };
}

function calculateConfidence(calls, meanTime, columns) {
  let score = 0;
  
  if (calls > 100) score += 3;
  else if (calls > 10) score += 2;
  else score += 1;
  
  if (meanTime > 1000) score += 3;
  else if (meanTime > 200) score += 2;
  else score += 1;
  
  if (columns.length === 1) score += 2;
  else if (columns.length <= 3) score += 1;
  
  if (score >= 6) return 'HIGH';
  if (score >= 4) return 'MEDIUM';
  return 'LOW';
}

function detectQueryPattern(query) {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('join')) return 'JOIN_HEAVY';
  if (lowerQuery.includes('group by')) return 'AGGREGATION';
  if (lowerQuery.includes('order by')) return 'SORTING';
  if (lowerQuery.includes('like')) return 'PATTERN_MATCH';
  return 'SIMPLE_LOOKUP';
}

module.exports = { indexRecommender };
