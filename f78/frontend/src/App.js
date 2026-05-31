import React, { useState, useCallback } from 'react';
import { Layout, Menu, Drawer, Button, Space, Statistic, Card, Row, Col, Tag } from 'antd';
import { MenuOutlined, DatabaseOutlined, ReloadOutlined, SearchOutlined, BulbOutlined } from '@ant-design/icons';
import KnowledgeGraph from './components/KnowledgeGraph';
import StatsPanel from './components/StatsPanel';
import SearchPanel from './components/SearchPanel';
import SemanticSearch from './components/SemanticSearch';
import { useQuery, gql } from '@apollo/client';

const { Header, Content, Sider } = Layout;

const STATS_QUERY = gql`
  query GetStats {
    stats {
      documentCount
      techTermCount
      relationshipCount
      topTerms {
        name
        count
        category
      }
    }
  }
`;

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('graph');
  const [highlightedNodeIds, setHighlightedNodeIds] = useState([]);
  const [highlightedLinkIds, setHighlightedLinkIds] = useState([]);

  const { data, loading, refetch } = useQuery(STATS_QUERY, {
    pollInterval: 5000,
  });

  const handleNodeClick = useCallback((node) => {
    console.log('Node clicked:', node);
  }, []);

  const handleHighlight = useCallback((nodeIds, linkIds) => {
    setHighlightedNodeIds(nodeIds);
    setHighlightedLinkIds(linkIds);
  }, []);

  const menuItems = [
    {
      key: 'graph',
      icon: <DatabaseOutlined />,
      label: '知识图谱',
      onClick: () => setActiveTab('graph'),
    },
    {
      key: 'semantic',
      icon: <BulbOutlined />,
      label: '语义搜索',
      onClick: () => setActiveTab('semantic'),
    },
    {
      key: 'stats',
      icon: <ReloadOutlined />,
      label: '统计面板',
      onClick: () => setActiveTab('stats'),
    },
    {
      key: 'search',
      icon: <SearchOutlined />,
      label: '关键字搜索',
      onClick: () => setActiveTab('search'),
    },
  ];

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider trigger={null} collapsible collapsed={collapsed} theme="dark">
        <div style={{ height: 32, margin: 16, background: 'rgba(255, 255, 255, 0.2)' }} />
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[activeTab]}
          items={menuItems}
        />
      </Sider>
      <Layout>
        <Header style={{ padding: 0, background: '#fff', display: 'flex', alignItems: 'center' }}>
          <Button
            type="text"
            icon={<MenuOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ fontSize: '16px', width: 64, height: 64 }}
          />
          <div style={{ flex: 1, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>技术知识图谱</h2>
            <Space>
              {data?.stats && (
                <>
                  <Tag color="blue">文档: {data.stats.documentCount}</Tag>
                  <Tag color="green">技术名词: {data.stats.techTermCount}</Tag>
                  <Tag color="orange">关系: {data.stats.relationshipCount}</Tag>
                </>
              )}
              <Button onClick={() => refetch()}>刷新</Button>
              <Button type="primary" onClick={() => setDrawerVisible(true)}>
                菜单
              </Button>
            </Space>
          </div>
        </Header>
        <Content style={{ margin: 0, background: '#f0f2f5', overflow: 'auto' }}>
          {activeTab === 'graph' && (
            <KnowledgeGraph
              onNodeClick={handleNodeClick}
              highlightedNodeIds={highlightedNodeIds}
              highlightedLinkIds={highlightedLinkIds}
            />
          )}
          {activeTab === 'semantic' && (
            <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
              <Row gutter={16}>
                <Col span={8}>
                  <SemanticSearch onHighlight={handleHighlight} />
                </Col>
                <Col span={16}>
                  <KnowledgeGraph
                    onNodeClick={handleNodeClick}
                    highlightedNodeIds={highlightedNodeIds}
                    highlightedLinkIds={highlightedLinkIds}
                  />
                </Col>
              </Row>
            </div>
          )}
          {activeTab === 'stats' && (
            <StatsPanel stats={data?.stats} loading={loading} />
          )}
          {activeTab === 'search' && (
            <SearchPanel />
          )}
        </Content>
      </Layout>
      <Drawer
        title="快捷操作"
        placement="right"
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
      >
        <Row gutter={[16, 16]}>
          <Col span={24}>
            <Card>
              <Statistic
                title="文档总数"
                value={data?.stats?.documentCount || 0}
                loading={loading}
              />
            </Card>
          </Col>
          <Col span={24}>
            <Card>
              <Statistic
                title="技术名词"
                value={data?.stats?.techTermCount || 0}
                loading={loading}
              />
            </Card>
          </Col>
          <Col span={24}>
            <Card>
              <Statistic
                title="关系数量"
                value={data?.stats?.relationshipCount || 0}
                loading={loading}
              />
            </Card>
          </Col>
        </Row>
      </Drawer>
    </Layout>
  );
}

export default App;
