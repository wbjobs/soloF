const db = require('../config/database');

class WebAuthnCredential {
  static async create(userId, credentialId, publicKey, counter, transports, deviceName) {
    const result = await db.query(
      `INSERT INTO webauthn_credentials 
       (user_id, credential_id, public_key, counter, transports, device_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, credentialId, publicKey, counter, transports, deviceName]
    );
    return result.rows[0];
  }

  static async findByCredentialId(credentialId) {
    const result = await db.query(
      'SELECT * FROM webauthn_credentials WHERE credential_id = $1',
      [credentialId]
    );
    return result.rows[0];
  }

  static async findByUserId(userId) {
    const result = await db.query(
      'SELECT * FROM webauthn_credentials WHERE user_id = $1',
      [userId]
    );
    return result.rows;
  }

  static async updateCounter(credentialId, counter) {
    await db.query(
      'UPDATE webauthn_credentials SET counter = $1 WHERE credential_id = $2',
      [counter, credentialId]
    );
  }

  static async delete(credentialId) {
    await db.query(
      'DELETE FROM webauthn_credentials WHERE credential_id = $1',
      [credentialId]
    );
  }
}

module.exports = WebAuthnCredential;
