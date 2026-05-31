import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { getOrCreateFingerprint } from '../utils/deviceFingerprint';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const deviceFingerprint = await getOrCreateFingerprint();
      const response = await authApi.login(email, password, deviceFingerprint);
      
      if (response.data.mfaRequired) {
        sessionStorage.setItem('mfaUserId', response.data.userId);
        sessionStorage.setItem('mfaFactors', JSON.stringify(response.data.enabledFactors));
        sessionStorage.setItem('mfaPolicy', response.data.policyApplied || '');
        sessionStorage.setItem('mfaIsNewDevice', response.data.isNewDevice || false);
        navigate('/mfa-login');
      } else {
        login(response.data.user, response.data.token);
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="card">
        <h1>Welcome Back</h1>
        <p className="text-center">Sign in to your account</p>

        {error && (
          <div className="alert alert-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center mt-20">
          Don't have an account?{' '}
          <Link to="/register" className="link">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

export default Login;
