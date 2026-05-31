const pool = require('../config/database');

class DataService {
  async insertSensorData(devEui, humidity, temperature, conductivity, timestamp) {
    const query = `
      INSERT INTO sensor_data (dev_eui, humidity, temperature, conductivity, timestamp)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;
    const values = [devEui, humidity, temperature, conductivity, timestamp || new Date()];
    
    try {
      if (conductivity < 0) {
        console.warn(`[WARN] Device ${devEui} reported negative conductivity (${conductivity}), indicating sensor fault. Storing for diagnostic purposes.`);
      }
      
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('[ERROR] Error inserting sensor data:', error.message);
      throw error;
    }
  }

  async getRecentDataByDevEui(devEui, hours = 24) {
    const query = `
      SELECT humidity, temperature, conductivity, timestamp
      FROM sensor_data
      WHERE dev_eui = $1 AND timestamp >= NOW() - INTERVAL '${hours} hours'
      ORDER BY timestamp ASC
    `;
    
    try {
      const result = await pool.query(query, [devEui]);
      return result.rows;
    } catch (error) {
      console.error('Error getting sensor data:', error);
      throw error;
    }
  }

  async getAllSensorNodes() {
    const query = `
      SELECT dev_eui, name, location, created_at
      FROM sensor_nodes
      ORDER BY id ASC
    `;
    
    try {
      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Error getting sensor nodes:', error);
      throw error;
    }
  }

  async getLatestDataForAllNodes() {
    const query = `
      SELECT DISTINCT ON (dev_eui)
        sd.dev_eui,
        sn.name,
        sn.location,
        sd.humidity,
        sd.temperature,
        sd.conductivity,
        sd.timestamp
      FROM sensor_data sd
      JOIN sensor_nodes sn ON sd.dev_eui = sn.dev_eui
      ORDER BY dev_eui, timestamp DESC
    `;
    
    try {
      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Error getting latest data:', error);
      throw error;
    }
  }
}

module.exports = new DataService();
