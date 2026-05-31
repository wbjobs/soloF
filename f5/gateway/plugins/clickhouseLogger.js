const { createClient } = require('@clickhouse/client');

class ClickHouseLogger {
  constructor() {
    this.client = null;
    this.buffer = [];
    this.flushInterval = null;
    this.isInitialized = false;
    this.init();
  }

  async init() {
    try {
      this.client = createClient({
        host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
        username: process.env.CLICKHOUSE_USER || 'default',
        password: process.env.CLICKHOUSE_PASSWORD || '',
        database: process.env.CLICKHOUSE_DB || 'graphql_analytics',
      });

      await this.setupSchema();
      this.isInitialized = true;
      
      this.flushInterval = setInterval(() => this.flush(), 5000);
      
      console.log('ClickHouse logger initialized');
    } catch (e) {
      console.warn('ClickHouse not available, logging disabled:', e.message);
      this.isInitialized = false;
    }
  }

  async setupSchema() {
    await this.client.exec({
      query: `
        CREATE DATABASE IF NOT EXISTS graphql_analytics
      `,
    });

    await this.client.exec({
      query: `
        CREATE TABLE IF NOT EXISTS query_logs (
          timestamp DateTime,
          request_id String,
          query_hash String,
          operation_name String,
          query String,
          duration_ms Float64,
          has_errors Bool,
          error_message Nullable(String),
          type String DEFAULT 'normal',
          n_plus_one_details Nullable(String),
          variables String
        )
        ENGINE = MergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (timestamp, query_hash)
        TTL timestamp + INTERVAL 30 DAY
      `,
    });

    await this.client.exec({
      query: `
        CREATE TABLE IF NOT EXISTS index_recommendations (
          timestamp DateTime,
          recommendation_id String,
          query_hash String,
          operation_name String,
          table_name String,
          columns Array(String),
          index_type String,
          create_statement String,
          confidence String,
          expected_improvement_percent Float64,
          source String,
          query_fingerprint String
        )
        ENGINE = MergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (timestamp, table_name)
        TTL timestamp + INTERVAL 90 DAY
      `,
    });
  }

  logQuery(queryLog) {
    if (!this.isInitialized) return;

    this.buffer.push({
      table: 'query_logs',
      values: {
        timestamp: new Date(queryLog.timestamp),
        request_id: queryLog.requestId || '',
        query_hash: queryLog.queryHash || '',
        operation_name: queryLog.operationName || '',
        query: queryLog.query.substring(0, 8192),
        duration_ms: queryLog.duration,
        has_errors: queryLog.hasErrors || false,
        error_message: queryLog.errorMessage || null,
        type: queryLog.type || 'normal',
        n_plus_one_details: queryLog.nPlusOneDetails 
          ? JSON.stringify(queryLog.nPlusOneDetails) 
          : null,
        variables: JSON.stringify(queryLog.variables || {}),
      },
    });
  }

  logRecommendation(rec) {
    if (!this.isInitialized) return;

    this.buffer.push({
      table: 'index_recommendations',
      values: {
        timestamp: new Date(rec.detectedAt || new Date()),
        recommendation_id: rec.id,
        query_hash: rec.queryHash || '',
        operation_name: rec.operationName || '',
        table_name: rec.tableName,
        columns: rec.columns,
        index_type: rec.indexType,
        create_statement: rec.createStatement,
        confidence: rec.confidence,
        expected_improvement_percent: rec.expectedImprovement?.percentage || 0,
        source: rec.source,
        query_fingerprint: rec.queryFingerprint || '',
      },
    });
  }

  async flush() {
    if (this.buffer.length === 0 || !this.isInitialized) return;

    try {
      const queries = this.buffer.filter(b => b.table === 'query_logs').map(b => b.values);
      const recs = this.buffer.filter(b => b.table === 'index_recommendations').map(b => b.values);

      if (queries.length > 0) {
        await this.client.insert({
          table: 'query_logs',
          values: queries,
          format: 'JSONEachRow',
        });
      }

      if (recs.length > 0) {
        await this.client.insert({
          table: 'index_recommendations',
          values: recs,
          format: 'JSONEachRow',
        });
      }

      this.buffer = [];
    } catch (e) {
      console.warn('Error flushing to ClickHouse:', e.message);
    }
  }

  async getQueryTrends(hours = 24) {
    if (!this.isInitialized) return [];

    try {
      const result = await this.client.query({
        query: `
          SELECT 
            toStartOfHour(timestamp) as hour,
            COUNT(*) as query_count,
            AVG(duration_ms) as avg_duration,
            SUM(if(type = 'N+1', 1, 0)) as n_plus_one_count,
            SUM(if(duration_ms > 500, 1, 0)) as slow_query_count
          FROM query_logs
          WHERE timestamp > now() - INTERVAL ${hours} HOUR
          GROUP BY hour
          ORDER BY hour ASC
        `,
        format: 'JSONEachRow',
      });

      return await result.json();
    } catch (e) {
      console.warn('Error getting query trends:', e.message);
      return [];
    }
  }

  async getTopSlowQueries(limit = 10) {
    if (!this.isInitialized) return [];

    try {
      const result = await this.client.query({
        query: `
          SELECT 
            query_hash,
            operation_name,
            COUNT(*) as call_count,
            AVG(duration_ms) as avg_duration,
            MAX(duration_ms) as max_duration,
            any(substring(query, 1, 200)) as sample_query
          FROM query_logs
          WHERE duration_ms > 500
          GROUP BY query_hash, operation_name
          ORDER BY avg_duration DESC
          LIMIT ${limit}
        `,
        format: 'JSONEachRow',
      });

      return await result.json();
    } catch (e) {
      console.warn('Error getting top slow queries:', e.message);
      return [];
    }
  }

  async close() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flush();
  }
}

const clickhouseLogger = new ClickHouseLogger();

const plugin = {
  requestDidStart(requestContext) {
    return {
      async willSendResponse(context) {
        const queryLog = {
          requestId: context.context.requestId,
          queryHash: context.context.queryHash,
          operationName: context.context.operationName,
          query: context.request.query,
          variables: context.request.variables,
          duration: Date.now() - (context.context.startTime || Date.now()),
          timestamp: new Date().toISOString(),
          hasErrors: !!context.errors,
          errorMessage: context.errors?.[0]?.message,
        };

        clickhouseLogger.logQuery(queryLog);
      },
    };
  },
};

module.exports = { clickhouseLogger, plugin: clickhouseLogger };
