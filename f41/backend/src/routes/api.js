const express = require('express');
const router = express.Router();
const dataService = require('../services/dataService');
const { loadRules, saveRules } = require('../config/alertRules');

router.get('/nodes', async (req, res) => {
  try {
    const nodes = await dataService.getAllSensorNodes();
    res.json(nodes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sensor nodes' });
  }
});

router.get('/data/:devEui', async (req, res) => {
  try {
    const { devEui } = req.params;
    const { hours = 24 } = req.query;
    const data = await dataService.getRecentDataByDevEui(devEui, hours);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sensor data' });
  }
});

router.get('/data/latest', async (req, res) => {
  try {
    const data = await dataService.getLatestDataForAllNodes();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch latest data' });
  }
});

router.get('/alert-rules', (req, res) => {
  try {
    const rules = loadRules();
    res.json(rules);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load alert rules' });
  }
});

router.put('/alert-rules', (req, res) => {
  try {
    const newRules = req.body;
    
    if (!newRules.conductivity || !newRules.humidity || !newRules.temperature) {
      return res.status(400).json({ error: 'Invalid rules format' });
    }

    const success = saveRules(newRules);
    
    if (success) {
      res.json({ success: true, rules: newRules });
    } else {
      res.status(500).json({ error: 'Failed to save alert rules' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
