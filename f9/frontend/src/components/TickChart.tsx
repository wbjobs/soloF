import React, { useEffect, useState } from 'react';
import { Typography } from 'antd';
import ReactECharts from 'echarts-for-react';
import { useReplayStore } from '../store/replayStore';
import { TickData } from '../types';

const { Text } = Typography;

export const TickChart: React.FC = () => {
  const { trades, currentTick } = useReplayStore();
  const [history, setHistory] = useState<TickData[]>([]);

  useEffect(() => {
    if (currentTick) {
      setHistory((prev) => [...prev.slice(-500), currentTick]);
    }
  }, [currentTick]);

  const priceOption = {
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 50, right: 20, top: 30, bottom: 30 },
    xAxis: {
      type: 'category',
      data: history.map((t) => t.timestamp),
      axisLine: { lineStyle: { color: '#434343' } },
      axisLabel: { 
        color: '#8c8c8c', 
        fontSize: 10,
        formatter: (ts: number) => new Date(ts).toLocaleTimeString().slice(0, 8),
      },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLine: { lineStyle: { color: '#434343' } },
      axisLabel: { color: '#8c8c8c', fontSize: 10 },
      splitLine: { lineStyle: { color: '#1a1a1a' } },
    },
    series: [
      {
        name: '成交价',
        type: 'line',
        data: history.map((t) => [t.timestamp, t.price]),
        lineStyle: { color: '#1890ff', width: 1 },
        itemStyle: {
          color: (params: any) => {
            const idx = params.dataIndex;
            if (idx === 0) return '#1890ff';
            return history[idx].price >= history[idx - 1].price ? '#52c41a' : '#ff4d4f';
          },
        },
        symbol: 'circle',
        symbolSize: 3,
      },
    ],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: '#434343',
      textStyle: { color: '#fff' },
      formatter: (params: any) => {
        const data = params[0];
        if (!data) return '';
        const tick = history.find((t) => t.timestamp === data.name);
        if (!tick) return '';
        return `
          时间: ${new Date(tick.timestamp).toLocaleTimeString()}.${String(tick.timestamp).slice(-3)}<br/>
          价格: ${tick.price.toFixed(2)}<br/>
          数量: ${tick.volume.toLocaleString()}<br/>
          方向: ${tick.bs_flag === 'B' ? '<span style="color:#52c41a">买</span>' : '<span style="color:#ff4d4f">卖</span>'}
        `;
      },
    },
  };

  const volumeOption = {
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 50, right: 20, top: 10, bottom: 30 },
    xAxis: {
      type: 'category',
      data: history.map((t) => t.timestamp),
      axisLine: { lineStyle: { color: '#434343' } },
      axisLabel: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: '#434343' } },
      axisLabel: { color: '#8c8c8c', fontSize: 10 },
      splitLine: { lineStyle: { color: '#1a1a1a' } },
    },
    series: [
      {
        name: '成交量',
        type: 'bar',
        data: history.map((t, idx) => ({
          value: [t.timestamp, t.volume],
          itemStyle: {
            color: idx === 0 || t.price >= history[idx - 1]?.price ? '#52c41a' : '#ff4d4f',
          },
        })),
        barWidth: '60%',
      },
    ],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: '#434343',
      textStyle: { color: '#fff' },
    },
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      <div style={{ padding: '12px', borderBottom: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>分时走势</Text>
        {currentTick && (
          <div style={{ display: 'flex', gap: '20px', fontFamily: 'JetBrains Mono' }}>
            <Text style={{ color: currentTick.bs_flag === 'B' ? '#52c41a' : '#ff4d4f', fontSize: '18px', fontWeight: 'bold' }}>
              {currentTick.price.toFixed(2)}
            </Text>
            <Text style={{ color: '#d9d9d9', fontSize: '14px' }}>
              {currentTick.volume.toLocaleString()} 手
            </Text>
          </div>
        )}
      </div>

      <div style={{ flex: 1 }}>
        <ReactECharts option={priceOption} style={{ height: '60%' }} theme="dark" />
        <ReactECharts option={volumeOption} style={{ height: '40%' }} theme="dark" />
      </div>
    </div>
  );
};
