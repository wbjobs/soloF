import React, { useState, useEffect } from 'react';
import Top10BarChart from './components/Top10BarChart';
import RealTimeLineChart from './components/RealTimeLineChart';
import BehaviorPieChart from './components/BehaviorPieChart';
import SellBuyRatioChart from './components/SellBuyRatioChart';

function App() {
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 10000);
    return () => clearInterval(interval);
  }, []);

  const checkConnection = async () => {
    try {
      const response = await fetch('/api/book/top10');
      setIsOnline(response.ok);
    } catch (error) {
      setIsOnline(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>📊 书籍行为数据分析平台</h1>
        <p>
          <span className={`status-indicator ${isOnline ? 'online' : 'offline'}`}></span>
          {isOnline ? '系统运行正常 - 实时监控中' : '连接断开，请检查后端服务'}
        </p>
      </header>
      <div className="dashboard">
        <div className="chart-row">
          <Top10BarChart />
          <SellBuyRatioChart />
        </div>
        <div className="chart-row">
          <BehaviorPieChart />
          <RealTimeLineChart />
        </div>
      </div>
    </div>
  );
}

export default App;
