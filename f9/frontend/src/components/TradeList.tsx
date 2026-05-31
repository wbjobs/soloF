import React, { useRef, useEffect } from 'react';
import { Typography } from 'antd';
import { useReplayStore } from '../store/replayStore';
import dayjs from 'dayjs';

const { Text } = Typography;

export const TradeList: React.FC = () => {
  const { trades } = useReplayStore();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [trades]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      <div style={{ padding: '12px', borderBottom: '1px solid #1a1a1a' }}>
        <Text style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>逐笔成交</Text>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '8px 12px', borderBottom: '1px solid #1a1a1a', fontSize: '11px', color: '#8c8c8c' }}>
        <span>时间</span>
        <span style={{ textAlign: 'right' }}>价格</span>
        <span style={{ textAlign: 'right' }}>数量</span>
      </div>

      <div ref={containerRef} style={{ flex: 1, overflow: 'auto', fontFamily: 'JetBrains Mono', fontSize: '12px' }}>
        {trades.slice().reverse().map((trade, idx) => (
          <div
            key={idx}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              padding: '4px 12px',
              borderBottom: '1px solid #141414',
              background: trade.volume > 1000 ? 'rgba(255, 215, 0, 0.1)' : 'transparent',
            }}
          >
            <Text style={{ color: '#8c8c8c' }}>
              {dayjs(trade.timestamp).format('HH:mm:ss.SSS')}
            </Text>
            <Text style={{ color: trade.bs_flag === 'B' ? '#52c41a' : '#ff4d4f', textAlign: 'right' }}>
              {trade.price.toFixed(2)}
            </Text>
            <Text style={{ color: trade.volume > 1000 ? '#faad14' : '#d9d9d9', textAlign: 'right' }}>
              {trade.volume.toLocaleString()}
            </Text>
          </div>
        ))}
      </div>
    </div>
  );
};
