const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'whiteboard',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

const initDatabase = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id SERIAL PRIMARY KEY,
      board_id VARCHAR(255) NOT NULL,
      data JSONB NOT NULL,
      timestamp BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_snapshots_board_time ON snapshots(board_id, timestamp DESC)
  `);
  
  console.log('Database initialized');
};

const saveSnapshot = async (boardId, data, timestamp) => {
  await pool.query(
    'INSERT INTO snapshots (board_id, data, timestamp) VALUES ($1, $2, $3)',
    [boardId, data, timestamp]
  );
};

const getSnapshots = async (boardId) => {
  const result = await pool.query(
    'SELECT * FROM snapshots WHERE board_id = $1 ORDER BY timestamp ASC',
    [boardId]
  );
  return result.rows;
};

const getLatestSnapshot = async (boardId) => {
  const result = await pool.query(
    'SELECT * FROM snapshots WHERE board_id = $1 ORDER BY timestamp DESC LIMIT 1',
    [boardId]
  );
  return result.rows[0] || null;
};

module.exports = { pool, initDatabase, saveSnapshot, getSnapshots, getLatestSnapshot };
