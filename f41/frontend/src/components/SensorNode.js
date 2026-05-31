import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

function SensorNode({ node, data, rules, alertTypes }) {
  const latestData = data[data.length - 1] || { humidity: 0, temperature: 0, conductivity: 0 };

  const hasAlert = alertTypes && alertTypes.size > 0;
  const hasError = alertTypes && alertTypes.has('conductivity') && latestData.conductivity < 0;

  const getMetricStatus = (type, value) => {
    if (!rules || !rules[type]?.enabled) return '';
    const rule = rules[type];
    
    if (type === 'conductivity' && value < 0) return 'alert';
    if (value < rule.min || value > rule.max) return hasError ? 'alert' : 'warning';
    return '';
  };

  const chartData = data.map(d => ({
    time: new Date(d.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    湿度: parseFloat(d.humidity),
    温度: parseFloat(d.temperature),
    电导率: parseFloat(d.conductivity) / 100
  }));

  return (
    <div className={`node-card ${hasAlert ? 'alert-active' : ''}`}>
      <div className="node-header">
        <div className="node-info">
          <h2>{node.name} {hasAlert && <span style={{ color: '#f44336' }}>⚠️</span>}</h2>
          <p>📍 {node.location}</p>
        </div>
        <div className="node-status">
          <span className="status-dot"></span>
          <span className="status-text">在线</span>
        </div>
      </div>

      <div className="metrics-row">
        <div className={`metric-box ${getMetricStatus('humidity', latestData.humidity)}`}>
          <div className="metric-label">💧 土壤湿度</div>
          <div className="metric-value humidity">{latestData.humidity}%</div>
        </div>
        <div className={`metric-box ${getMetricStatus('temperature', latestData.temperature)}`}>
          <div className="metric-label">🌡️ 温度</div>
          <div className="metric-value temperature">{latestData.temperature}°C</div>
        </div>
        <div className={`metric-box ${getMetricStatus('conductivity', latestData.conductivity)}`}>
          <div className="metric-label">⚡ 电导率</div>
          <div className="metric-value conductivity">{latestData.conductivity} μS/cm</div>
        </div>
      </div>

      <div className="chart-title">📊 最近24小时数据趋势</div>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis dataKey="time" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="left" type="monotone" dataKey="湿度" stroke="#2196f3" strokeWidth={2} dot={false} />
            <Line yAxisId="left" type="monotone" dataKey="温度" stroke="#f44336" strokeWidth={2} dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="电导率" stroke="#9c27b0" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default SensorNode;
