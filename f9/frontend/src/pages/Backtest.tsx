import React, { useState, useEffect } from 'react';
import {
  Layout,
  Form,
  Input,
  InputNumber,
  Slider,
  Button,
  Card,
  Table,
  Tag,
  Typography,
  Space,
  Progress,
  message,
  Select,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { BacktestTask, VWAPParams } from '../types';
import dayjs from 'dayjs';

const { Content, Sider } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

export const BacktestPage: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<BacktestTask[]>([]);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getSymbols().then(setSymbols).catch(console.error);
    loadTasks();

    const interval = setInterval(loadTasks, 2000);
    return () => clearInterval(interval);
  }, []);

  const loadTasks = async () => {
    try {
      const data = await api.getBacktestList();
      setTasks(data);
    } catch (error) {
      console.error(error);
    }
  };

  const handleSubmit = async (values: VWAPParams) => {
    setLoading(true);
    try {
      const task = await api.submitVWAPBacktest(values);
      message.success(`回测任务已提交: ${task.task_id}`);
      form.resetFields();
      loadTasks();
    } catch (error) {
      message.error('提交失败');
    } finally {
      setLoading(false);
    }
  };

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      pending: { color: 'default', text: '等待中' },
      running: { color: 'processing', text: '运行中' },
      completed: { color: 'success', text: '已完成' },
      failed: { color: 'error', text: '失败' },
    };
    const s = statusMap[status] || statusMap.pending;
    return <Tag color={s.color}>{s.text}</Tag>;
  };

  const columns = [
    {
      title: '任务ID',
      dataIndex: 'task_id',
      key: 'task_id',
      render: (id: string) => <Text code>{id.slice(0, 8)}</Text>,
    },
    {
      title: '策略',
      dataIndex: 'strategy',
      key: 'strategy',
    },
    {
      title: '股票',
      dataIndex: ['params', 'symbol'],
      key: 'symbol',
    },
    {
      title: '目标成交量',
      dataIndex: ['params', 'total_volume'],
      key: 'total_volume',
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '进度',
      key: 'progress',
      render: (_: any, record: BacktestTask) => (
        <Progress
          percent={Math.round(record.progress * 100)}
          size="small"
          status={record.status === 'failed' ? 'exception' : undefined}
        />
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: getStatusTag,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (t: string) => dayjs(t).format('MM-DD HH:mm:ss'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: BacktestTask) => (
        <Button
          type="link"
          disabled={record.status !== 'completed'}
          onClick={() => navigate(`/backtest/${record.task_id}`)}
        >
          查看结果
        </Button>
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Sider width={360} style={{ background: '#fff', padding: '24px', overflow: 'auto' }}>
        <Title level={4} style={{ marginBottom: 24 }}>VWAP 策略回测</Title>

        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            label="股票代码"
            name="symbol"
            rules={[{ required: true, message: '请选择股票' }]}
          >
            <Select placeholder="选择股票">
              {symbols.map((s) => (
                <Option key={s} value={s}>{s}</Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            label="目标成交量 (手)"
            name="total_volume"
            initialValue={100000}
            rules={[{ required: true, message: '请输入目标成交量' }]}
          >
            <InputNumber style={{ width: '100%' }} min={1000} step={1000} />
          </Form.Item>

          <Form.Item
            label="参与率"
            name="participation_rate"
            initialValue={0.1}
            rules={[{ required: true, message: '请输入参与率' }]}
          >
            <Slider min={0.01} max={0.5} step={0.01} />
          </Form.Item>
          <Text type="secondary" style={{ display: 'block', marginTop: -16, marginBottom: 16 }}>
            策略将按照市场成交量的此比例下单
          </Text>

          <Form.Item
            label="最小订单量 (手)"
            name="min_order_size"
            initialValue={100}
          >
            <InputNumber style={{ width: '100%' }} min={10} step={10} />
          </Form.Item>

          <Form.Item
            label="最大订单量 (手)"
            name="max_order_size"
            initialValue={5000}
          >
            <InputNumber style={{ width: '100%' }} min={100} step={100} />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              提交回测任务
            </Button>
          </Form.Item>
        </Form>
      </Sider>

      <Content style={{ padding: '24px' }}>
        <Card title="回测任务列表">
          <Table
            columns={columns}
            dataSource={tasks}
            rowKey="task_id"
            pagination={{ pageSize: 10 }}
          />
        </Card>
      </Content>
    </Layout>
  );
};
