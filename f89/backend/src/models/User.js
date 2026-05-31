const db = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  static async findByEmail(email) {
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  static async create(email, password) {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *',
      [email, passwordHash]
    );
    return result.rows[0];
  }

  static async verifyPassword(userId, password) {
    const result = await db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) return false;
    return bcrypt.compare(password, result.rows[0].password_hash);
  }

  static async updateMFAStatus(userId, webauthnEnabled, totpEnabled, backupCodesEnabled) {
    const result = await db.query(
      `UPDATE users 
       SET webauthn_enabled = $1, totp_enabled = $2, backup_codes_enabled = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [webauthnEnabled, totpEnabled, backupCodesEnabled, userId]
    );
    return result.rows[0];
  }

  static async getEnabledFactors(userId) {
    const result = await db.query(
      'SELECT webauthn_enabled, totp_enabled, backup_codes_enabled FROM users WHERE id = $1',
      [userId]
    );
    return result.rows[0];
  }
}

module.exports = User;
