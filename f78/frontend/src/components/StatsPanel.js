import React from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Progress, Spin } from 'antd';

function StatsPanel({ stats, loading }) {
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Spin size="large" tip="加载统计数据中..." />
      </div>
    );
  }

  const topTermsData = stats?.topTerms?.map((term, index) => ({
    key: index,
    name: term.name,
    count: term.count,
    category: term.category,
  })) || [];

  const maxCount = Math.max(...topTermsData.map(t => t.count), 1);

  const columns = [
    {
      title: '排名',
      dataIndex: 'key',
      key: 'rank',
      width: 80,
      render: (_, __, index) => <Tag color={index < 3 ? 'gold' : 'default'}>#{index + 1}</Tag>,
    },
    {
      title: '技术名词',
      dataIndex: 'name',
      key: 'name',
      render: (text) => <strong>{text}</strong>,
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      render: (text) => {
        const colorMap = {
          'Programming Language': 'blue',
          'Framework': 'green',
          'Database': 'orange',
          'Concept': 'purple',
          'Other': 'default',
        };
        return <Tag color={colorMap[text] || 'default'}>{text}</Tag>;
      },
    },
    {
      title: '出现次数',
      dataIndex: 'count',
      key: 'count',
      width: 200,
      render: (count) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Progress
            percent={Math.round((count / maxCount) * 100)}
            showInfo={false}
            size="small"
            style={{ width: 100 }}
          />
          <span>{count}</span>
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={[16, 16]}>
        <Col span={8}>
          <Card>
            <Statistic
              title="文档总数"
              value={stats?.documentCount || 0}
              prefix={<span style={{ color: '#1890ff' }}>📄</span>}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="技术名词"
              value={stats?.techTermCount || 0}
              prefix={<span style={{ color: '#52c41a' }}>🔬</span>}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="关系数量"
              value={stats?.relationshipCount || 0}
              prefix={<span style={{ color: '#faad14' }}>🔗</span>}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title="热门技术名词 TOP 10"
        style={{ marginTop: 24 }}
        extra={<Tag color="blue">按出现次数排序</Tag>}
      >
        <Table
          dataSource={topTermsData}
          columns={columns}
          pagination={false}
        />
      </Card>
    </div>
  );
}

export default StatsPanel;
