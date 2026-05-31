const db = require('../config/database');

class AuthPolicy {
  static async create(userId, name, description, conditions, requiredFactors, priority = 0) {
    const result = await db.query(
      `INSERT INTO auth_policies (user_id, name, description, conditions, required_factors, priority)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, name, description, JSON.stringify(conditions), JSON.stringify(requiredFactors), priority]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await db.query(
      'SELECT * FROM auth_policies WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  static async findByUser(userId) {
    const result = await db.query(
      'SELECT * FROM auth_policies WHERE user_id = $1 ORDER BY priority DESC, created_at ASC',
      [userId]
    );
    return result.rows;
  }

  static async findActiveByUser(userId) {
    const result = await db.query(
      'SELECT * FROM auth_policies WHERE user_id = $1 AND is_active = TRUE ORDER BY priority DESC, created_at ASC',
      [userId]
    );
    return result.rows;
  }

  static async setDefault(userId, policyId) {
    await db.query(
      'UPDATE auth_policies SET is_default = FALSE WHERE user_id = $1',
      [userId]
    );
    await db.query(
      'UPDATE auth_policies SET is_default = TRUE WHERE id = $1 AND user_id = $2',
      [policyId, userId]
    );
  }

  static async update(id, userId, updates) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.conditions !== undefined) {
      fields.push(`conditions = $${paramIndex++}`);
      values.push(JSON.stringify(updates.conditions));
    }
    if (updates.requiredFactors !== undefined) {
      fields.push(`required_factors = $${paramIndex++}`);
      values.push(JSON.stringify(updates.requiredFactors));
    }
    if (updates.priority !== undefined) {
      fields.push(`priority = $${paramIndex++}`);
      values.push(updates.priority);
    }
    if (updates.isActive !== undefined) {
      fields.push(`is_active = $${paramIndex++}`);
      values.push(updates.isActive);
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);

    values.push(id);
    values.push(userId);

    const result = await db.query(
      `UPDATE auth_policies SET ${fields.join(', ')} 
       WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1} RETURNING *`,
      values
    );
    return result.rows[0];
  }

  static async delete(id, userId) {
    await db.query(
      'DELETE FROM auth_policies WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
  }
}

module.exports = AuthPolicy;
