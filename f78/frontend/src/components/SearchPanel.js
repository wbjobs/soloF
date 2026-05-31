import React, { useState } from 'react';
import { Input, Button, List, Card, Tag, Empty, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useLazyQuery, gql } from '@apollo/client';

const SEARCH_QUERY = gql`
  query Search($query: String!, $limit: Int) {
    search(query: $query, limit: $limit) {
      id
      name
      type
      category
    }
  }
`;

function SearchPanel() {
  const [searchText, setSearchText] = useState('');
  const [search, { loading, data }] = useLazyQuery(SEARCH_QUERY);

  const handleSearch = () => {
    if (searchText.trim()) {
      search({
        variables: {
          query: searchText.trim(),
          limit: 20,
        },
      });
    }
  };

  const typeColors = {
    Document: 'blue',
    TechTerm: 'green',
  };

  return (
    <div style={{ padding: 24 }}>
      <Card title="搜索技术文档和名词">
        <Input.Search
          placeholder="输入搜索关键词..."
          allowClear
          enterButton={<Button type="primary" icon={<SearchOutlined />}>搜索</Button>}
          size="large"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onSearch={handleSearch}
          style={{ marginBottom: 24 }}
        />

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin size="large" tip="搜索中..." />
          </div>
        )}

        {!loading && data?.search && data.search.length > 0 && (
          <List
            itemLayout="horizontal"
            dataSource={data.search}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={
                    <span>
                      {item.name}
                      <Tag color={typeColors[item.type] || 'default'} style={{ marginLeft: 8 }}>
                        {item.type}
                      </Tag>
                      {item.category && (
                        <Tag color="purple" style={{ marginLeft: 4 }}>
                          {item.category}
                        </Tag>
                      )}
                    </span>
                  }
                  description={`ID: ${item.id}`}
                />
              </List.Item>
            )}
          />
        )}

        {!loading && data?.search?.length === 0 && (
          <Empty description="未找到匹配的结果" />
        )}

        {!loading && !data && (
          <Empty description="输入关键词开始搜索" />
        )}
      </Card>
    </div>
  );
}

export default SearchPanel;
