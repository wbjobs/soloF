const db = require('../config/database');
const { hashBackupCode } = require('../utils/encryption');

class BackupCode {
  static async create(userId, code) {
    const codeHash = hashBackupCode(code);
    const result = await db.query(
      `INSERT INTO backup_codes (user_id, code_hash)
       VALUES ($1, $2) RETURNING *`,
      [userId, codeHash]
    );
    return result.rows[0];
  }

  static async createMultiple(userId, codes) {
    const values = codes.map((_, i) => `($1, $${i + 2})`).join(', ');
    const hashes = codes.map(code => hashBackupCode(code));
    
    const result = await db.query(
      `INSERT INTO backup_codes (user_id, code_hash)
       VALUES ${values} RETURNING *`,
      [userId, ...hashes]
    );
    return result.rows;
  }

  static async findByUserId(userId) {
    const result = await db.query(
      'SELECT id, used, created_at, used_at FROM backup_codes WHERE user_id = $1',
      [userId]
    );
    return result.rows;
  }

  static async verify(userId, code) {
    const codeHash = hashBackupCode(code);
    const result = await db.query(
      `SELECT * FROM backup_codes 
       WHERE user_id = $1 AND code_hash = $2 AND used = FALSE`,
      [userId, codeHash]
    );
    
    if (result.rows.length === 0) return false;

    await db.query(
      `UPDATE backup_codes 
       SET used = TRUE, used_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [result.rows[0].id]
    );
    
    return true;
  }

  static async deleteAllByUserId(userId) {
    await db.query(
      'DELETE FROM backup_codes WHERE user_id = $1',
      [userId]
    );
  }
}

module.exports = BackupCode;
