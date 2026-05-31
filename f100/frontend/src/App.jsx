import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useLazyQuery } from '@apollo/client';
import { useAuth } from './context/AuthContext';
import { GET_ALL_NODES_AND_EDGES, GET_NEIGHBOR_SUBGRAPH } from './graphql/queries';
import Login from './components/Login';
import CSVUpload from './components/CSVUpload';
import ForceGraph from './components/ForceGraph';
import PathFinder from './components/PathFinder';
import NeighborSubgraph from './components/NeighborSubgraph';

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    padding: '16px 24px',
    borderBottom: '1px solid #eee',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    color: '#333',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  tenantBadge: {
    padding: '4px 12px',
    backgroundColor: '#e3f2fd',
    color: '#1976d2',
    borderRadius: '12px',
    fontSize: '13px',
    fontWeight: '500',
  },
  logoutButton: {
    padding: '6px 16px',
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
  },
  main: {
    padding: '24px',
    maxWidth: '1400px',
    margin: '0 auto',
  },
  statsBar: {
    display: 'flex',
    gap: '16px',
    marginBottom: '16px',
  },
  statCard: {
    flex: '1',
    backgroundColor: 'white',
    padding: '16px',
    borderRadius: '8px',
    border: '1px solid #eee',
    textAlign: 'center',
  },
  statNumber: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#667eea',
  },
  statLabel: {
    fontSize: '13px',
    color: '#666',
    marginTop: '4px',
  },
  refreshButton: {
    padding: '8px 16px',
    backgroundColor: '#17a2b8',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
  },
  section: {
    backgroundColor: 'white',
    padding: '16px',
    borderRadius: '8px',
    border: '1px solid #eee',
    marginBottom: '16px',
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '16px',
    color: '#333',
  },
  emptyState: {
    padding: '60px 20px',
    textAlign: 'center',
    color: '#888',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #eee',
  },
  loading: {
    padding: '40px',
    textAlign: 'center',
    color: '#666',
  },
};

export default function App() {
  const { user, logout, getOwner, loading: authLoading } = useAuth();
  const owner = getOwner();
  const [highlightNodes, setHighlightNodes] = useState([]);
  const [highlightEdges, setHighlightEdges] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [neighborSubgraph, setNeighborSubgraph] = useState(null);

  const {
    data: graphData,
    loading: graphLoading,
    error: graphError,
    refetch: refetchGraph,
  } = useQuery(GET_ALL_NODES_AND_EDGES, {
    variables: { owner },
    skip: !owner,
    fetchPolicy: 'network-only',
  });

  const [getNeighborSubgraph] = useLazyQuery(GET_NEIGHBOR_SUBGRAPH);

  const nodes = graphData?.queryNode || [];
  const edges = graphData?.queryEdge || [];

  const handleNodeClick = useCallback(async (node) => {
    setSelectedNode(node.id);

    try {
      const result = await getNeighborSubgraph({
        variables: { nodeId: node.id, owner },
      });

      const nodeData = result.data?.queryNode?.[0];
      if (nodeData) {
        const subgraphNodes = new Map();
        const subgraphEdges = [];

        subgraphNodes.set(nodeData.id, { id: nodeData.id, name: nodeData.name });

        nodeData.outEdges?.forEach(edge => {
          if (edge.to && edge.to.owner === owner) {
            subgraphNodes.set(edge.to.id, { id: edge.to.id, name: edge.to.name });
            subgraphEdges.push({
              id: edge.id,
              from: { id: nodeData.id, name: nodeData.name },
              to: { id: edge.to.id, name: edge.to.name },
              weight: edge.weight,
            });
          }
        });

        nodeData.inEdges?.forEach(edge => {
          if (edge.from && edge.from.owner === owner) {
            subgraphNodes.set(edge.from.id, { id: edge.from.id, name: edge.from.name });
            subgraphEdges.push({
              id: edge.id,
              from: { id: edge.from.id, name: edge.from.name },
              to: { id: nodeData.id, name: nodeData.name },
              weight: edge.weight,
            });
          }
        });

        setNeighborSubgraph({
          centerNode: nodeData,
          nodes: Array.from(subgraphNodes.values()),
          edges: subgraphEdges,
        });
      }
    } catch (err) {
      console.error('获取相邻子图失败:', err);
    }
  }, [owner, getNeighborSubgraph]);

  const handlePathFound = useCallback((path) => {
    if (path) {
      setHighlightNodes(path.nodes);
      setHighlightEdges(path.edges);
      setSelectedNode(null);
    } else {
      setHighlightNodes([]);
      setHighlightEdges([]);
    }
  }, []);

  const handleClearPath = useCallback(() => {
    setHighlightNodes([]);
    setHighlightEdges([]);
  }, []);

  const handleImportComplete = useCallback(() => {
    refetchGraph();
  }, [refetchGraph]);

  const handleCloseSubgraph = useCallback(() => {
    setNeighborSubgraph(null);
    setSelectedNode(null);
  }, []);

  const handleRefresh = useCallback(() => {
    refetchGraph();
    setHighlightNodes([]);
    setHighlightEdges([]);
    setSelectedNode(null);
    setNeighborSubgraph(null);
  }, [refetchGraph]);

  if (authLoading) {
    return <div style={styles.loading}>加载中...</div>;
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>📊 图数据库可视化平台</h1>
        <div style={styles.userInfo}>
          <span style={styles.tenantBadge}>🏢 租户: {owner}</span>
          <button onClick={logout} style={styles.logoutButton}>
            退出登录
          </button>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.statsBar}>
          <div style={styles.statCard}>
            <div style={styles.statNumber}>{nodes.length}</div>
            <div style={styles.statLabel}>节点总数</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statNumber}>{edges.length}</div>
            <div style={styles.statLabel}>边总数</div>
          </div>
          <div style={{ ...styles.statCard, flex: 'none' }}>
            <button onClick={handleRefresh} style={styles.refreshButton}>
              🔄 刷新数据
            </button>
          </div>
        </div>

        <CSVUpload onImportComplete={handleImportComplete} />

        <PathFinder
          nodes={nodes}
          edges={edges}
          onPathFound={handlePathFound}
          onClear={handleClearPath}
        />

        {neighborSubgraph && (
          <NeighborSubgraph
            centerNode={neighborSubgraph.centerNode}
            nodes={neighborSubgraph.nodes}
            edges={neighborSubgraph.edges}
            onClose={handleCloseSubgraph}
            onNodeClick={handleNodeClick}
          />
        )}

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>🌐 全局力导向图</h3>
          {graphLoading ? (
            <div style={styles.loading}>加载图数据中...</div>
          ) : graphError ? (
            <div style={{ ...styles.emptyState, color: '#dc3545' }}>
              加载失败: {graphError.message}
            </div>
          ) : nodes.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
              <div style={{ fontSize: '16px', marginBottom: '8px' }}>暂无数据</div>
              <div style={{ fontSize: '13px', color: '#888' }}>
                请上传 CSV 文件导入边数据（两列：from, to）
              </div>
            </div>
          ) : (
            <ForceGraph
              nodes={nodes}
              edges={edges}
              onNodeClick={handleNodeClick}
              highlightNodes={highlightNodes}
              highlightEdges={highlightEdges}
              selectedNode={selectedNode}
            />
          )}
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>💡 使用说明</h3>
          <ul style={{ fontSize: '13px', color: '#555', lineHeight: '2', margin: 0, paddingLeft: '20px' }}>
            <li><strong>CSV 导入：</strong>上传包含 from 和 to 两列的 CSV 文件，批量导入节点和边</li>
            <li><strong>节点点击：</strong>点击任意节点可查看其相邻子图（所有直接连接的节点）</li>
            <li><strong>路径查找：</strong>输入起点和终点名称，查找两点间最短路径并高亮显示</li>
            <li><strong>查询方式：</strong>可选择 Dgraph 递归查询（服务端）或本地 BFS 查询</li>
            <li><strong>图操作：</strong>支持鼠标滚轮缩放、拖拽平移、节点拖拽定位</li>
            <li><strong>多租户隔离：</strong>不同用户登录后数据相互独立，无法互访</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
