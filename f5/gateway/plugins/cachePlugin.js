const { queryPatternAnalyzer } = require('../cache/QueryPatternAnalyzer');
const { redisCacheManager } = require('../cache/RedisCacheManager');

const cachePlugin = {
  async requestDidStart(requestContext) {
    const startTime = Date.now();
    const query = requestContext.request.query;
    const operationName = requestContext.request.operationName || 'Anonymous';
    const variables = requestContext.request.variables || {};

    const cachedResult = await redisCacheManager.get(query, variables);
    if (cachedResult) {
      console.log(`[CachePlugin] Cache HIT for: ${operationName}`);
      return {
        async responseForOperation() {
          return {
            data: cachedResult.data || cachedResult,
          };
        },
      };
    }

    console.log(`[CachePlugin] Cache MISS for: ${operationName}`);

    return {
      async willSendResponse(context) {
        const duration = Date.now() - startTime;
        
        queryPatternAnalyzer.analyzeQuery(query, operationName, duration, variables);
        
        const queryHash = context.context.queryHash || '';
        await redisCacheManager.storeQueryPattern(queryHash, { duration });
        
        const { errors } = context.response;
        if (!errors && context.response.data) {
          const analysis = queryPatternAnalyzer.analyzeQuery(query, operationName, duration, variables);
          if (analysis && analysis.operationType === 'query') {
            const ttl = queryPatternAnalyzer.calculateDynamicTTL(analysis.types);
            if (ttl > 0) {
              await redisCacheManager.set(query, variables, context.response.data, ttl);
            }
          }
        }
      },
    };
  },
};

module.exports = { cachePlugin };
