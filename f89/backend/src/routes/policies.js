const express = require('express');
const AuthPolicy = require('../models/AuthPolicy');
const DeviceFingerprint = require('../models/DeviceFingerprint');
const AuthLog = require('../models/AuthLog');
const PolicyEngine = require('../utils/policyEngine');
const { authMiddleware } = require('../utils/jwt');

const router = express.Router();

router.get('/conditions', authMiddleware, (req, res) => {
  try {
    const conditions = PolicyEngine.getAvailableConditions();
    res.json({ conditions });
  } catch (error) {
    console.error('Get conditions error:', error);
    res.status(500).json({ error: 'Failed to get conditions' });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const policies = await AuthPolicy.findByUser(req.userId);
    res.json({ policies });
  } catch (error) {
    console.error('Get policies error:', error);
    res.status(500).json({ error: 'Failed to get policies' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, description, conditions, requiredFactors, priority } = req.body;

    if (!name || !requiredFactors) {
      return res.status(400).json({ error: 'Name and required factors are required' });
    }

    const validFactors = ['webauthn', 'totp', 'backup'];
    const invalidFactors = requiredFactors.filter(f => !validFactors.includes(f));
    if (invalidFactors.length > 0) {
      return res.status(400).json({ error: `Invalid factors: ${invalidFactors.join(', ')}` });
    }

    const policy = await AuthPolicy.create(
      req.userId,
      name,
      description || '',
      conditions || {},
      requiredFactors,
      priority || 0
    );

    res.json({ policy });
  } catch (error) {
    console.error('Create policy error:', error);
    res.status(500).json({ error: 'Failed to create policy' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { name, description, conditions, requiredFactors, priority, isActive } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (conditions !== undefined) updates.conditions = conditions;
    if (requiredFactors !== undefined) {
      const validFactors = ['webauthn', 'totp', 'backup'];
      const invalidFactors = requiredFactors.filter(f => !validFactors.includes(f));
      if (invalidFactors.length > 0) {
        return res.status(400).json({ error: `Invalid factors: ${invalidFactors.join(', ')}` });
      }
      updates.requiredFactors = requiredFactors;
    }
    if (priority !== undefined) updates.priority = priority;
    if (isActive !== undefined) updates.isActive = isActive;

    const policy = await AuthPolicy.update(req.params.id, req.userId, updates);

    if (!policy) {
      return res.status(404).json({ error: 'Policy not found' });
    }

    res.json({ policy });
  } catch (error) {
    console.error('Update policy error:', error);
    res.status(500).json({ error: 'Failed to update policy' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const policy = await AuthPolicy.findById(req.params.id);
    
    if (!policy || policy.user_id !== req.userId) {
      return res.status(404).json({ error: 'Policy not found' });
    }

    if (policy.is_default) {
      return res.status(400).json({ error: 'Cannot delete default policy' });
    }

    await AuthPolicy.delete(req.params.id, req.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete policy error:', error);
    res.status(500).json({ error: 'Failed to delete policy' });
  }
});

router.post('/:id/set-default', authMiddleware, async (req, res) => {
  try {
    const policy = await AuthPolicy.findById(req.params.id);
    
    if (!policy || policy.user_id !== req.userId) {
      return res.status(404).json({ error: 'Policy not found' });
    }

    await AuthPolicy.setDefault(req.userId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Set default policy error:', error);
    res.status(500).json({ error: 'Failed to set default policy' });
  }
});

router.post('/init-default', authMiddleware, async (req, res) => {
  try {
    const existingPolicies = await AuthPolicy.findByUser(req.userId);
    
    if (existingPolicies.length > 0) {
      return res.status(400).json({ error: 'Policies already exist' });
    }

    const policies = await PolicyEngine.createDefaultPolicies(req.userId);
    res.json({ policies });
  } catch (error) {
    console.error('Init default policies error:', error);
    res.status(500).json({ error: 'Failed to initialize policies' });
  }
});

router.get('/devices', authMiddleware, async (req, res) => {
  try {
    const devices = await DeviceFingerprint.findByUser(req.userId);
    res.json({ devices });
  } catch (error) {
    console.error('Get devices error:', error);
    res.status(500).json({ error: 'Failed to get devices' });
  }
});

router.put('/devices/:fingerprint/trust', authMiddleware, async (req, res) => {
  try {
    const { trusted } = req.body;
    await DeviceFingerprint.setTrusted(req.userId, req.params.fingerprint, trusted);
    res.json({ success: true });
  } catch (error) {
    console.error('Set device trust error:', error);
    res.status(500).json({ error: 'Failed to update device trust' });
  }
});

router.put('/devices/:fingerprint/name', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    await DeviceFingerprint.updateDeviceName(req.userId, req.params.fingerprint, name);
    res.json({ success: true });
  } catch (error) {
    console.error('Set device name error:', error);
    res.status(500).json({ error: 'Failed to update device name' });
  }
});

router.delete('/devices/:fingerprint', authMiddleware, async (req, res) => {
  try {
    await DeviceFingerprint.delete(req.userId, req.params.fingerprint);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

router.get('/logs', authMiddleware, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const logs = await AuthLog.findByUser(req.userId, parseInt(limit));
    res.json({ logs });
  } catch (error) {
    console.error('Get auth logs error:', error);
    res.status(500).json({ error: 'Failed to get auth logs' });
  }
});

module.exports = router;
