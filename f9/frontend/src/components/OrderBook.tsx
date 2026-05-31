import React from 'react';
import { Typography } from 'antd';
import { useReplayStore } from '../store/replayStore';
import ReactECharts from 'echarts-for-react';

const { Text } = Typography;

export const OrderBook: React.FC = () => {
  const { orderBook } = useReplayStore();

  if (!orderBook) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a' }}>
        <Text type="secondary">等待数据...</Text>
      </div>
    );
  }

  const asks = [...orderBook.asks].reverse();
  const bids = orderBook.bids;

  const depthOption = {
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 40, right: 20, top: 10, bottom: 30 },
    xAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: '#434343' } },
      axisLabel: { color: '#8c8c8c', fontSize: 10 },
      splitLine: { lineStyle: { color: '#1a1a1a' } },
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: '#434343' } },
      axisLabel: { color: '#8c8c8c', fontSize: 10 },
      splitLine: { lineStyle: { color: '#1a1a1a' } },
    },
    series: [
      {
        name: '买盘',
        type: 'line',
        smooth: true,
        data: bids.map((b) => [b.volume, b.price]),
        areaStyle: { color: 'rgba(82, 196, 26, 0.3)' },
        lineStyle: { color: '#52c41a', width: 2 },
        itemStyle: { color: '#52c41a' },
      },
      {
        name: '卖盘',
        type: 'line',
        smooth: true,
        data: asks.map((a) => [a.volume, a.price]),
        areaStyle: { color: 'rgba(255, 77, 79, 0.3)' },
        lineStyle: { color: '#ff4d4f', width: 2 },
        itemStyle: { color: '#ff4d4f' },
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
      <div style={{ padding: '12px', borderBottom: '1px solid #1a1a1a' }}>
        <Text style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>买卖盘口</Text>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', fontSize: '12px', fontFamily: 'JetBrains Mono' }}>
        {/* 卖盘 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {asks.map((level, idx) => (
            <div
              key={`ask-${idx}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 12px',
                background: `linear-gradient(to right, rgba(255, 77, 79, 0.15) 0%, rgba(255, 77, 79, 0.15) ${Math.min(level.volume / 10000 * 100, 100)}%, transparent 50%)`,
              }}
            >
              <Text style={{ color: '#ff4d4f', width: '80px' }}>{level.price.toFixed(2)}</Text>
              <Text style={{ color: '#d9d9d9', width: '100px', textAlign: 'right' }}>
                {level.volume.toLocaleString()}
              </Text>
            </div>
          ))}
        </div>

        {/* 中间图表区域 */}
        <div style={{ height: '200px', borderTop: '1px solid #1a1a1a', borderBottom: '1px solid #1a1a1a' }}>
          <ReactECharts option={depthOption} style={{ height: '100%' }} theme="dark" />
        </div>

        {/* 买盘 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {bids.map((level, idx) => (
            <div
              key={`bid-${idx}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 12px',
                background: `linear-gradient(to right, rgba(82, 196, 26, 0.15) 0%, rgba(82, 196, 26, 0.15) ${Math.min(level.volume / 10000 * 100, 100)}%, transparent 50%)`,
              }}
            >
              <Text style={{ color: '#52c41a', width: '80px' }}>{level.price.toFixed(2)}</Text>
              <Text style={{ color: '#d9d9d9', width: '100px', textAlign: 'right' }}>
                {level.volume.toLocaleString()}
              </Text>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
