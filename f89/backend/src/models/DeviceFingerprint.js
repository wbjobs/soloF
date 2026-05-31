const db = require('../config/database');

class DeviceFingerprint {
  static async findOrCreate(userId, fingerprint, userAgent, ipAddress) {
    const existing = await db.query(
      'SELECT * FROM device_fingerprints WHERE user_id = $1 AND fingerprint = $2',
      [userId, fingerprint]
    );

    if (existing.rows.length > 0) {
      await db.query(
        'UPDATE device_fingerprints SET last_used_at = CURRENT_TIMESTAMP, ip_address = $3 WHERE id = $1',
        [existing.rows[0].id, ipAddress]
      );
      return existing.rows[0];
    }

    const result = await db.query(
      `INSERT INTO device_fingerprints (user_id, fingerprint, user_agent, ip_address)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, fingerprint, userAgent, ipAddress]
    );
    return result.rows[0];
  }

  static async findByUserAndFingerprint(userId, fingerprint) {
    const result = await db.query(
      'SELECT * FROM device_fingerprints WHERE user_id = $1 AND fingerprint = $2',
      [userId, fingerprint]
    );
    return result.rows[0];
  }

  static async findByUser(userId) {
    const result = await db.query(
      'SELECT * FROM device_fingerprints WHERE user_id = $1 ORDER BY last_used_at DESC',
      [userId]
    );
    return result.rows;
  }

  static async setTrusted(userId, fingerprint, isTrusted) {
    await db.query(
      'UPDATE device_fingerprints SET is_trusted = $3 WHERE user_id = $1 AND fingerprint = $2',
      [userId, fingerprint, isTrusted]
    );
  }

  static async updateDeviceName(userId, fingerprint, deviceName) {
    await db.query(
      'UPDATE device_fingerprints SET device_name = $3 WHERE user_id = $1 AND fingerprint = $2',
      [userId, fingerprint, deviceName]
    );
  }

  static async delete(userId, fingerprint) {
    await db.query(
      'DELETE FROM device_fingerprints WHERE user_id = $1 AND fingerprint = $2',
      [userId, fingerprint]
    );
  }

  static async isTrustedDevice(userId, fingerprint) {
    const result = await db.query(
      'SELECT is_trusted FROM device_fingerprints WHERE user_id = $1 AND fingerprint = $2',
      [userId, fingerprint]
    );
    return result.rows.length > 0 && result.rows[0].is_trusted;
  }

  static async isNewDevice(userId, fingerprint) {
    const result = await db.query(
      'SELECT created_at FROM device_fingerprints WHERE user_id = $1 AND fingerprint = $2',
      [userId, fingerprint]
    );
    return result.rows.length === 0;
  }
}

module.exports = DeviceFingerprint;
