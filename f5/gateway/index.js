const { ApolloServer } = require('apollo-server');
const { ApolloGateway, IntrospectAndCompose, RemoteGraphQLDataSource } = require('@apollo/gateway');
const { queryAnalysisPlugin } = require('./plugins/queryAnalysis');
const { clickhouseLogger, plugin: clickhousePlugin } = require('./plugins/clickhouseLogger');
const { managementApi } = require('./api/management');
const { queryPlanMonitor } = require('./plugins/queryPlanMonitor');
const { batchEntityResolver } = require('./queryPlanner/BatchEntityResolver');
const { cachePlugin } = require('./plugins/cachePlugin');
const { cacheWarmer } = require('./cache/CacheWarmer');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', managementApi);

class OptimizedDataSource extends RemoteGraphQLDataSource {
  willSendRequest({ request, context }) {
    if (context.requestId) {
      request.http.headers.set('x-request-id', context.requestId);
    }
  }

  async didReceiveResponse({ response, context }) {
    return response;
  }
}

const gateway = new ApolloGateway({
  supergraphSdl: new IntrospectAndCompose({
    subgraphs: [
      { name: 'users', url: 'http://localhost:4001/graphql' },
      { name: 'orders', url: 'http://localhost:4002/graphql' },
      { name: 'products', url: 'http://localhost:4003/graphql' },
    ],
  }),
  buildService({ name, url }) {
    batchEntityResolver.registerService(name, url);
    return new OptimizedDataSource({ url });
  },
  __exposeQueryPlanExperimental: true,
});

const server = new ApolloServer({
  gateway,
  subscriptions: false,
  plugins: [
    {
      async serverWillStart() {
        console.log('🚀 Gateway starting up...');
        batchEntityResolver.registerService('users', 'http://localhost:4001/graphql');
        batchEntityResolver.registerService('orders', 'http://localhost:4002/graphql');
        batchEntityResolver.registerService('products', 'http://localhost:4003/graphql');
        cacheWarmer.start();
      },
    },
    cachePlugin,
    queryPlanMonitor,
    queryAnalysisPlugin,
    clickhousePlugin,
    {
      async requestDidStart(requestContext) {
        return {
          async willSendResponse(context) {
            if (context.queryPlanAnalysis) {
              const metrics = context.queryPlanAnalysis.statistics;
              if (metrics.maxNestingDepth > 2 || metrics.batchableEntities > 0) {
                console.log(
                  `[QueryOptimizer] Query "${context.operationName || 'Anonymous'}" - ` +
                  `Nesting: ${metrics.maxNestingDepth}, Batchable: ${metrics.batchableEntities}, ` +
                  `Optimization: ${metrics.potentialOptimization}`
                );
              }
            }
          },
        };
      },
    },
  ],
  context: ({ req }) => {
    return {
      requestId: req.headers['x-request-id'] || Math.random().toString(36).substr(2, 9),
      startTime: Date.now(),
      batchEntityResolver,
    };
  },
  introspection: true,
  playground: {
    settings: {
      'request.credentials': 'include',
    },
    tabs: [
      {
        endpoint: '/graphql',
        query: `
query GetUserWithOrdersAndProducts($userId: ID!) {
  user(id: $userId) {
    id
    email
    name
    orders {
      id
      status
      total
      items {
        product {
          id
          name
          price
          stock
        }
        quantity
      }
    }
  }
}
        `,
        variables: JSON.stringify({ userId: '1' }),
      },
    ],
  },
});

const PORT = process.env.PORT || 4000;

async function start() {
  await server.start();
  
  server.applyMiddleware({ app, path: '/graphql' });
  
  app.listen({ port: PORT }, () => {
    console.log(`\n🚀 Apollo Federation Gateway ready at http://localhost:${PORT}/graphql`);
    console.log(`📊 Management API ready at http://localhost:${PORT}/api`);
    console.log(`\n✨ Query Optimization Features:`);
    console.log(`   - Federated DataLoader batching enabled`);
    console.log(`   - Query Plan Optimization enabled`);
    console.log(`   - N+1 Problem Detection enabled`);
    console.log(`   - Batch Entity Resolution enabled`);
    console.log(`\n🔥 Cache Warmup Features:`);
    console.log(`   - Redis caching with dynamic TTL based on update frequency`);
    console.log(`   - Scheduled warmup at 3:00 AM daily`);
    console.log(`   - Top 10 frequent queries auto-warmup`);
    console.log(`   - Query pattern analysis (7 days history)`);
    console.log(`\n`);
  });
}

process.on('SIGTERM', async () => {
  console.log('Shutting down gateway...');
  batchEntityResolver.clearCache();
  cacheWarmer.stop();
  process.exit(0);
});

start().catch(console.error);
