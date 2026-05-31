import React, { useState, useEffect } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { webauthnApi, totpApi, backupApi, authApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

function Settings() {
  const { user, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const [deviceName, setDeviceName] = useState('');
  const [webauthnCredentials, setWebauthnCredentials] = useState([]);
  
  const [totpSetup, setTotpSetup] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  
  const [backupCodes, setBackupCodes] = useState([]);
  const [showBackupCodes, setShowBackupCodes] = useState(false);

  useEffect(() => {
    loadCredentials();
  }, []);

  const loadCredentials = async () => {
    try {
      const response = await webauthnApi.getCredentials();
      setWebauthnCredentials(response.data.credentials);
    } catch (err) {
      console.error('Failed to load credentials:', err);
    }
  };

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const handleWebAuthnRegister = async (e) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);

    try {
      const optionsResponse = await webauthnApi.getRegisterOptions();
      const credential = await startRegistration(optionsResponse.data);
      
      await webauthnApi.verifyRegistration(credential, deviceName || 'My Security Key');
      
      const profileResponse = await authApi.getProfile();
      updateUser(profileResponse.data.user);
      
      setSuccess('Security key registered successfully!');
      setDeviceName('');
      setActiveTab(null);
      loadCredentials();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to register security key');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCredential = async (credentialId) => {
    if (!window.confirm('Are you sure you want to remove this security key?')) {
      return;
    }

    try {
      await webauthnApi.deleteCredential(credentialId);
      const profileResponse = await authApi.getProfile();
      updateUser(profileResponse.data.user);
      loadCredentials();
      setSuccess('Security key removed');
    } catch (err) {
      setError('Failed to remove security key');
    }
  };

  const handleTOTPSetup = async () => {
    clearMessages();
    setLoading(true);

    try {
      const response = await totpApi.setup();
      setTotpSetup(response.data);
    } catch (err) {
      setError('Failed to setup TOTP');
    } finally {
      setLoading(false);
    }
  };

  const handleTOTPVerify = async (e) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);

    try {
      await totpApi.verifySetup(totpSetup.secret, totpCode);
      const profileResponse = await authApi.getProfile();
      updateUser(profileResponse.data.user);
      
      setSuccess('Authenticator app enabled successfully!');
      setTotpSetup(null);
      setTotpCode('');
      setActiveTab(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleDisableTOTP = async () => {
    if (!window.confirm('Are you sure you want to disable TOTP?')) {
      return;
    }

    try {
      await totpApi.disable();
      const profileResponse = await authApi.getProfile();
      updateUser(profileResponse.data.user);
      setSuccess('TOTP disabled');
    } catch (err) {
      setError('Failed to disable TOTP');
    }
  };

  const handleGenerateBackupCodes = async () => {
    if (!window.confirm('Generating new codes will invalidate any existing backup codes. Continue?')) {
      return;
    }

    clearMessages();
    setLoading(true);

    try {
      const response = await backupApi.generate();
      setBackupCodes(response.data.codes);
      setShowBackupCodes(true);
      
      const profileResponse = await authApi.getProfile();
      updateUser(profileResponse.data.user);
    } catch (err) {
      setError('Failed to generate backup codes');
    } finally {
      setLoading(false);
    }
  };

  const handleDisableBackupCodes = async () => {
    if (!window.confirm('Are you sure you want to disable backup codes?')) {
      return;
    }

    try {
      await backupApi.disable();
      const profileResponse = await authApi.getProfile();
      updateUser(profileResponse.data.user);
      setShowBackupCodes(false);
      setBackupCodes([]);
      setSuccess('Backup codes disabled');
    } catch (err) {
      setError('Failed to disable backup codes');
    }
  };

  return (
    <div className="container">
      <div className="card card-wide">
        <h1>Security Settings</h1>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <div className={`factor-card ${user?.webauthnEnabled ? 'enabled' : ''}`}>
          <div className="factor-info">
            <h3>🔑 WebAuthn (Biometric / Hardware Key)</h3>
            <p>
              Use Touch ID, Face ID, Windows Hello, or a hardware key like YubiKey.
              This is the most secure authentication method.
            </p>
            {webauthnCredentials.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <p style={{ fontWeight: 500 }}>Registered keys:</p>
                {webauthnCredentials.map((cred) => (
                  <div key={cred.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #e2e8f0' }}>
                    <span>{cred.deviceName}</span>
                    <button
                      className="btn-small btn-danger"
                      onClick={() => handleDeleteCredential(cred.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <span className={`status-badge ${user?.webauthnEnabled ? 'status-enabled' : 'status-disabled'}`}>
              {user?.webauthnEnabled ? 'Enabled' : 'Disabled'}
            </span>
            <button
              className="btn-small btn-primary"
              style={{ marginLeft: '10px' }}
              onClick={() => setActiveTab(activeTab === 'webauthn' ? null : 'webauthn')}
            >
              {user?.webauthnEnabled ? 'Add Key' : 'Setup'}
            </button>
          </div>
        </div>

        {activeTab === 'webauthn' && (
          <div style={{ background: '#f7fafc', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
            <h3>Register Security Key</h3>
            <form onSubmit={handleWebAuthnRegister}>
              <div className="form-group">
                <label>Device Name (optional)</label>
                <input
                  type="text"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="e.g., My YubiKey, MacBook Pro"
                />
              </div>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Registering...' : 'Register Security Key'}
              </button>
            </form>
          </div>
        )}

        <div className={`factor-card ${user?.totpEnabled ? 'enabled' : ''}`}>
          <div className="factor-info">
            <h3>📱 TOTP (Authenticator App)</h3>
            <p>
              Use Google Authenticator, Authy, 1Password, or any TOTP-compatible app
              to generate time-based one-time passwords.
            </p>
          </div>
          <div>
            <span className={`status-badge ${user?.totpEnabled ? 'status-enabled' : 'status-disabled'}`}>
              {user?.totpEnabled ? 'Enabled' : 'Disabled'}
            </span>
            {user?.totpEnabled ? (
              <button
                className="btn-small btn-danger"
                style={{ marginLeft: '10px' }}
                onClick={handleDisableTOTP}
              >
                Disable
              </button>
            ) : (
              <button
                className="btn-small btn-primary"
                style={{ marginLeft: '10px' }}
                onClick={() => { setActiveTab(activeTab === 'totp' ? null : 'totp'); handleTOTPSetup(); }}
              >
                Setup
              </button>
            )}
          </div>
        </div>

        {activeTab === 'totp' && totpSetup && (
          <div style={{ background: '#f7fafc', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
            <h3>Setup Authenticator App</h3>
            <div className="qr-code">
              <img src={totpSetup.qrCodeUrl} alt="TOTP QR Code" />
              <p style={{ marginTop: '10px' }}>
                Or enter this secret manually: <code>{totpSetup.secret}</code>
              </p>
            </div>
            <form onSubmit={handleTOTPVerify}>
              <div className="form-group">
                <label>Enter 6-digit code</label>
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                />
              </div>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Verifying...' : 'Verify & Enable'}
              </button>
            </form>
          </div>
        )}

        <div className={`factor-card ${user?.backupCodesEnabled ? 'enabled' : ''}`}>
          <div className="factor-info">
            <h3>📋 Backup Codes</h3>
            <p>
              Generate 10 one-time backup codes that can be used if you lose access
              to your other authentication methods. Store them securely!
            </p>
          </div>
          <div>
            <span className={`status-badge ${user?.backupCodesEnabled ? 'status-enabled' : 'status-disabled'}`}>
              {user?.backupCodesEnabled ? 'Enabled' : 'Disabled'}
            </span>
            {user?.backupCodesEnabled ? (
              <>
                <button
                  className="btn-small btn-secondary"
                  style={{ marginLeft: '10px' }}
                  onClick={handleGenerateBackupCodes}
                >
                  Regenerate
                </button>
                <button
                  className="btn-small btn-danger"
                  style={{ marginLeft: '10px' }}
                  onClick={handleDisableBackupCodes}
                >
                  Disable
                </button>
              </>
            ) : (
              <button
                className="btn-small btn-primary"
                style={{ marginLeft: '10px' }}
                onClick={handleGenerateBackupCodes}
              >
                Generate
              </button>
            )}
          </div>
        </div>

        {showBackupCodes && backupCodes.length > 0 && (
          <div style={{ background: '#fef5e7', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
            <div className="alert alert-info">
              <strong>Important!</strong> Save these codes in a secure location.
              They will only be shown once.
            </div>
            <div className="backup-codes-grid">
              {backupCodes.map((code, index) => (
                <div key={index} className="backup-code">
                  {code}
                </div>
              ))}
            </div>
            <button
              className="btn-secondary"
              style={{ marginTop: '20px' }}
              onClick={() => setShowBackupCodes(false)}
            >
              I've saved these codes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Settings;
