const { Pool } = require('pg');

class PgStatementsAnalyzer {
  constructor() {
    this.connections = new Map();
    this.initConnections();
  }

  initConnections() {
    const services = ['users', 'orders', 'products'];
    
    services.forEach(service => {
      const pool = new Pool({
        host: process.env[`${service.toUpperCase()}_DB_HOST`] || 'localhost',
        port: process.env[`${service.toUpperCase()}_DB_PORT`] || 5432,
        database: process.env[`${service.toUpperCase()}_DB_NAME`] || service,
        user: process.env[`${service.toUpperCase()}_DB_USER`] || 'postgres',
        password: process.env[`${service.toUpperCase()}_DB_PASSWORD`] || 'postgres',
      });
      
      this.connections.set(service, pool);
    });
  }

  async analyzeFingerprint(fingerprint) {
    const results = {
      frequentQueries: [],
      totalQueries: 0,
      slowQueriesCount: 0,
    };

    for (const [service, pool] of this.connections) {
      try {
        const serviceResults = await this.analyzeServiceFingerprint(pool, fingerprint, service);
        results.frequentQueries.push(...serviceResults.frequentQueries);
        results.totalQueries += serviceResults.totalQueries;
        results.slowQueriesCount += serviceResults.slowQueriesCount;
      } catch (e) {
        console.warn(`Could not analyze ${service} DB:`, e.message);
      }
    }

    return results;
  }

  async analyzeServiceFingerprint(pool, fingerprint, service) {
    const frequentQueries = [];
    
    try {
      const query = `
        SELECT 
          queryid,
          query,
          calls,
          total_time,
          mean_time,
          rows,
          shared_blks_hit,
          shared_blks_read
        FROM pg_stat_statements
        WHERE query ILIKE $1
        ORDER BY total_time DESC
        LIMIT 20
      `;

      const searchPattern = `%${fingerprint.substring(0, 50)}%`;
      const result = await pool.query(query, [searchPattern]);

      result.rows.forEach(row => {
        frequentQueries.push({
          ...row,
          service,
        });
      });

      const statsQuery = `
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE mean_time > 100) as slow_count
        FROM pg_stat_statements
      `;
      
      const statsResult = await pool.query(statsQuery);

      return {
        frequentQueries,
        totalQueries: parseInt(statsResult.rows[0].total),
        slowQueriesCount: parseInt(statsResult.rows[0].slow_count),
      };

    } catch (e) {
      if (e.message.includes('pg_stat_statements')) {
        await this.enablePgStatStatements(pool);
      }
      return { frequentQueries: [], totalQueries: 0, slowQueriesCount: 0 };
    }
  }

  async enablePgStatStatements(pool) {
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
    } catch (e) {
      console.warn('Could not enable pg_stat_statements:', e.message);
    }
  }

  async getTopQueries(service, limit = 10) {
    const pool = this.connections.get(service);
    if (!pool) return [];

    try {
      const query = `
        SELECT 
          queryid,
          query,
          calls,
          total_time,
          mean_time,
          max_time,
          rows,
          shared_blks_hit,
          shared_blks_read
        FROM pg_stat_statements
        ORDER BY total_time DESC
        LIMIT $1
      `;

      const result = await pool.query(query, [limit]);
      return result.rows;
    } catch (e) {
      console.warn('Error getting top queries:', e.message);
      return [];
    }
  }

  async getMissingIndexes(service) {
    const pool = this.connections.get(service);
    if (!pool) return [];

    try {
      const query = `
        SELECT 
          schemaname,
          tablename,
          attname as column_name,
          null_frac,
          avg_width,
          n_distinct
        FROM pg_stats
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        AND null_frac > 0.1
        ORDER BY null_frac DESC
      `;

      const result = await pool.query(query);
      return result.rows;
    } catch (e) {
      console.warn('Error getting missing indexes:', e.message);
      return [];
    }
  }

  async getIndexUsage(service) {
    const pool = this.connections.get(service);
    if (!pool) return [];

    try {
      const query = `
        SELECT 
          schemaname,
          tablename,
          indexrelname as index_name,
          idx_scan,
          idx_tup_read,
          idx_tup_fetch
        FROM pg_stat_user_indexes
        ORDER BY idx_scan ASC
      `;

      const result = await pool.query(query);
      return result.rows;
    } catch (e) {
      console.warn('Error getting index usage:', e.message);
      return [];
    }
  }

  async close() {
    for (const pool of this.connections.values()) {
      await pool.end();
    }
  }
}

const pgStatementsAnalyzer = new PgStatementsAnalyzer();

module.exports = { pgStatementsAnalyzer };
