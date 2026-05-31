import React, { createContext, useContext, useState, useEffect } from 'react';
import { login as generateToken, logout as clearToken, getCurrentUser, validateJWT } from '../utils/jwt';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('jwt_token');
    if (token && validateJWT(token)) {
      const userData = getCurrentUser();
      setUser(userData);
    }
    setLoading(false);
  }, []);

  const login = (username, password, role = 'user') => {
    const token = generateToken(username, password, role);
    localStorage.setItem('jwt_token', token);
    const userData = getCurrentUser();
    setUser(userData);
    return userData;
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  const isAuthenticated = () => {
    return user !== null;
  };

  const getOwner = () => {
    return user ? user.tenant || user.username : null;
  };

  const value = {
    user,
    login,
    logout,
    isAuthenticated,
    getOwner,
    loading,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
