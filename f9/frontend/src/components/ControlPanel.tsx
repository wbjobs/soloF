import React, { useState, useEffect } from 'react';
import { Button, Slider, Select, Space, Typography, Upload, message } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined, UploadOutlined, ReloadOutlined } from '@ant-design/icons';
import { useReplayStore } from '../store/replayStore';
import { api } from '../services/api';
import dayjs from 'dayjs';

const { Text } = Typography;
const { Option } = Select;

interface ControlPanelProps {
  ws: WebSocket | null;
  onSymbolChange: (symbol: string) => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ ws, onSymbolChange }) => {
  const { isPlaying, speed, currentTime, startTime, endTime, setPlaying, setSpeed, setCurrentTime } = useReplayStore();
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');

  useEffect(() => {
    api.getSymbols().then(setSymbols).catch(console.error);
  }, []);

  const handleUpload = async (file: File) => {
    try {
      const result = await api.uploadCSV(file);
      if (result.success) {
        message.success(`加载成功，共 ${result.total_ticks} 条数据，${result.symbols.length} 只股票`);
        setSymbols(result.symbols);
      }
    } catch (error) {
        message.error('上传失败');
    }
    return false;
  };

  const handlePlayPause = () => {
    if (!ws) {
      message.warning('请先选择股票');
      return;
    } else {
      const newPlaying = !isPlaying;
      setPlaying(newPlaying);
      ws.send(JSON.stringify({ action: newPlaying ? 'play' : 'pause' }));
    }
  };

  const handleSpeedChange = (value: number) => {
    setSpeed(value);
    if (ws) {
      ws.send(JSON.stringify({ action: 'speed', payload: { speed: value } }));
    }
  };

  const handleSeek = (value: number) => {
    setCurrentTime(value);
    if (ws) {
      ws.send(JSON.stringify({ action: 'seek', payload: { timestamp: value } }));
    }
  };

  const handleSymbolChange = (symbol: string) => {
    setSelectedSymbol(symbol);
    onSymbolChange(symbol);
  };

  const formatTime = (ts: number) => {
    return dayjs(ts).format('HH:mm:ss.SSS');
  };

  return (
    <div style={{ 
      padding: '16px 24px', 
      background: '#001529', 
      borderBottom: '1px solid #303030',
      display: 'flex',
      alignItems: 'center',
      gap: '24px'
    }}>
      <Space>
        <Upload beforeUpload={handleUpload} showUploadList={false}>
          <Button icon={<UploadOutlined />} type="primary">
            加载CSV
          </Button>
        </Upload>
        <Button icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
          重置
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
          style={{ background: isPlaying ? '#ff4d4f' : '#52c41a' }}
        />
      </Space>

      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <Text style={{ color: '#8c8c8c', fontSize: '12px', width: '80px' }}>速度:
            {formatTime(startTime)}</Text>
          <Slider
            min={startTime}
            max={endTime}
            value={currentTime}
            onChange={handleSeek}
            style={{ flex: 1 }}
            tooltip={{ formatter: (value) => value ? formatTime(value) : '' }}
          />
          <Text style={{ color: '#8c8c8c', fontSize: '12px', width: '80px', textAlign: 'right' }}>
            {formatTime(endTime)}
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

      <Text style={{ color: '#fff', fontSize: '16px', fontFamily: 'JetBrains Mono' }}>
        {formatTime(currentTime)}
      </Text>
    </div>
  );
};
