import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import { webauthnApi, totpApi, backupApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

function MFALogin() {
  const [userId, setUserId] = useState(null);
  const [enabledFactors, setEnabledFactors] = useState([]);
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [policyName, setPolicyName] = useState('');
  const [isNewDevice, setIsNewDevice] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  useEffect(() => {
    const storedUserId = sessionStorage.getItem('mfaUserId');
    const storedFactors = sessionStorage.getItem('mfaFactors');
    const storedPolicy = sessionStorage.getItem('mfaPolicy');
    const storedIsNewDevice = sessionStorage.getItem('mfaIsNewDevice');

    if (!storedUserId || !storedFactors) {
      navigate('/login');
      return;
    }

    setUserId(storedUserId);
    setEnabledFactors(JSON.parse(storedFactors));
    setPolicyName(storedPolicy || '');
    setIsNewDevice(storedIsNewDevice === 'true');
  }, [navigate]);

  const handleWebAuthn = async () => {
    setError('');
    setLoading(true);

    try {
      const optionsResponse = await webauthnApi.getAuthOptions(userId);
      const credential = await startAuthentication(optionsResponse.data);
      
      const verifyResponse = await webauthnApi.verifyAuthentication(credential, userId);
      
      if (verifyResponse.data.success) {
        login(verifyResponse.data.user, verifyResponse.data.token);
        sessionStorage.removeItem('mfaUserId');
        sessionStorage.removeItem('mfaFactors');
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'WebAuthn authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleTOTP = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await totpApi.auth(userId, totpCode);
      
      if (response.data.success) {
        login(response.data.user, response.data.token);
        sessionStorage.removeItem('mfaUserId');
        sessionStorage.removeItem('mfaFactors');
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid TOTP code');
    } finally {
      setLoading(false);
    }
  };

  const handleBackupCode = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await backupApi.auth(userId, backupCode);
      
      if (response.data.success) {
        login(response.data.user, response.data.token);
        sessionStorage.removeItem('mfaUserId');
        sessionStorage.removeItem('mfaFactors');
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid backup code');
    } finally {
      setLoading(false);
    }
  };

  if (!userId) {
    return (
      <div className="container">
        <div className="card">
          <p className="text-center">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <h1>Two-Factor Authentication</h1>
        <p className="text-center">Choose a verification method</p>

        {isNewDevice && (
          <div className="alert alert-info">
            <strong>New Device Detected</strong>
            <p style={{ marginBottom: 0, fontSize: '14px' }}>
              This device hasn't been used to access your account before.
              Additional verification is required for security.
            </p>
          </div>
        )}

        {policyName && (
          <div className="alert alert-info">
            <strong>Security Policy:</strong> {policyName}
          </div>
        )}

        {error && (
          <div className="alert alert-error">
            {error}
          </div>
        )}

        {!selectedMethod ? (
          <div className="mfa-methods">
            {enabledFactors.includes('webauthn') && (
              <div
                className="mfa-method-btn"
                onClick={handleWebAuthn}
                disabled={loading}
              >
                <span>🔑</span>
                <div>
                  <strong>Security Key</strong>
                  <p style={{ fontSize: '14px', margin: 0 }}>Use Touch ID, Face ID, or hardware key</p>
                </div>
              </div>
            )}

            {enabledFactors.includes('totp') && (
              <div
                className="mfa-method-btn"
                onClick={() => setSelectedMethod('totp')}
              >
                <span>📱</span>
                <div>
                  <strong>Authenticator App</strong>
                  <p style={{ fontSize: '14px', margin: 0 }}>Enter code from Google Authenticator, Authy, etc.</p>
                </div>
              </div>
            )}

            {enabledFactors.includes('backup') && (
              <div
                className="mfa-method-btn"
                onClick={() => setSelectedMethod('backup')}
              >
                <span>📋</span>
                <div>
                  <strong>Backup Code</strong>
                  <p style={{ fontSize: '14px', margin: 0 }}>Use a recovery code</p>
                </div>
              </div>
            )}
          </div>
        ) : selectedMethod === 'totp' ? (
          <form onSubmit={handleTOTP}>
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
              {loading ? 'Verifying...' : 'Verify'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSelectedMethod(null)}
            >
              Back
            </button>
          </form>
        ) : (
          <form onSubmit={handleBackupCode}>
            <div className="form-group">
              <label>Enter backup code</label>
              <input
                type="text"
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                maxLength={9}
                autoFocus
              />
            </div>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSelectedMethod(null)}
            >
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default MFALogin;
