const { fetch } = require('@apollo/utils.fetch');
const { federatedDataLoader } = require('./FederatedDataLoader');

class BatchEntityResolver {
  constructor() {
    this.serviceEndpoints = new Map();
    this.entityBatches = new Map();
    this.metrics = {
      totalBatches: 0,
      totalEntities: 0,
      savedRequests: 0,
    };
  }

  registerService(serviceName, endpoint) {
    this.serviceEndpoints.set(serviceName, endpoint);
  }

  async resolveEntities(serviceName, representations) {
    if (representations.length === 0) return [];
    
    const endpoint = this.serviceEndpoints.get(serviceName);
    if (!endpoint) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    const batchKey = `${serviceName}:entities`;
    
    const loader = federatedDataLoader.getOrCreateLoader(
      serviceName,
      'entities',
      async (batchRepresentations) => {
        this.metrics.totalBatches++;
        this.metrics.totalEntities += batchRepresentations.length;
        this.metrics.savedRequests += batchRepresentations.length - 1;

        const startTime = Date.now();
        
        try {
          const result = await this.executeEntityQuery(endpoint, batchRepresentations);
          const duration = Date.now() - startTime;
          
          console.log(`[BatchEntityResolver] Resolved ${batchRepresentations.length} entities from ${serviceName} in ${duration}ms`);
          
          return result;
        } catch (error) {
          console.error(`[BatchEntityResolver] Error resolving entities from ${serviceName}:`, error);
          return batchRepresentations.map(() => null);
        }
      }
    );

    return Promise.all(representations.map(rep => loader.load(rep)));
  }

  async executeEntityQuery(endpoint, representations) {
    const query = `
      query ($representations: [_Any!]!) {
        _entities(representations: $representations) {
          ... on User {
            id
            email
            name
            createdAt
          }
          ... on Order {
            id
            userId
            status
            total
            createdAt
          }
          ... on Product {
            id
            name
            description
            price
            stock
            category
            createdAt
          }
        }
      }
    `;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { representations },
      }),
    });

    const json = await response.json();
    
    if (json.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    return json.data?._entities || [];
  }

  async resolveUserOrders(userId) {
    const endpoint = this.serviceEndpoints.get('orders');
    if (!endpoint) {
      throw new Error('Orders service not registered');
    }

    const query = `
      query ($userId: ID!) {
        ordersByUser(userId: $userId, limit: 100) {
          id
          status
          total
          createdAt
        }
      }
    `;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { userId } }),
    });

    const json = await response.json();
    return json.data?.ordersByUser || [];
  }

  async resolveOrderItems(orderId) {
    const endpoint = this.serviceEndpoints.get('orders');
    if (!endpoint) {
      throw new Error('Orders service not registered');
    }

    const query = `
      query ($orderId: ID!) {
        order(id: $orderId) {
          items {
            id
            productId
            quantity
            price
          }
        }
      }
    `;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { orderId } }),
    });

    const json = await response.json();
    return json.data?.order?.items || [];
  }

  async resolveProducts(productIds) {
    if (productIds.length === 0) return [];
    
    const endpoint = this.serviceEndpoints.get('products');
    if (!endpoint) {
      throw new Error('Products service not registered');
    }

    const loader = federatedDataLoader.getOrCreateLoader(
      'products',
      'byIds',
      async (idsBatch) => {
        const uniqueIds = [...new Set(idsBatch.flat())];
        
        const query = `
          query ($ids: [ID!]!) {
            productsByIds(ids: $ids) {
              id
              name
              description
              price
              stock
              category
              createdAt
            }
          }
        `;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { ids: uniqueIds } }),
        });

        const json = await response.json();
        const products = json.data?.productsByIds || [];
        
        const productMap = new Map(products.map(p => [p.id, p]));
        
        return idsBatch.map(ids => 
          ids.map(id => productMap.get(id) || null)
        );
      }
    );

    const results = await loader.load(productIds);
    return results;
  }

  getMetrics() {
    const loaderMetrics = federatedDataLoader.getMetrics();
    
    return {
      ...this.metrics,
      loaderMetrics,
      optimizationRatio: this.metrics.totalEntities > 0 
        ? (this.metrics.savedRequests / this.metrics.totalEntities).toFixed(2)
        : 0,
    };
  }

  clearCache() {
    federatedDataLoader.clearAll();
  }
}

const batchEntityResolver = new BatchEntityResolver();

module.exports = { batchEntityResolver, BatchEntityResolver };
