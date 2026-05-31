const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const BackupCode = require('../models/BackupCode');
const { authMiddleware, generateToken } = require('../utils/jwt');

const router = express.Router();

function generateBackupCode() {
  const bytes = crypto.randomBytes(4);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`.toUpperCase();
}

router.get('/generate', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const codes = [];
    for (let i = 0; i < 10; i++) {
      codes.push(generateBackupCode());
    }

    await BackupCode.deleteAllByUserId(req.userId);
    await BackupCode.createMultiple(req.userId, codes);

    await User.updateMFAStatus(
      req.userId,
      user.webauthn_enabled,
      user.totp_enabled,
      true
    );

    res.json({ codes });
  } catch (error) {
    console.error('Generate backup codes error:', error);
    res.status(500).json({ error: 'Failed to generate backup codes' });
  }
});

router.get('/list', authMiddleware, async (req, res) => {
  try {
    const codes = await BackupCode.findByUserId(req.userId);
    res.json({
      codes: codes.map((code) => ({
        id: code.id,
        used: code.used,
        createdAt: code.created_at,
        usedAt: code.used_at,
      })),
    });
  } catch (error) {
    console.error('List backup codes error:', error);
    res.status(500).json({ error: 'Failed to list backup codes' });
  }
});

router.post('/disable', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    await BackupCode.deleteAllByUserId(req.userId);
    await User.updateMFAStatus(
      req.userId,
      user.webauthn_enabled,
      user.totp_enabled,
      false
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Disable backup codes error:', error);
    res.status(500).json({ error: 'Failed to disable backup codes' });
  }
});

router.post('/auth', async (req, res) => {
  try {
    const { userId, code } = req.body;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = await BackupCode.verify(userId, code.toUpperCase());

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid or used backup code' });
    }

    const token = generateToken(user.id);
    res.json({
      success: true,
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
    console.error('Backup code auth error:', error);
    res.status(500).json({ error: 'Backup code authentication failed' });
  }
});

module.exports = router;
