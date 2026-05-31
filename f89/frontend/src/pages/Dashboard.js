import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function Dashboard() {
  const { user } = useAuth();

  const enabledFactors = [];
  if (user?.webauthnEnabled) enabledFactors.push('WebAuthn');
  if (user?.totpEnabled) enabledFactors.push('TOTP');
  if (user?.backupCodesEnabled) enabledFactors.push('Backup Codes');

  return (
    <div className="container">
      <div className="card card-wide">
        <h1>Welcome, {user?.email}!</h1>
        
        <div className="factor-card enabled">
          <div className="factor-info">
            <h3>Account Security Status</h3>
            <p>
              {enabledFactors.length > 0 ? (
                <>
                  <span className="status-badge status-enabled">
                    {enabledFactors.length} factor{enabledFactors.length > 1 ? 's' : ''} enabled
                  </span>
                  <span style={{ marginLeft: '10px' }}>
                    {enabledFactors.join(', ')}
                  </span>
                </>
              ) : (
                <span className="status-badge status-disabled">
                  No MFA enabled
                </span>
              )}
            </p>
          </div>
          <Link to="/settings">
            <button className="btn-small btn-primary">
              Manage Security
            </button>
          </Link>
        </div>

        <h2 style={{ marginTop: '30px' }}>Security Recommendations</h2>
        
        <div className="factor-card" style={{ borderColor: user?.webauthnEnabled ? '#48bb78' : '#e2e8f0' }}>
          <div className="factor-info">
            <h3>🔑 WebAuthn (Biometric / Hardware Key)</h3>
            <p>
              {user?.webauthnEnabled 
                ? 'Your account is protected with biometric or hardware key authentication.'
                : 'Add the strongest protection with Touch ID, Face ID, or a YubiKey.'}
            </p>
          </div>
          <span className={`status-badge ${user?.webauthnEnabled ? 'status-enabled' : 'status-disabled'}`}>
            {user?.webauthnEnabled ? 'Enabled' : 'Recommended'}
          </span>
        </div>

        <div className="factor-card" style={{ borderColor: user?.totpEnabled ? '#48bb78' : '#e2e8f0' }}>
          <div className="factor-info">
            <h3>📱 TOTP (Authenticator App)</h3>
            <p>
              {user?.totpEnabled
                ? 'Your account is protected with time-based one-time passwords.'
                : 'Use Google Authenticator, Authy, or similar apps for 2FA.'}
            </p>
          </div>
          <span className={`status-badge ${user?.totpEnabled ? 'status-enabled' : 'status-disabled'}`}>
            {user?.totpEnabled ? 'Enabled' : 'Recommended'}
          </span>
        </div>

        <div className="factor-card" style={{ borderColor: user?.backupCodesEnabled ? '#48bb78' : '#e2e8f0' }}>
          <div className="factor-info">
            <h3>📋 Backup Codes</h3>
            <p>
              {user?.backupCodesEnabled
                ? 'You have backup codes for emergency access.'
                : 'Generate backup codes to avoid being locked out.'}
            </p>
          </div>
          <span className={`status-badge ${user?.backupCodesEnabled ? 'status-enabled' : 'status-disabled'}`}>
            {user?.backupCodesEnabled ? 'Enabled' : 'Optional'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
