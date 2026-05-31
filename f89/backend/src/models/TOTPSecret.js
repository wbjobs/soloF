const db = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');

class TOTPSecret {
  static async create(userId, secret) {
    const encryptedSecret = encrypt(secret);
    const result = await db.query(
      `INSERT INTO totp_secrets (user_id, encrypted_secret)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET encrypted_secret = $2
       RETURNING *`,
      [userId, encryptedSecret]
    );
    return result.rows[0];
  }

  static async findByUserId(userId) {
    const result = await db.query(
      'SELECT * FROM totp_secrets WHERE user_id = $1',
      [userId]
    );
    if (result.rows.length === 0) return null;
    
    const record = result.rows[0];
    record.secret = decrypt(record.encrypted_secret);
    return record;
  }

  static async delete(userId) {
    await db.query(
      'DELETE FROM totp_secrets WHERE user_id = $1',
      [userId]
    );
  }
}

module.exports = TOTPSecret;
