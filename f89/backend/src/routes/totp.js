const express = require('express');
const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const User = require('../models/User');
const TOTPSecret = require('../models/TOTPSecret');
const { authMiddleware, generateToken } = require('../utils/jwt');

const router = express.Router();

router.get('/setup', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email, process.env.RP_NAME, secret);

    const qrCodeUrl = await qrcode.toDataURL(otpauth);

    res.json({
      secret,
      qrCodeUrl,
      otpauth,
    });
  } catch (error) {
    console.error('TOTP setup error:', error);
    res.status(500).json({ error: 'Failed to setup TOTP' });
  }
});

router.post('/verify-setup', authMiddleware, async (req, res) => {
  try {
    const { secret, token } = req.body;
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = authenticator.check(token, secret);

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid TOTP token' });
    }

    await TOTPSecret.create(user.id, secret);
    await User.updateMFAStatus(
      user.id,
      user.webauthn_enabled,
      true,
      user.backup_codes_enabled
    );

    res.json({ success: true });
  } catch (error) {
    console.error('TOTP verify setup error:', error);
    res.status(500).json({ error: 'Failed to verify TOTP setup' });
  }
});

router.post('/disable', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    await TOTPSecret.delete(req.userId);
    await User.updateMFAStatus(
      req.userId,
      user.webauthn_enabled,
      false,
      user.backup_codes_enabled
    );

    res.json({ success: true });
  } catch (error) {
    console.error('TOTP disable error:', error);
    res.status(500).json({ error: 'Failed to disable TOTP' });
  }
});

router.post('/auth', async (req, res) => {
  try {
    const { userId, token } = req.body;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const totpRecord = await TOTPSecret.findByUserId(userId);
    if (!totpRecord) {
      return res.status(400).json({ error: 'TOTP not enabled' });
    }

    const isValid = authenticator.check(token, totpRecord.secret);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid TOTP token' });
    }

    const authToken = generateToken(user.id);
    res.json({
      success: true,
      token: authToken,
      user: {
        id: user.id,
        email: user.email,
        webauthnEnabled: user.webauthn_enabled,
        totpEnabled: user.totp_enabled,
        backupCodesEnabled: user.backup_codes_enabled,
      },
    });
  } catch (error) {
    console.error('TOTP auth error:', error);
    res.status(500).json({ error: 'TOTP authentication failed' });
  }
});

module.exports = router;
