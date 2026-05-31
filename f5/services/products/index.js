const { ApolloServer, gql } = require('apollo-server');
const { buildSubgraphSchema } = require('@apollo/subgraph');
const { Pool } = require('pg');
const DataLoader = require('dataloader');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'products_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@shareable"])

  type Product @key(fields: "id") {
    id: ID!
    name: String!
    description: String
    price: Float!
    stock: Int!
    category: String
    createdAt: String
  }

  type Query {
    product(id: ID!): Product
    products(limit: Int = 20, offset: Int = 0, category: String): [Product]
    productsByIds(ids: [ID!]!): [Product]
    searchProducts(query: String!, limit: Int = 20): [Product]
    productsByCategory(category: String!, limit: Int = 20): [Product]
    featuredProducts(limit: Int = 10): [Product]
  }

  type Mutation {
    createProduct(name: String!, description: String, price: Float!, stock: Int!, category: String): Product
    updateProduct(id: ID!, name: String, description: String, price: Float, stock: Int, category: String): Product
    deleteProduct(id: ID!): Boolean
    updateStock(id: ID!, quantity: Int!): Product
  }
`;

const createBatchProductsLoader = () => {
  return new DataLoader(async (ids) => {
    console.log(`[Products Service] Batch loading ${ids.length} products`);
    
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT * FROM products WHERE id IN (${placeholders})`,
      ids
    );
    
    const productMap = new Map(result.rows.map(p => [p.id.toString(), p]));
    
    return ids.map(id => productMap.get(id.toString()) || null);
  });
};

const resolvers = {
  Query: {
    product: async (_, { id }, { dataLoaders }) => {
      return dataLoaders.products.load(id);
    },
    products: async (_, { limit, offset, category }) => {
      let query = 'SELECT * FROM products';
      const params = [];
      
      if (category) {
        query += ' WHERE category = $1';
        params.push(category);
      }
      
      query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limit, offset);
      
      const result = await pool.query(query, params);
      return result.rows;
    },
    productsByIds: async (_, { ids }, { dataLoaders }) => {
      console.log(`[Products Service] productsByIds called with ${ids.length} IDs`);
      return dataLoaders.products.loadMany(ids);
    },
    searchProducts: async (_, { query, limit }) => {
      const result = await pool.query(
        "SELECT * FROM products WHERE name ILIKE $1 OR description ILIKE $1 ORDER BY created_at DESC LIMIT $2",
        [`%${query}%`, limit]
      );
      return result.rows;
    },
    productsByCategory: async (_, { category, limit }) => {
      const result = await pool.query(
        'SELECT * FROM products WHERE category = $1 ORDER BY created_at DESC LIMIT $2',
        [category, limit]
      );
      return result.rows;
    },
    featuredProducts: async (_, { limit }) => {
      const result = await pool.query(
        'SELECT * FROM products WHERE stock > 0 ORDER BY created_at DESC LIMIT $1',
        [limit]
      );
      return result.rows;
    },
  },
  Mutation: {
    createProduct: async (_, { name, description, price, stock, category }) => {
      const result = await pool.query(
        'INSERT INTO products (name, description, price, stock, category, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *',
        [name, description, price, stock, category]
      );
      return result.rows[0];
    },
    updateProduct: async (_, { id, name, description, price, stock, category }) => {
      const result = await pool.query(
        'UPDATE products SET name = COALESCE($1, name), description = COALESCE($2, description), price = COALESCE($3, price), stock = COALESCE($4, stock), category = COALESCE($5, category) WHERE id = $6 RETURNING *',
        [name, description, price, stock, category, id]
      );
      return result.rows[0];
    },
    deleteProduct: async (_, { id }) => {
      await pool.query('DELETE FROM products WHERE id = $1', [id]);
      return true;
    },
    updateStock: async (_, { id, quantity }) => {
      const result = await pool.query(
        'UPDATE products SET stock = stock + $1 WHERE id = $2 RETURNING *',
        [quantity, id]
      );
      return result.rows[0];
    },
  },
  Product: {
    __resolveReference: async (reference, { dataLoaders }) => {
      console.log(`[Products Service] Resolving reference for product ID: ${reference.id}`);
      return dataLoaders.products.load(reference.id);
    },
  },
};

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      price DECIMAL(10,2) NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      category VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)
  `);
  
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)
  `);
  
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_price ON products(price)
  `);
  
  console.log('Products database initialized');
}

const server = new ApolloServer({
  schema: buildSubgraphSchema({ typeDefs, resolvers }),
  context: () => ({
    dataLoaders: {
      products: createBatchProductsLoader(),
    },
  }),
});

const PORT = process.env.PORT || 4003;

async function start() {
  await initDB();
  await server.listen(PORT);
  console.log(`🚀 Products service ready at http://localhost:${PORT}/graphql`);
  console.log(`✨ Features: DataLoader batching, productsByIds query`);
}

start().catch(console.error);
