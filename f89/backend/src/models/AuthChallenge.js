const db = require('../config/database');

class AuthChallenge {
  static async create(userId, challenge, type, expiresInMinutes = 5) {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + expiresInMinutes);
    
    const result = await db.query(
      `INSERT INTO auth_challenges (user_id, challenge, type, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, challenge, type, expiresAt]
    );
    return result.rows[0];
  }

  static async findAndVerify(userId, challenge, type) {
    const result = await db.query(
      `SELECT * FROM auth_challenges 
       WHERE user_id = $1 AND challenge = $2 AND type = $3 
       AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC LIMIT 1`,
      [userId, challenge, type]
    );
    
    if (result.rows.length === 0) return null;

    await db.query(
      'DELETE FROM auth_challenges WHERE id = $1',
      [result.rows[0].id]
    );

    return result.rows[0];
  }

  static async cleanupExpired() {
    await db.query(
      'DELETE FROM auth_challenges WHERE expires_at < CURRENT_TIMESTAMP'
    );
  }
}

module.exports = AuthChallenge;
