const crypto = require('crypto');
const { detectNPlusOne } = require('../analyzers/nPlusOneDetector');
const { analyzeSlowQueries } = require('../analyzers/slowQueryAnalyzer');
const { indexRecommender } = require('../analyzers/indexRecommender');
const { slowQueryStore, indexRecommendationStore } = require('../store/memoryStore');

const SLOW_QUERY_THRESHOLD = 500;

const queryAnalysisPlugin = {
  requestDidStart(requestContext) {
    const startTime = Date.now();
    const query = requestContext.request.query;
    const operationName = requestContext.request.operationName || 'Anonymous';
    const variables = requestContext.request.variables || {};
    const requestId = requestContext.context.requestId;

    const queryHash = crypto
      .createHash('md5')
      .update(query)
      .digest('hex');

    return {
      didResolveOperation(context) {
        context.context.queryHash = queryHash;
        context.context.operationName = operationName;
      },

      async willSendResponse(context) {
        const duration = Date.now() - startTime;
        const { errors } = context.response;

        const queryLog = {
          requestId,
          queryHash,
          operationName,
          query,
          variables,
          duration,
          timestamp: new Date().toISOString(),
          hasErrors: !!errors,
        };

        if (duration > SLOW_QUERY_THRESHOLD) {
          await handleSlowQuery(queryLog);
        }

        const nPlusOneIssues = detectNPlusOne(query, context.response.data);
        if (nPlusOneIssues.length > 0) {
          await handleNPlusOneIssues(queryLog, nPlusOneIssues);
        }
      },
    };
  },
};

async function handleSlowQuery(queryLog) {
  console.log(`⚠️  Slow query detected: ${queryLog.operationName} (${queryLog.duration}ms)`);
  
  slowQueryStore.add(queryLog);

  const fingerprint = generateQueryFingerprint(queryLog.query);
  const recommendations = await indexRecommender.analyzeAndRecommend(queryLog, fingerprint);
  
  if (recommendations.length > 0) {
    recommendations.forEach(rec => {
      indexRecommendationStore.add({
        ...rec,
        queryHash: queryLog.queryHash,
        operationName: queryLog.operationName,
        detectedAt: new Date().toISOString(),
        queryFingerprint: fingerprint,
      });
    });
  }
}

async function handleNPlusOneIssues(queryLog, issues) {
  console.log(`⚠️  N+1 problem detected in ${queryLog.operationName}`);
  
  issues.forEach(issue => {
    slowQueryStore.add({
      ...queryLog,
      type: 'N+1',
      nPlusOneDetails: issue,
      duration: queryLog.duration,
    });
  });
}

function generateQueryFingerprint(query) {
  return query
    .replace(/"[^"]*"/g, '?')
    .replace(/\d+/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { queryAnalysisPlugin, SLOW_QUERY_THRESHOLD };
