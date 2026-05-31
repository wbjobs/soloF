import React, { useState, useEffect, useRef } from 'react';
import { Button, Slider, Select, Space, message, Card, Row, Col, Typography, Menu } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined, ReloadOutlined, BarChartOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { useReplayStore } from '../store/replayStore';
import { api } from '../services/api';
import dayjs from 'dayjs';

const { Text, Title } = Typography;
const { Option } = Select;

export const ReplayPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    isPlaying,
    speed,
    currentTime,
    startTime,
    endTime,
    currentTick,
    orderBook,
    trades,
    setPlaying,
    setSpeed,
    setCurrentTime,
    setTimeRange,
    setCurrentTick,
    setOrderBook,
    addTrade,
    reset
  } = useReplayStore();

  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const wsRef = useRef<WebSocket | null>(null);
  const [priceHistory, setPriceHistory] = useState<number[]>([]);
  const [timeLabels, setTimeLabels] = useState<string[]>([]);

  useEffect(() => {
    api.getSymbols().then(setSymbols).catch(console.error);
  }, []);

  const pendingTicks = useRef<any[]>([]);
  const animationFrameId = useRef<number | null>(null);
  const lastRenderTime = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const processPendingTicks = () => {
    const now = performance.now();
    if (now - lastRenderTime.current < 16) {
      animationFrameId.current = requestAnimationFrame(processPendingTicks);
      return;
    }

    if (pendingTicks.current.length > 0) {
      const maxProcess = Math.min(pendingTicks.current.length, 50);
      const ticks = pendingTicks.current.splice(0, maxProcess);

      const lastTick = ticks[ticks.length - 1];
      setCurrentTick(lastTick);

      ticks.forEach(t => addTrade(t));
      
      setPriceHistory(prev => {
        const newHistory = [...prev, ...ticks.map(t => t.price)];
        return newHistory.slice(-200);
      });
      
      setTimeLabels(prev => {
        const newLabels = [...prev, ...ticks.map(t => dayjs(t.timestamp).format('HH:mm:ss'))];
        return newLabels.slice(-200);
      });

      lastRenderTime.current = now;
    }

    if (pendingTicks.current.length > 0) {
      animationFrameId.current = requestAnimationFrame(processPendingTicks);
    }
  };

  const handleSymbolChange = (symbol: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
    }
    pendingTicks.current = [];
    reset();
    setSelectedSymbol(symbol);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/replay/ws?symbol=${symbol}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      message.success(`已连接 ${symbol}`);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'init':
          setTimeRange(msg.data.start_time, msg.data.end_time);
          break;
        case 'tick':
          pendingTicks.current.push(msg.data);
          if (!animationFrameId.current) {
            animationFrameId.current = requestAnimationFrame(processPendingTicks);
          }
          break;
        case 'tick_batch':
          pendingTicks.current.push(...msg.data);
          if (!animationFrameId.current) {
            animationFrameId.current = requestAnimationFrame(processPendingTicks);
          }
          break;
        case 'orderbook':
          setOrderBook(msg.data);
          break;
        case 'progress':
          setCurrentTime(msg.data.current_time);
          break;
      }
    };

    ws.onclose = () => {
      message.info('连接已断开');
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };

    ws.onerror = () => {
      message.error('连接失败');
    };

    wsRef.current = ws;
  };

  const handlePlayPause = () => {
    if (!wsRef.current) {
      message.warning('请先选择股票');
      return;
    }
    const newPlaying = !isPlaying;
    setPlaying(newPlaying);
    wsRef.current.send(JSON.stringify({ action: newPlaying ? 'play' : 'pause' }));
  };

  const handleSpeedChange = (value: number) => {
    setSpeed(value);
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ action: 'speed', payload: { speed: value } }));
    }
  };

  const handleSeek = (value: number) => {
    setCurrentTime(value);
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ action: 'seek', payload: { timestamp: value } }));
    }
  };

  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (file) {
        try {
          const result = await api.uploadCSV(file);
          if (result.success) {
            message.success(`加载成功，共 ${result.total_ticks} 条数据，${result.symbols.length} 只股票`);
            setSymbols(result.symbols);
          }
        } catch (error) {
          message.error('上传失败');
        }
      }
    };
    input.click();
  };

  const chartOption = {
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 60, right: 20, top: 40, bottom: 40 },
    title: {
      text: '分时走势',
      left: 'center',
      textStyle: { color: '#fff', fontSize: 14 }
    },
    xAxis: {
      type: 'category',
      data: timeLabels,
      axisLine: { lineStyle: { color: '#434343' } },
      axisLabel: { color: '#8c8c8c', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLine: { lineStyle: { color: '#434343' } },
      axisLabel: { color: '#8c8c8c', fontSize: 10 },
      splitLine: { lineStyle: { color: '#1a1a1a' } },
    },
    series: [{
      name: '价格',
      type: 'line',
      data: priceHistory,
      lineStyle: { color: '#1890ff', width: 1 },
      itemStyle: { color: '#1890ff' },
      symbol: 'circle',
      symbolSize: 3,
    }],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      borderColor: '#434343',
      textStyle: { color: '#fff' },
    },
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#000' }}>
      {/* 控制面板 */}
      <div style={{
        padding: '16px 24px',
        background: '#001529',
        borderBottom: '1px solid #303030',
        display: 'flex',
        alignItems: 'center',
        gap: '24px'
      }}>
        <Text style={{ color: '#fff', fontSize: '18px', fontWeight: 'bold', marginRight: '20px' }}>
          📈 Level-2 行情系统
        </Text>
        
        <Space>
          <Button icon={<UploadOutlined />} type="primary" onClick={handleUpload}>
            加载CSV
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
            重置
          </Button>
          <Button
            icon={<BarChartOutlined />}
            onClick={() => navigate('/backtest')}
          >
            策略回测
          </Button>
        </Space>

        <Select
          placeholder="选择股票"
          style={{ width: 150 }}
          value={selectedSymbol || undefined}
          onChange={handleSymbolChange}
        >
          {symbols.map((s) => (
            <Option key={s} value={s}>{s}</Option>
          ))}
        </Select>

        <Space>
          <Button
            type="primary"
            shape="circle"
            icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={handlePlayPause}
            size="large"
            style={{ background: isPlaying ? '#ff4d4f' : '#52c41a', borderColor: 'transparent' }}
          />
        </Space>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <Text style={{ color: '#8c8c8c', fontSize: '12px', width: '80px' }}>
              {dayjs(startTime).format('HH:mm:ss')}
            </Text>
            <Slider
              min={startTime}
              max={endTime}
              value={currentTime}
              onChange={handleSeek}
              style={{ flex: 1 }}
              tooltip={{ formatter: (value) => value ? dayjs(value).format('HH:mm:ss.SSS') : '' }}
            />
            <Text style={{ color: '#8c8c8c', fontSize: '12px', width: '80px', textAlign: 'right' }}>
              {dayjs(endTime).format('HH:mm:ss')}
            </Text>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Text style={{ color: '#8c8c8c', fontSize: '12px', width: '50px' }}>速度:</Text>
            <Slider
              min={1}
              max={100}
              value={speed}
              onChange={handleSpeedChange}
              style={{ width: 200 }}
              marks={{ 1: '1x', 10: '10x', 50: '50x', 100: '100x' }}
            />
            <Text style={{ color: '#1890ff', fontSize: '14px', fontWeight: 'bold' }}>{speed}x</Text>
          </div>
        </div>

        {currentTick && (
          <div style={{ textAlign: 'right' }}>
            <Text style={{ color: currentTick.bs_flag === 'B' ? '#52c41a' : '#ff4d4f', fontSize: '20px', fontWeight: 'bold', fontFamily: 'JetBrains Mono' }}>
              {currentTick.price.toFixed(2)}
            </Text>
            <br />
            <Text style={{ color: '#fff', fontSize: '14px', fontFamily: 'JetBrains Mono' }}>
              {currentTick.volume.toLocaleString()} 手
            </Text>
          </div>
        )}
      </div>

      {/* 主内容区 */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '280px 1fr 280px', gap: '1px', background: '#1a1a1a' }}>
        {/* 左侧盘口 */}
        <Card
          title="买卖盘口"
          style={{ background: '#0a0a0a', border: 'none', height: '100%' }}
          styles={{ header: { background: '#0a0a0a', borderBottom: '1px solid #1a1a1a', color: '#fff', padding: '12px' }, body: { padding: '12px 8px' } }}
        >
          {/* 卖盘 */}
          <div style={{ marginBottom: 16 }}>
            {orderBook?.asks.slice().reverse().map((ask: any, idx: number) => (
              <div
                key={`ask-${idx}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '4px 8px',
                  marginBottom: 2,
                  background: `linear-gradient(to right, rgba(255,77,79,0.15) 0%, rgba(255,77,79,0.15) ${Math.min(ask.volume / 5000 * 100, 100)}%, transparent ${Math.min(ask.volume / 5000 * 100, 100)}%)`,
                }}
              >
                <Text style={{ color: '#ff4d4f', fontFamily: 'JetBrains Mono', fontSize: 12 }}>
                  {ask.price.toFixed(2)}
                </Text>
                <Text style={{ color: '#d9d9d9', fontFamily: 'JetBrains Mono', fontSize: 12 }}>
                  {ask.volume.toLocaleString()}
                </Text>
              </div>
            ))}
          </div>

          {/* 分隔线 */}
          <div style={{ borderTop: '1px solid #303030', margin: '8px 0' }} />

          {/* 买盘 */}
          <div>
            {orderBook?.bids.map((bid: any, idx: number) => (
              <div
                key={`bid-${idx}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '4px 8px',
                  marginBottom: 2,
                  background: `linear-gradient(to right, rgba(82,196,26,0.15) 0%, rgba(82,196,26,0.15) ${Math.min(bid.volume / 5000 * 100, 100)}%, transparent ${Math.min(bid.volume / 5000 * 100, 100)}%)`,
                }}
              >
                <Text style={{ color: '#52c41a', fontFamily: 'JetBrains Mono', fontSize: 12 }}>
                  {bid.price.toFixed(2)}
                </Text>
                <Text style={{ color: '#d9d9d9', fontFamily: 'JetBrains Mono', fontSize: 12 }}>
                  {bid.volume.toLocaleString()}
                </Text>
              </div>
            ))}
          </div>
        </Card>

        {/* 中间图表 */}
        <Card
          style={{ background: '#0a0a0a', border: 'none', height: '100%' }}
          styles={{ body: { padding: '12px', height: '100%' } }}
        >
          <ReactECharts option={chartOption} style={{ height: '100%' }} theme="dark" />
        </Card>

        {/* 右侧成交列表 */}
        <Card
          title="逐笔成交"
          style={{ background: '#0a0a0a', border: 'none', height: '100%' }}
          styles={{ header: { background: '#0a0a0a', borderBottom: '1px solid #1a1a1a', color: '#fff', padding: '12px' }, body: { padding: 0, height: 'calc(100% - 57px)', overflow: 'auto' } }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '8px 12px', borderBottom: '1px solid #1a1a1a', fontSize: '11px', color: '#8c8c8c' }}>
            <span>时间</span>
            <span style={{ textAlign: 'right' }}>价格</span>
            <span style={{ textAlign: 'right' }}>数量</span>
          </div>
          {trades.slice().reverse().map((trade, idx) => (
            <div
              key={idx}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                padding: '4px 12px',
                borderBottom: '1px solid #141414',
                background: trade.volume > 1000 ? 'rgba(255,215,0,0.1)' : 'transparent',
              }}
            >
              <Text style={{ color: '#8c8c8c', fontFamily: 'JetBrains Mono', fontSize: 11 }}>
                {dayjs(trade.timestamp).format('HH:mm:ss.SSS')}
              </Text>
              <Text style={{ color: trade.bs_flag === 'B' ? '#52c41a' : '#ff4d4f', textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: 11 }}>
                {trade.price.toFixed(2)}
              </Text>
              <Text style={{ color: trade.volume > 1000 ? '#faad14' : '#d9d9d9', textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: 11 }}>
                {trade.volume.toLocaleString()}
              </Text>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
};
