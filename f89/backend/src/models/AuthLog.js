const db = require('../config/database');

class AuthLog {
  static async create(data) {
    const result = await db.query(
      `INSERT INTO auth_logs 
       (user_id, device_fingerprint, ip_address, location, auth_factors, policy_applied, success, failure_reason, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        data.userId,
        data.deviceFingerprint,
        data.ipAddress,
        data.location,
        data.authFactors,
        data.policyApplied,
        data.success,
        data.failureReason,
        data.userAgent
      ]
    );
    return result.rows[0];
  }

  static async findByUser(userId, limit = 50) {
    const result = await db.query(
      'SELECT * FROM auth_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows;
  }

  static async hasRecentSuccess(userId, fingerprint, hours = 24) {
    const result = await db.query(
      `SELECT 1 FROM auth_logs 
       WHERE user_id = $1 AND device_fingerprint = $2 
       AND success = TRUE 
       AND created_at > NOW() - INTERVAL '$3 hours'
       LIMIT 1`,
      [userId, fingerprint, hours]
    );
    return result.rows.length > 0;
  }

  static async getRecentFailures(userId, fingerprint, hours = 1) {
    const result = await db.query(
      `SELECT COUNT(*) as count FROM auth_logs 
       WHERE user_id = $1 AND device_fingerprint = $2 
       AND success = FALSE 
       AND created_at > NOW() - INTERVAL '$3 hours'`,
      [userId, fingerprint, hours]
    );
    return parseInt(result.rows[0].count);
  }
}

module.exports = AuthLog;
