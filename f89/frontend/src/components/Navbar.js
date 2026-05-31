import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="nav">
      <div className="nav-content">
        <div className="nav-links">
          <Link to="/">Dashboard</Link>
          <Link to="/settings">Security Settings</Link>
          <Link to="/policies">Policies</Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="nav-email">{user?.email}</span>
          <button className="btn-small btn-secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
