const express = require('express');
const User = require('../models/User');
const DeviceFingerprint = require('../models/DeviceFingerprint');
const AuthLog = require('../models/AuthLog');
const PolicyEngine = require('../utils/policyEngine');
const { generateToken, authMiddleware } = require('../utils/jwt');

const router = express.Router();

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || 
         req.connection.remoteAddress || 
         req.ip;
}

router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const user = await User.create(email, password);
    const token = generateToken(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        webauthnEnabled: user.webauthn_enabled,
        totpEnabled: user.totp_enabled,
        backupCodesEnabled: user.backup_codes_enabled,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password, deviceFingerprint } = req.body;
    const userAgent = req.headers['user-agent'];
    const ipAddress = getClientIp(req);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordValid = await User.verifyPassword(user.id, password);
    if (!passwordValid) {
      await AuthLog.create({
        userId: user.id,
        deviceFingerprint,
        ipAddress,
        userAgent,
        authFactors: ['password'],
        success: false,
        failureReason: 'Invalid password'
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const factors = await User.getEnabledFactors(user.id);
    const enabledFactors = [];
    
    if (factors.webauthn_enabled) enabledFactors.push('webauthn');
    if (factors.totp_enabled) enabledFactors.push('totp');
    if (factors.backup_codes_enabled) enabledFactors.push('backup');

    if (enabledFactors.length === 0) {
      const token = generateToken(user.id);
      
      if (deviceFingerprint) {
        await DeviceFingerprint.findOrCreate(user.id, deviceFingerprint, userAgent, ipAddress);
      }
      
      await AuthLog.create({
        userId: user.id,
        deviceFingerprint,
        ipAddress,
        userAgent,
        authFactors: ['password'],
        success: true
      });

      return res.json({
        token,
        mfaRequired: false,
        user: {
          id: user.id,
          email: user.email,
          webauthnEnabled: user.webauthn_enabled,
          totpEnabled: user.totp_enabled,
          backupCodesEnabled: user.backup_codes_enabled,
        },
      });
    }

    const isNewDevice = deviceFingerprint 
      ? await DeviceFingerprint.isNewDevice(user.id, deviceFingerprint)
      : true;

    if (deviceFingerprint) {
      await DeviceFingerprint.findOrCreate(user.id, deviceFingerprint, userAgent, ipAddress);
    }

    const policyResult = await PolicyEngine.evaluatePolicy(user.id, {
      userId: user.id,
      fingerprint: deviceFingerprint || 'unknown',
      userAgent,
      ipAddress,
      isNewDevice,
      enabledFactors: {
        webauthn: factors.webauthn_enabled,
        totp: factors.totp_enabled,
        backup: factors.backup_codes_enabled
      },
      currentTime: new Date()
    });

    const availableFactors = policyResult.requiredFactors.filter(f => enabledFactors.includes(f));
    
    if (availableFactors.length === 0) {
      const token = generateToken(user.id);
      
      await AuthLog.create({
        userId: user.id,
        deviceFingerprint,
        ipAddress,
        userAgent,
        authFactors: ['password'],
        policyApplied: policyResult.policyId,
        success: true
      });

      return res.json({
        token,
        mfaRequired: false,
        user: {
          id: user.id,
          email: user.email,
          webauthnEnabled: user.webauthn_enabled,
          totpEnabled: user.totp_enabled,
          backupCodesEnabled: user.backup_codes_enabled,
        },
      });
    }

    res.json({
      mfaRequired: true,
      userId: user.id,
      enabledFactors: availableFactors,
      policyApplied: policyResult.policyName,
      isNewDevice
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        webauthnEnabled: user.webauthn_enabled,
        totpEnabled: user.totp_enabled,
        backupCodesEnabled: user.backup_codes_enabled,
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

module.exports = router;
