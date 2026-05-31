import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Layout, Menu, theme } from 'antd';
import { PlayCircleOutlined, BarChartOutlined } from '@ant-design/icons';
import { ReplayPage } from './pages/Replay';
import { BacktestPage } from './pages/Backtest';
import { ResultPage } from './pages/Result';

const { Header, Content, Sider } = Layout;

const AppContent: React.FC = () => {
  const location = useLocation();

  const menuItems = [
    {
      key: '/',
      icon: <PlayCircleOutlined />,
      label: <Link to="/">行情回放</Link>,
    },
    {
      key: '/backtest',
      icon: <BarChartOutlined />,
      label: <Link to="/backtest">策略回测</Link>,
    },
  ];

  if (location.pathname.startsWith('/backtest/')) {
    return <ResultPage />;
  }

  if (location.pathname === '/backtest') {
    return <BacktestPage />;
  }

  return <ReplayPage />;
};

const App: React.FC = () => {
  return (
    <Router>
      <AppContent />
    </Router>
  );
};

export default App;
