import React from 'react';
import ForceGraph from './ForceGraph';

const styles = {
  container: {
    padding: '16px',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #eee',
    marginBottom: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    color: '#333',
  },
  closeButton: {
    padding: '4px 12px',
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  info: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '12px',
  },
  statBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    backgroundColor: '#e9ecef',
    borderRadius: '12px',
    fontSize: '12px',
    marginRight: '8px',
  },
};

export default function NeighborSubgraph({
  centerNode,
  nodes,
  edges,
  onClose,
  onNodeClick,
}) {
  if (!centerNode) return null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>
          🔍 节点「{centerNode.name}」的相邻子图
        </h3>
        <button onClick={onClose} style={styles.closeButton}>
          关闭
        </button>
      </div>
      <div style={styles.info}>
        <span style={styles.statBadge}>节点数: {nodes.length}</span>
        <span style={styles.statBadge}>边数: {edges.length}</span>
      </div>
      <ForceGraph
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        selectedNode={centerNode.id}
      />
    </div>
  );
}
