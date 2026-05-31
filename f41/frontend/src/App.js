import React, { useState, useEffect } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import SensorNode from './components/SensorNode';
import LatestDataTable from './components/LatestDataTable';
import AlertSettings from './components/AlertSettings';
import AlertBanner from './components/AlertBanner';

const socket = io('http://localhost:3001');

function App() {
  const [nodes, setNodes] = useState([]);
  const [sensorData, setSensorData] = useState({});
  const [latestData, setLatestData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alertRules, setAlertRules] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [nodeAlertTypes, setNodeAlertTypes] = useState({});

  useEffect(() => {
    fetchInitialData();
    
    socket.on('sensorData', (data) => {
      handleNewData(data);
    });

    socket.on('alert', (alert) => {
      handleNewAlert(alert);
    });

    return () => {
      socket.off('sensorData');
      socket.off('alert');
    };
  }, []);

  const fetchInitialData = async () => {
    try {
      const [nodesRes, latestRes, rulesRes] = await Promise.all([
        axios.get('/api/nodes'),
        axios.get('/api/data/latest'),
        axios.get('/api/alert-rules')
      ]);

      setNodes(nodesRes.data);
      setLatestData(latestRes.data);
      setAlertRules(rulesRes.data);

      const dataPromises = nodesRes.data.map(node =>
        axios.get(`/api/data/${node.dev_eui}`)
      );
      const dataResults = await Promise.all(dataPromises);

      const newSensorData = {};
      nodesRes.data.forEach((node, index) => {
        newSensorData[node.dev_eui] = dataResults[index].data;
      });
      setSensorData(newSensorData);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching initial data:', error);
      setLoading(false);
    }
  };

  const handleNewData = (data) => {
    setSensorData(prev => {
      const nodeData = prev[data.devEui] || [];
      const newData = [...nodeData, {
        humidity: data.humidity,
        temperature: data.temperature,
        conductivity: data.conductivity,
        timestamp: data.timestamp
      }];
      
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - 24);
      const filteredData = newData.filter(d => new Date(d.timestamp) >= cutoffTime);
      
      return { ...prev, [data.devEui]: filteredData };
    });

    setLatestData(prev => {
      const existingIndex = prev.findIndex(d => d.dev_eui === data.devEui);
      const newEntry = {
        dev_eui: data.devEui,
        humidity: data.humidity,
        temperature: data.temperature,
        conductivity: data.conductivity,
        timestamp: data.timestamp
      };

      if (existingIndex >= 0) {
        const newData = [...prev];
        newData[existingIndex] = newEntry;
        return newData;
      }
      return [...prev, newEntry];
    });
  };

  const handleNewAlert = (alert) => {
    const alertWithId = { ...alert, id: Date.now() + Math.random() };
    setAlerts(prev => [...prev, alertWithId]);

    setNodeAlertTypes(prev => {
      const types = prev[alert.devEui] || new Set();
      types.add(alert.type);
      return { ...prev, [alert.devEui]: types };
    });

    setTimeout(() => {
      dismissAlert(alertWithId.id);
    }, 10000);
  };

  const dismissAlert = (alertId) => {
    setAlerts(prev => prev.filter(a => a.id !== alertId));
  };

  const handleRulesUpdated = (newRules) => {
    setAlertRules(newRules);
    setNodeAlertTypes({});
  };

  if (loading) {
    return (
      <div className="app">
        <div className="header">
          <h1>农业土壤墒情监测系统</h1>
          <p>正在加载数据...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <AlertBanner alerts={alerts} onDismiss={dismissAlert} />
      
      <div className="header">
        <h1>🌱 农业土壤墒情监测系统</h1>
        <p>实时监测土壤湿度、温度和电导率 - LoRaWAN 物联网解决方案</p>
        <span className="realtime-badge">● 实时更新中</span>
      </div>

      <div className="dashboard">
        {alertRules && (
          <AlertSettings rules={alertRules} onRulesUpdated={handleRulesUpdated} />
        )}

        <div className="nodes-grid">
          {nodes.map(node => (
            <SensorNode
              key={node.dev_eui}
              node={node}
              data={sensorData[node.dev_eui] || []}
              rules={alertRules}
              alertTypes={nodeAlertTypes[node.dev_eui]}
            />
          ))}
        </div>

        <LatestDataTable data={latestData} nodes={nodes} />
      </div>
    </div>
  );
}

export default App;
