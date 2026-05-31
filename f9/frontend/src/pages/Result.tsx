import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout, Card, Row, Col, Statistic, Table, Typography, Button, Spin, message, Tag, Tabs } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, LeftOutlined, ThunderboltOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { api } from '../services/api';
import { BacktestResult } from '../types';
import dayjs from 'dayjs';

const { Content } = Layout;
const { Title, Text } = Typography;
const { TabPane } = Tabs;

export const ResultPage: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadResult();
  }, [taskId]);

  const loadResult = async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const data = await api.getBacktestResult(taskId);
      setResult(data);
    } catch (error) {
      message.error('加载结果失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!result) {
    return (
      <div style={{ padding: 50, textAlign: 'center' }}>
        <Text type="secondary">无数据</Text>
      </div>
    );
  }

  const pnlOption = {
    backgroundColor: '#fff',
    grid: { left: 60, right: 40, top: 40, bottom: 40 },
    title: { text: '累计盈亏曲线', left: 'center', textStyle: { fontSize: 14 } },
    xAxis: {
      type: 'category',
      data: result.pnl_curve.map((p) => p.timestamp),
      axisLabel: {
        formatter: (ts: number) => dayjs(ts).format('HH:mm'),
        fontSize: 10,
      },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => v.toFixed(0) },
    },
    series: [
      {
        name: '累计盈亏',
        type: 'line',
        smooth: true,
        data: result.pnl_curve.map((p) => p.cumulative_pnl),
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(24, 144, 255, 0.3)' },
              { offset: 1, color: 'rgba(24, 144, 255, 0.05)' },
            ],
          },
        },
        lineStyle: { color: '#1890ff', width: 2 },
        itemStyle: { color: '#1890ff' },
      },
    ],
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const data = params[0];
        const pnl = result.pnl_curve.find((p) => p.timestamp === data.name);
        if (!pnl) return '';
        return `
          时间: ${dayjs(pnl.timestamp).format('HH:mm:ss')}<br/>
          累计盈亏: ${pnl.cumulative_pnl.toFixed(2)}
        `;
      },
    },
  };

  const slippageOption = {
    backgroundColor: '#fff',
    grid: { left: 60, right: 40, top: 40, bottom: 40 },
    title: { text: '滑点分布', left: 'center', textStyle: { fontSize: 14 } },
    xAxis: {
      type: 'category',
      data: result.trades.map((_, i) => i + 1),
      axisLabel: { fontSize: 10 },
      name: '成交序号',
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => (v * 10000).toFixed(2) + 'bp' },
      name: '滑点',
    },
    series: [
      {
        name: '滑点',
        type: 'bar',
        data: result.trades.map((t) => t.slippage),
        itemStyle: {
          color: (params: any) => {
            return params.value >= 0 ? '#ff4d4f' : '#52c41a';
          },
        },
      },
    ],
    tooltip: {
      formatter: (params: any) => {
        return `滑点: ${(params.value * 10000).toFixed(2)} bp`;
      },
    },
  };

  const impactAnalysis = result.impact_analysis || [];
  
  const orderSizeVsSlippageOption = {
    backgroundColor: '#fff',
    grid: { left: 60, right: 40, top: 40, bottom: 40 },
    title: { text: '订单大小 vs 滑点（大单分析）', left: 'center', textStyle: { fontSize: 14 } },
    xAxis: {
      type: 'category',
      data: impactAnalysis.map((i, idx) => idx + 1),
      axisLabel: { fontSize: 10 },
      name: '大单序号',
    },
    yAxis: [
      {
        type: 'value',
        axisLabel: { formatter: (v: number) => v.toFixed(0) },
        name: '订单量（手）',
        position: 'left',
      },
      {
        type: 'value',
        axisLabel: { formatter: (v: number) => v.toFixed(1) + 'bp' },
        name: '滑点',
        position: 'right',
      },
    ],
    series: [
      {
        name: '订单量',
        type: 'bar',
        yAxisIndex: 0,
        data: impactAnalysis.map((i) => i.order_size),
        itemStyle: { color: 'rgba(24, 144, 255, 0.6)' },
      },
      {
        name: '实际滑点',
        type: 'line',
        yAxisIndex: 1,
        data: impactAnalysis.map((i) => i.slippage_bps),
        lineStyle: { color: '#ff4d4f', width: 2 },
        itemStyle: { color: '#ff4d4f' },
        symbol: 'circle',
        symbolSize: 8,
      },
      {
        name: '预期冲击滑点',
        type: 'line',
        yAxisIndex: 1,
        data: impactAnalysis.map((i) => i.temp_impact_bps + i.perm_impact_bps),
        lineStyle: { color: '#fa8c16', width: 2, type: 'dashed' },
        itemStyle: { color: '#fa8c16' },
        symbol: 'diamond',
        symbolSize: 6,
      },
    ],
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const idx = params[0].dataIndex;
        const data = impactAnalysis[idx];
        if (!data) return '';
        return `
          订单量: ${data.order_size} 手<br/>
          实际滑点: ${data.slippage_bps.toFixed(2)} bp<br/>
          预期冲击: ${(data.temp_impact_bps + data.perm_impact_bps).toFixed(2)} bp<br/>
          冲击成本: ${data.total_impact_cost.toFixed(2)} 元
        `;
      },
    },
    legend: { data: ['订单量', '实际滑点', '预期冲击滑点'], top: 10 },
  };

  const impactBreakdownOption = {
    backgroundColor: '#fff',
    grid: { left: 60, right: 40, top: 40, bottom: 40 },
    title: { text: '冲击成本构成（临时 vs 永久）', left: 'center', textStyle: { fontSize: 14 } },
    xAxis: {
      type: 'category',
      data: impactAnalysis.map((i, idx) => idx + 1),
      axisLabel: { fontSize: 10 },
      name: '大单序号',
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => v.toFixed(1) + 'bp' },
      name: '冲击（bp）',
    },
    series: [
      {
        name: '临时冲击',
        type: 'bar',
        stack: 'total',
        data: impactAnalysis.map((i) => i.temp_impact_bps),
        itemStyle: { color: '#ff7a45' },
      },
      {
        name: '永久冲击',
        type: 'bar',
        stack: 'total',
        data: impactAnalysis.map((i) => i.perm_impact_bps),
        itemStyle: { color: '#cf1322' },
      },
    ],
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const idx = params[0].dataIndex;
        const data = impactAnalysis[idx];
        if (!data) return '';
        return `
          临时冲击: ${data.temp_impact_bps.toFixed(2)} bp<br/>
          永久冲击: ${data.perm_impact_bps.toFixed(2)} bp<br/>
          总冲击: ${(data.temp_impact_bps + data.perm_impact_bps).toFixed(2)} bp
        `;
      },
    },
    legend: { data: ['临时冲击', '永久冲击'], top: 10 },
  };

  const impactCostCumulativeOption = {
    backgroundColor: '#fff',
    grid: { left: 60, right: 40, top: 40, bottom: 40 },
    title: { text: '累计冲击成本', left: 'center', textStyle: { fontSize: 14 } },
    xAxis: {
      type: 'category',
      data: impactAnalysis.map((i, idx) => idx + 1),
      axisLabel: { fontSize: 10 },
      name: '大单序号',
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => v.toFixed(0) + '元' },
      name: '累计冲击成本',
    },
    series: [
      {
        name: '累计冲击成本',
        type: 'line',
        smooth: true,
        data: impactAnalysis.reduce((acc: number[], i) => {
          const last = acc.length > 0 ? acc[acc.length - 1] : 0;
          acc.push(last + i.total_impact_cost);
          return acc;
        }, []),
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(255, 77, 79, 0.3)' },
              { offset: 1, color: 'rgba(255, 77, 79, 0.05)' },
            ],
          },
        },
        lineStyle: { color: '#ff4d4f', width: 2 },
        itemStyle: { color: '#ff4d4f' },
      },
    ],
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        return `累计冲击成本: ${params[0].value.toFixed(2)} 元`;
      },
    },
  };

  const tradeColumns = [
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      render: (t: number) => dayjs(t).format('HH:mm:ss.SSS'),
    },
    {
      title: '大单标记',
      dataIndex: 'is_large_order',
      key: 'is_large_order',
      render: (v: boolean) => v ? <Tag icon={<ThunderboltOutlined />} color="orange">大单</Tag> : '-',
    },
    {
      title: '方向',
      dataIndex: 'side',
      key: 'side',
      render: (s: string) => (
        <Text type={s === 'buy' ? 'success' : 'danger'}>
          {s === 'buy' ? '买入' : '卖出'}
        </Text>
      ),
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      render: (v: number) => v.toFixed(2),
    },
    {
      title: '数量',
      dataIndex: 'volume',
      key: 'volume',
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '滑点',
      dataIndex: 'slippage',
      key: 'slippage',
      render: (v: number) => (
        <Text type={v >= 0.005 ? 'danger' : v >= 0.001 ? 'warning' : 'success'}>
          {(v * 10000).toFixed(2)} bp
        </Text>
      ),
    },
  ];

  const largeOrderColumns = [
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      render: (t: number) => dayjs(t).format('HH:mm:ss.SSS'),
    },
    {
      title: '订单量',
      dataIndex: 'order_size',
      key: 'order_size',
      render: (v: number) => `${v.toLocaleString()} 手`,
    },
    {
      title: '市场价格',
      dataIndex: 'market_price',
      key: 'market_price',
      render: (v: number) => v.toFixed(2),
    },
    {
      title: '成交价格',
      dataIndex: 'execution_price',
      key: 'execution_price',
      render: (v: number) => v.toFixed(2),
    },
    {
      title: '实际滑点',
      dataIndex: 'slippage_bps',
      key: 'slippage_bps',
      render: (v: number) => (
        <Text type={v > 20 ? 'danger' : v > 10 ? 'warning' : 'success'}>
          {v.toFixed(2)} bp
        </Text>
      ),
    },
    {
      title: '临时冲击',
      dataIndex: 'temp_impact_bps',
      key: 'temp_impact_bps',
      render: (v: number) => `${v.toFixed(2)} bp`,
    },
    {
      title: '永久冲击',
      dataIndex: 'perm_impact_bps',
      key: 'perm_impact_bps',
      render: (v: number) => `${v.toFixed(2)} bp`,
    },
    {
      title: '冲击成本',
      dataIndex: 'total_impact_cost',
      key: 'total_impact_cost',
      render: (v: number) => `${v.toFixed(2)} 元`,
    },
  ];

  const { metrics } = result;

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Content style={{ padding: '24px' }}>
        <div style={{ marginBottom: 16 }}>
          <Button icon={<LeftOutlined />} onClick={() => navigate('/backtest')}>
            返回
          </Button>
        </div>

        <Title level={3} style={{ marginBottom: 24 }}>
          回测结果 - {taskId?.slice(0, 8)}
        </Title>

        <Tabs defaultActiveKey="1">
          <TabPane tab="核心指标" key="1">
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="总盈亏"
                    value={metrics.total_pnl}
                    precision={2}
                    valueStyle={{ color: metrics.total_pnl >= 0 ? '#3f8600' : '#cf1322' }}
                    prefix={metrics.total_pnl >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                    suffix="元"
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="总手续费"
                    value={metrics.total_commission}
                    precision={2}
                    suffix="元"
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="总冲击成本"
                    value={metrics.total_impact_cost || 0}
                    precision={2}
                    suffix="元"
                    valueStyle={{ color: '#cf1322' }}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="成交笔数"
                    value={metrics.total_trades}
                  />
                </Card>
              </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="胜率"
                    value={metrics.win_rate * 100}
                    precision={2}
                    suffix="%"
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="夏普比率"
                    value={metrics.sharpe_ratio}
                    precision={2}
                    valueStyle={{ color: metrics.sharpe_ratio > 1 ? '#3f8600' : '#cf1322' }}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="最大回撤"
                    value={metrics.max_drawdown * 100}
                    precision={2}
                    suffix="%"
                    valueStyle={{ color: metrics.max_drawdown < 0.05 ? '#3f8600' : '#cf1322' }}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="平均滑点"
                    value={metrics.avg_slippage * 10000}
                    precision={2}
                    suffix="bp"
                    valueStyle={{ color: metrics.avg_slippage > 0.001 ? '#cf1322' : '#3f8600' }}
                  />
                </Card>
              </Col>
            </Row>

            <Row gutter={16} style={{ marginBottom: 24 }}>
              <Col span={12}>
                <Card>
                  <ReactECharts option={pnlOption} style={{ height: 400 }} />
                </Card>
              </Col>
              <Col span={12}>
                <Card>
                  <ReactECharts option={slippageOption} style={{ height: 400 }} />
                </Card>
              </Col>
            </Row>

            <Card title="成交明细">
              <Table
                columns={tradeColumns}
                dataSource={result.trades}
                rowKey={(record, idx) => idx?.toString() || ''}
                pagination={{ pageSize: 20 }}
              />
            </Card>
          </TabPane>

          <TabPane tab={
            <span>
              <ThunderboltOutlined />
              市场冲击分析
              {metrics.large_order_count > 0 && (
                <Tag color="orange" style={{ marginLeft: 8 }}>
                  {metrics.large_order_count} 笔大单
                </Tag>
              )}
            </span>
          } key="2">
            {impactAnalysis.length > 0 ? (
              <>
                <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                  <Col span={8}>
                    <Card>
                      <Statistic
                        title="大单数量"
                        value={metrics.large_order_count || 0}
                        suffix="笔"
                        valueStyle={{ color: '#fa8c16' }}
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card>
                      <Statistic
                        title="大单总成交量"
                        value={metrics.large_order_total_volume || 0}
                        suffix="手"
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card>
                      <Statistic
                        title="大单平均滑点"
                        value={metrics.avg_large_order_slippage_bps || 0}
                        precision={2}
                        suffix="bp"
                        valueStyle={{ color: (metrics.avg_large_order_slippage_bps || 0) > 20 ? '#cf1322' : '#3f8600' }}
                      />
                    </Card>
                  </Col>
                </Row>

                <Row gutter={16} style={{ marginBottom: 24 }}>
                  <Col span={12}>
                    <Card>
                      <ReactECharts option={orderSizeVsSlippageOption} style={{ height: 400 }} />
                    </Card>
                  </Col>
                  <Col span={12}>
                    <Card>
                      <ReactECharts option={impactBreakdownOption} style={{ height: 400 }} />
                    </Card>
                  </Col>
                </Row>

                <Row gutter={16} style={{ marginBottom: 24 }}>
                  <Col span={12}>
                    <Card>
                      <ReactECharts option={impactCostCumulativeOption} style={{ height: 400 }} />
                    </Card>
                  </Col>
                </Row>

                <Card title="大单冲击明细">
                  <Table
                    columns={largeOrderColumns}
                    dataSource={impactAnalysis}
                    rowKey={(record, idx) => idx?.toString() || ''}
                    pagination={{ pageSize: 10 }}
                  />
                </Card>
              </>
            ) : (
              <Card>
                <div style={{ textAlign: 'center', padding: '50px' }}>
                  <Text type="secondary">
                    本次回测中没有检测到大单交易（> 1000手）。<br/>
                    可以尝试增加最大订单量参数来进行大单冲击测试。
                  </Text>
                </div>
              </Card>
            )}
          </TabPane>
        </Tabs>
      </Content>
    </Layout>
  );
};
