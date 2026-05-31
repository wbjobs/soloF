const { ApolloServer, gql } = require('apollo-server');
const { buildSubgraphSchema } = require('@apollo/subgraph');
const { Pool } = require('pg');
const DataLoader = require('dataloader');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'orders_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@shareable"])

  type Order @key(fields: "id") {
    id: ID!
    userId: ID!
    user: User
    status: String!
    total: Float!
    createdAt: String
    items: [OrderItem]
  }

  type OrderItem {
    id: ID!
    productId: ID!
    product: Product
    quantity: Int!
    price: Float!
  }

  type User @key(fields: "id", resolvable: false) {
    id: ID!
    orders: [Order]
  }

  type Product @key(fields: "id", resolvable: false) {
    id: ID!
  }

  type Query {
    order(id: ID!): Order
    ordersByIds(ids: [ID!]!): [Order]
    ordersByUser(userId: ID!, limit: Int = 10, offset: Int = 0): [Order]
    ordersByStatus(status: String!, limit: Int = 10): [Order]
    recentOrders(limit: Int = 20): [Order]
  }

  type Mutation {
    createOrder(userId: ID!, items: [OrderItemInput]!): Order
    updateOrderStatus(id: ID!, status: String!): Order
    cancelOrder(id: ID!): Order
  }

  input OrderItemInput {
    productId: ID!
    quantity: Int!
    price: Float!
  }
`;

const createBatchOrderLoader = () => {
  return new DataLoader(async (ids) => {
    console.log(`[Orders Service] Batch loading ${ids.length} orders`);
    
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT * FROM orders WHERE id IN (${placeholders})`,
      ids
    );
    
    const orderMap = new Map(result.rows.map(o => [o.id.toString(), o]));
    
    return ids.map(id => orderMap.get(id.toString()) || null);
  });
};

const createBatchOrderItemsLoader = () => {
  return new DataLoader(async (orderIds) => {
    console.log(`[Orders Service] Batch loading items for ${orderIds.length} orders`);
    
    const placeholders = orderIds.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT * FROM order_items WHERE order_id IN (${placeholders})`,
      orderIds
    );
    
    const itemsByOrderId = new Map();
    result.rows.forEach(item => {
      const orderId = item.order_id.toString();
      if (!itemsByOrderId.has(orderId)) {
        itemsByOrderId.set(orderId, []);
      }
      itemsByOrderId.get(orderId).push(item);
    });
    
    return orderIds.map(id => itemsByOrderId.get(id.toString()) || []);
  });
};

const resolvers = {
  Query: {
    order: async (_, { id }, { dataLoaders }) => {
      return dataLoaders.orders.load(id);
    },
    ordersByIds: async (_, { ids }, { dataLoaders }) => {
      console.log(`[Orders Service] ordersByIds called with ${ids.length} IDs`);
      return dataLoaders.orders.loadMany(ids);
    },
    ordersByUser: async (_, { userId, limit, offset }) => {
      const result = await pool.query(
        'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [userId, limit, offset]
      );
      return result.rows;
    },
    ordersByStatus: async (_, { status, limit }) => {
      const result = await pool.query(
        'SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC LIMIT $2',
        [status, limit]
      );
      return result.rows;
    },
    recentOrders: async (_, { limit }) => {
      const result = await pool.query(
        'SELECT * FROM orders ORDER BY created_at DESC LIMIT $1',
        [limit]
      );
      return result.rows;
    },
  },
  Mutation: {
    createOrder: async (_, { userId, items }) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        
        const orderResult = await client.query(
          'INSERT INTO orders (user_id, status, total, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
          [userId, 'PENDING', total]
        );
        
        const orderId = orderResult.rows[0].id;
        
        for (const item of items) {
          await client.query(
            'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
            [orderId, item.productId, item.quantity, item.price]
          );
        }
        
        await client.query('COMMIT');
        return orderResult.rows[0];
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    updateOrderStatus: async (_, { id, status }) => {
      const result = await pool.query(
        'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
        [status, id]
      );
      return result.rows[0];
    },
    cancelOrder: async (_, { id }) => {
      const result = await pool.query(
        'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
        ['CANCELLED', id]
      );
      return result.rows[0];
    },
  },
  Order: {
    __resolveReference: async (reference, { dataLoaders }) => {
      console.log(`[Orders Service] Resolving reference for order ID: ${reference.id}`);
      return dataLoaders.orders.load(reference.id);
    },
    user: (order) => ({ __typename: 'User', id: order.userId }),
    items: async (order, _, { dataLoaders }) => {
      return dataLoaders.orderItems.load(order.id);
    },
  },
  OrderItem: {
    product: (item) => ({ __typename: 'Product', id: item.productId }),
  },
  User: {
    orders: async (user) => {
      const result = await pool.query(
        'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
        [user.id]
      );
      return result.rows;
    },
  },
};

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      status VARCHAR(50) NOT NULL,
      total DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      price DECIMAL(10,2) NOT NULL
    )
  `);
  
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)
  `);
  
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)
  `);
  
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)
  `);
  
  console.log('Orders database initialized');
}

const server = new ApolloServer({
  schema: buildSubgraphSchema({ typeDefs, resolvers }),
  context: () => ({
    dataLoaders: {
      orders: createBatchOrderLoader(),
      orderItems: createBatchOrderItemsLoader(),
    },
  }),
});

const PORT = process.env.PORT || 4002;

async function start() {
  await initDB();
  await server.listen(PORT);
  console.log(`🚀 Orders service ready at http://localhost:${PORT}/graphql`);
  console.log(`✨ Features: DataLoader batching, ordersByIds query`);
}

start().catch(console.error);
