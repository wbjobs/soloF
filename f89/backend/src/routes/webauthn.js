const express = require('express');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const User = require('../models/User');
const WebAuthnCredential = require('../models/WebAuthnCredential');
const AuthChallenge = require('../models/AuthChallenge');
const { authMiddleware, generateToken } = require('../utils/jwt');

const router = express.Router();

const rpName = process.env.RP_NAME;
const rpID = process.env.RP_ID;
const origin = process.env.ORIGIN;

router.post('/register/options', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const credentials = await WebAuthnCredential.findByUserId(user.id);

    const options = generateRegistrationOptions({
      rpName,
      rpID,
      userID: user.id,
      userName: user.email,
      attestationType: 'none',
      excludeCredentials: credentials.map((cred) => ({
        id: cred.credential_id,
        type: 'public-key',
        transports: cred.transports,
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
        requireResidentKey: true,
      },
    });

    await AuthChallenge.create(user.id, options.challenge, 'webauthn_register');

    res.json(options);
  } catch (error) {
    console.error('WebAuthn register options error:', error);
    res.status(500).json({ error: 'Failed to generate registration options' });
  }
});

router.post('/register/verify', authMiddleware, async (req, res) => {
  try {
    const { credential, deviceName } = req.body;
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const challengeRecord = await AuthChallenge.findAndVerify(
      user.id,
      credential.response.clientDataJSON
        ? JSON.parse(Buffer.from(credential.response.clientDataJSON, 'base64').toString()).challenge
        : '',
      'webauthn_register'
    );

    if (!challengeRecord) {
      const clientData = JSON.parse(
        Buffer.from(credential.response.clientDataJSON, 'base64').toString()
      );
      const challenge = clientData.challenge;
      
      const verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });

      const { verified, registrationInfo } = verification;

      if (verified && registrationInfo) {
        const { credentialPublicKey, credentialID, counter, transports } = registrationInfo;

        await WebAuthnCredential.create(
          user.id,
          Buffer.from(credentialID).toString('base64'),
          Buffer.from(credentialPublicKey).toString('base64'),
          counter,
          transports || [],
          deviceName || 'Security Key'
        );

        const credentials = await WebAuthnCredential.findByUserId(user.id);
        await User.updateMFAStatus(
          user.id,
          credentials.length > 0,
          user.totp_enabled,
          user.backup_codes_enabled
        );

        return res.json({ success: true });
      }
    }

    res.status(400).json({ error: 'Verification failed' });
  } catch (error) {
    console.error('WebAuthn register verify error:', error);
    res.status(500).json({ error: 'Failed to verify registration' });
  }
});

router.post('/auth/options', async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const credentials = await WebAuthnCredential.findByUserId(user.id);

    const options = generateAuthenticationOptions({
      allowCredentials: credentials.map((cred) => ({
        id: Buffer.from(cred.credential_id, 'base64'),
        type: 'public-key',
        transports: cred.transports,
      })),
      userVerification: 'required',
      rpID,
    });

    await AuthChallenge.create(user.id, options.challenge, 'webauthn_auth');

    res.json(options);
  } catch (error) {
    console.error('WebAuthn auth options error:', error);
    res.status(500).json({ error: 'Failed to generate authentication options' });
  }
});

router.post('/auth/verify', async (req, res) => {
  try {
    const { credential, userId } = req.body;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const credentialRecord = await WebAuthnCredential.findByCredentialId(credential.id);
    if (!credentialRecord) {
      return res.status(400).json({ error: 'Credential not found' });
    }

    const clientData = JSON.parse(
      Buffer.from(credential.response.clientDataJSON, 'base64').toString()
    );

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: clientData.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialPublicKey: Uint8Array.from(
          Buffer.from(credentialRecord.public_key, 'base64')
        ),
        credentialID: Uint8Array.from(
          Buffer.from(credentialRecord.credential_id, 'base64')
        ),
        counter: credentialRecord.counter,
      },
      requireUserVerification: true,
    });

    const { verified, authenticationInfo } = verification;

    if (verified) {
      await WebAuthnCredential.updateCounter(
        credentialRecord.credential_id,
        authenticationInfo.newCounter
      );

      const token = generateToken(user.id);
      return res.json({
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
    }

    res.status(400).json({ error: 'Verification failed' });
  } catch (error) {
    console.error('WebAuthn auth verify error:', error);
    res.status(500).json({ error: 'Failed to verify authentication' });
  }
});

router.get('/credentials', authMiddleware, async (req, res) => {
  try {
    const credentials = await WebAuthnCredential.findByUserId(req.userId);
    res.json({
      credentials: credentials.map((cred) => ({
        id: cred.credential_id,
        deviceName: cred.device_name,
        createdAt: cred.created_at,
      })),
    });
  } catch (error) {
    console.error('Get credentials error:', error);
    res.status(500).json({ error: 'Failed to get credentials' });
  }
});

router.delete('/credentials/:credentialId', authMiddleware, async (req, res) => {
  try {
    await WebAuthnCredential.delete(req.params.credentialId);
    
    const credentials = await WebAuthnCredential.findByUserId(req.userId);
    const user = await User.findById(req.userId);
    
    await User.updateMFAStatus(
      req.userId,
      credentials.length > 0,
      user.totp_enabled,
      user.backup_codes_enabled
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Delete credential error:', error);
    res.status(500).json({ error: 'Failed to delete credential' });
  }
});

module.exports = router;
