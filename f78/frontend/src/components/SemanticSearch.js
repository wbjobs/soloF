import React, { useState, useCallback } from 'react';
import { Input, Button, Card, List, Tag, Spin, Alert, Space, Slider, Typography, Row, Col, Empty } from 'antd';
import { SearchOutlined, BulbOutlined } from '@ant-design/icons';
import { useLazyQuery, gql } from '@apollo/client';

const { Title, Text } = Typography;

const SEMANTIC_SEARCH_QUERY = gql`
  query SemanticSearch($query: String!, $maxDepth: Int, $minScore: Float) {
    semanticSearch(query: $query, maxDepth: $maxDepth, minScore: $minScore) {
      query
      nodes {
        id
        name
        category
      }
      paths {
        nodes {
          id
          name
          category
        }
        links {
          source
          target
        }
        score
      }
      highlightedNodeIds
      highlightedLinkIds
    }
  }
`;

const categoryColors = {
  'Programming Language': 'blue',
  'Framework': 'green',
  'Database': 'orange',
  'Concept': 'purple',
  'Other': 'default',
};

function SemanticSearch({ onHighlight }) {
  const [query, setQuery] = useState('');
  const [maxDepth, setMaxDepth] = useState(2);
  const [minScore, setMinScore] = useState(0.3);
  const [search, { loading, data, error }] = useLazyQuery(SEMANTIC_SEARCH_QUERY);

  const handleSearch = useCallback(() => {
    if (query.trim()) {
      search({
        variables: {
          query: query.trim(),
          maxDepth,
          minScore,
        },
      });
    }
  }, [query, maxDepth, minScore, search]);

  const handleHighlight = useCallback((path) => {
    if (onHighlight) {
      const nodeIds = path.nodes.map(n => n.id);
      const linkIds = path.links.map(l => `${l.source}-${l.target}`);
      onHighlight(nodeIds, linkIds);
    }
  }, [onHighlight]);

  const clearHighlight = useCallback(() => {
    if (onHighlight) {
      onHighlight([], []);
    }
  }, [onHighlight]);

  return (
    <Card
      title={
        <Space>
          <BulbOutlined style={{ color: '#faad14' }} />
          <span>语义搜索</span>
        </Space>
      }
      style={{ width: '100%' }}
      size="small"
    >
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <Input.Search
          placeholder="输入自然语言问题，如：Go 语言和数据库有什么关系？"
          allowClear
          enterButton={
            <Button type="primary" icon={<SearchOutlined />} loading={loading}>
              搜索
            </Button>
          }
          size="middle"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onSearch={handleSearch}
        />

        <Row gutter={16}>
          <Col span={12}>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>路径深度: {maxDepth}</Text>
              <Slider
                min={1}
                max={4}
                value={maxDepth}
                onChange={setMaxDepth}
              />
            </div>
          </Col>
          <Col span={12}>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>最小相似度: {minScore.toFixed(2)}</Text>
              <Slider
                min={0.1}
                max={0.8}
                step={0.05}
                value={minScore}
                onChange={setMinScore}
              />
            </div>
          </Col>
        </Row>

        {loading && (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <Spin tip="正在计算向量相似度..." />
          </div>
        )}

        {error && (
          <Alert
            type="error"
            message="搜索失败"
            description={error.message}
            showIcon
          />
        )}

        {data?.semanticSearch && (
          <>
            <Alert
              type="info"
              showIcon
              message={
                <Space>
                  <span>找到 <strong>{data.semanticSearch.nodes.length}</strong> 个相关节点</span>
                  <span>和 <strong>{data.semanticSearch.paths.length}</strong> 条关联路径</span>
                </Space>
              }
              action={
                data.semanticSearch.paths.length > 0 && (
                  <Button size="small" onClick={clearHighlight}>
                    清除高亮
                  </Button>
                )
              }
            />

            {data.semanticSearch.paths.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Title level={5} style={{ margin: '8px 0' }}>相关路径 (点击高亮)</Title>
                <List
                  size="small"
                  dataSource={data.semanticSearch.paths}
                  renderItem={(path, index) => (
                    <List.Item
                      onClick={() => handleHighlight(path)}
                      style={{
                        cursor: 'pointer',
                        padding: '8px 12px',
                        borderRadius: 4,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#f0f5ff';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <List.Item.Meta
                        title={
                          <Space wrap>
                            {path.nodes.map((node, i) => (
                              <React.Fragment key={node.id}>
                                <Tag color={categoryColors[node.category] || 'default'}>
                                  {node.name}
                                </Tag>
                                {i < path.nodes.length - 1 && (
                                  <span style={{ color: '#999' }}>→</span>
                                )}
                              </React.Fragment>
                            ))}
                          </Space>
                        }
                        description={
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            相似度: {(path.score * 100).toFixed(1)}%
                          </Text>
                        }
                      />
                    </List.Item>
                  )}
                />
              </div>
            )}

            {data.semanticSearch.paths.length === 0 && data.semanticSearch.nodes.length === 0 && (
              <Empty description="未找到相关结果，请尝试调整搜索条件" />
            )}
          </>
        )}
      </Space>
    </Card>
  );
}

export default SemanticSearch;
