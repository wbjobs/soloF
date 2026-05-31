const { ApolloServer, gql } = require('apollo-server');
const { buildSubgraphSchema } = require('@apollo/subgraph');
const { Pool } = require('pg');
const DataLoader = require('dataloader');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'users_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@shareable"])

  type User @key(fields: "id") {
    id: ID!
    email: String!
    name: String
    createdAt: String
    orders: [Order]
  }

  type Order @key(fields: "id", resolvable: false) {
    id: ID!
  }

  type Query {
    user(id: ID!): User
    usersByIds(ids: [ID!]!): [User]
    users(limit: Int = 10, offset: Int = 0): [User]
    searchUsers(query: String!): [User]
  }

  type Mutation {
    createUser(email: String!, name: String): User
    updateUser(id: ID!, name: String, email: String): User
    deleteUser(id: ID!): Boolean
  }
`;

const createBatchUserLoader = () => {
  return new DataLoader(async (ids) => {
    console.log(`[Users Service] Batch loading ${ids.length} users`);
    
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT * FROM users WHERE id IN (${placeholders})`,
      ids
    );
    
    const userMap = new Map(result.rows.map(u => [u.id.toString(), u]));
    
    return ids.map(id => userMap.get(id.toString()) || null);
  });
};

const resolvers = {
  Query: {
    user: async (_, { id }, { dataLoaders }) => {
      return dataLoaders.users.load(id);
    },
    usersByIds: async (_, { ids }, { dataLoaders }) => {
      console.log(`[Users Service] usersByIds called with ${ids.length} IDs`);
      return dataLoaders.users.loadMany(ids);
    },
    users: async (_, { limit, offset }) => {
      const result = await pool.query(
        'SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );
      return result.rows;
    },
    searchUsers: async (_, { query }) => {
      const result = await pool.query(
        "SELECT * FROM users WHERE name ILIKE $1 OR email ILIKE $1",
        [`%${query}%`]
      );
      return result.rows;
    },
  },
  Mutation: {
    createUser: async (_, { email, name }) => {
      const result = await pool.query(
        'INSERT INTO users (email, name, created_at) VALUES ($1, $2, NOW()) RETURNING *',
        [email, name]
      );
      return result.rows[0];
    },
    updateUser: async (_, { id, name, email }) => {
      const result = await pool.query(
        'UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email) WHERE id = $3 RETURNING *',
        [name, email, id]
      );
      return result.rows[0];
    },
    deleteUser: async (_, { id }) => {
      await pool.query('DELETE FROM users WHERE id = $1', [id]);
      return true;
    },
  },
  User: {
    __resolveReference: async (reference, { dataLoaders }) => {
      console.log(`[Users Service] Resolving reference for user ID: ${reference.id}`);
      return dataLoaders.users.load(reference.id);
    },
  },
};

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
  `);
  
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_name ON users(name)
  `);
  
  console.log('Users database initialized');
}

const server = new ApolloServer({
  schema: buildSubgraphSchema({ typeDefs, resolvers }),
  context: () => ({
    dataLoaders: {
      users: createBatchUserLoader(),
    },
  }),
});

const PORT = process.env.PORT || 4001;

async function start() {
  await initDB();
  await server.listen(PORT);
  console.log(`🚀 Users service ready at http://localhost:${PORT}/graphql`);
  console.log(`✨ Features: DataLoader batching, usersByIds query`);
}

start().catch(console.error);
