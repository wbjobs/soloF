import React, { useState } from 'react';
import { useQuery } from '@apollo/client';
import { useAuth } from '../context/AuthContext';
import { FIND_SHORTEST_PATH, GET_NODE_BY_NAME } from '../graphql/queries';
import { extractPathFromRecursive, findPathLocally } from '../utils/pathFinder';

const styles = {
  container: {
    padding: '16px',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #eee',
    marginBottom: '16px',
  },
  title: {
    margin: '0 0 12px 0',
    fontSize: '16px',
    color: '#333',
  },
  form: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
  },
  inputGroup: {
    flex: '1',
    minWidth: '120px',
  },
  label: {
    display: 'block',
    marginBottom: '6px',
    fontSize: '13px',
    color: '#555',
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    outline: 'none',
  },
  button: {
    padding: '8px 20px',
    backgroundColor: '#6f42c1',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    whiteSpace: 'nowrap',
  },
  buttonDisabled: {
    padding: '8px 20px',
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'not-allowed',
    fontSize: '14px',
    whiteSpace: 'nowrap',
  },
  clearButton: {
    padding: '8px 16px',
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    whiteSpace: 'nowrap',
  },
  result: {
    marginTop: '12px',
    padding: '12px',
    borderRadius: '4px',
  },
  success: {
    backgroundColor: '#d4edda',
    border: '1px solid #c3e6cb',
    color: '#155724',
  },
  error: {
    backgroundColor: '#f8d7da',
    border: '1px solid #f5c6cb',
    color: '#721c24',
  },
  info: {
    backgroundColor: '#d1ecf1',
    border: '1px solid #bee5eb',
    color: '#0c5460',
  },
  pathDisplay: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    marginTop: '8px',
  },
  nodeBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 12px',
    backgroundColor: '#667eea',
    color: 'white',
    borderRadius: '12px',
    fontSize: '13px',
    fontWeight: '500',
  },
  arrow: {
    fontSize: '18px',
    color: '#ff6b6b',
  },
  methodSelect: {
    padding: '8px 10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    backgroundColor: 'white',
  },
};

export default function PathFinder({ nodes, edges, onPathFound, onClear }) {
  const [fromName, setFromName] = useState('');
  const [toName, setToName] = useState('');
  const [method, setMethod] = useState('server');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const { getOwner } = useAuth();
  const owner = getOwner();

  const [recursiveQuery] = useQuery(FIND_SHORTEST_PATH, {
    skip: true,
  });

  const [getFromNode] = useQuery(GET_NODE_BY_NAME, {
    skip: true,
  });

  const [getToNode] = useQuery(GET_NODE_BY_NAME, {
    skip: true,
  });

  const handleFindPath = async () => {
    if (!fromName.trim() || !toName.trim()) {
      setResult({ type: 'error', message: '请输入起点和终点节点名称' });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      if (method === 'local') {
        const path = findPathLocally(nodes, edges, fromName.trim(), toName.trim());
        if (path) {
          setResult({
            type: 'success',
            message: `找到最短路径，经过 ${path.nodes.length} 个节点，${path.edges.length} 条边`,
            path,
            nodeNames: path.nodes.map(id => {
              const node = nodes.find(n => n.id === id);
              return node ? node.name : id;
            }),
          });
          if (onPathFound) onPathFound(path);
        } else {
          setResult({ type: 'error', message: `未找到从「${fromName}」到「${toName}」的路径` });
          if (onPathFound) onPathFound(null);
        }
      } else {
        const fromResult = await getFromNode({
          variables: { name: fromName.trim(), owner },
        });
        const toResult = await getToNode({
          variables: { name: toName.trim(), owner },
        });

        const fromNode = fromResult.data?.queryNode?.[0];
        const toNode = toResult.data?.queryNode?.[0];

        if (!fromNode) {
          setResult({ type: 'error', message: `节点「${fromName}」不存在` });
          setLoading(false);
          return;
        }
        if (!toNode) {
          setResult({ type: 'error', message: `节点「${toName}」不存在` });
          setLoading(false);
          return;
        }

        const recursiveResult = await recursiveQuery({
          variables: { fromId: fromNode.id, toId: toNode.id, owner },
        });

        const path = extractPathFromRecursive(
          recursiveResult.data,
          fromNode.id,
          toNode.id
        );

        if (path) {
          const nodeNames = path.nodes.map(id => {
            if (id === fromNode.id) return fromNode.name;
            if (id === toNode.id) return toNode.name;
            const node = nodes.find(n => n.id === id);
            return node ? node.name : id;
          });

          setResult({
            type: 'success',
            message: `通过 Dgraph 递归查询找到路径，经过 ${path.nodes.length} 个节点，${path.edges.length} 条边`,
            path,
            nodeNames,
          });
          if (onPathFound) onPathFound(path);
        } else {
          setResult({ type: 'error', message: `未找到从「${fromName}」到「${toName}」的路径（深度限制10层）` });
          if (onPathFound) onPathFound(null);
        }
      }
    } catch (err) {
      console.error('路径查找失败:', err);
      setResult({ type: 'error', message: `查找失败: ${err.message}` });
    }

    setLoading(false);
  };

  const handleClear = () => {
    setFromName('');
    setToName('');
    setResult(null);
    if (onClear) onClear();
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>🛤️ 最短路径查找</h3>
      <div style={styles.form}>
        <div style={styles.inputGroup}>
          <label style={styles.label}>起点节点</label>
          <input
            type="text"
            style={styles.input}
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="输入起点名称"
          />
        </div>
        <div style={styles.inputGroup}>
          <label style={styles.label}>终点节点</label>
          <input
            type="text"
            style={styles.input}
            value={toName}
            onChange={(e) => setToName(e.target.value)}
            placeholder="输入终点名称"
          />
        </div>
        <div style={styles.inputGroup}>
          <label style={styles.label}>查询方式</label>
          <select
            style={styles.methodSelect}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="server">Dgraph 递归查询</option>
            <option value="local">本地 BFS 查询</option>
          </select>
        </div>
        <button
          onClick={handleFindPath}
          style={loading ? styles.buttonDisabled : styles.button}
          disabled={loading}
        >
          {loading ? '查找中...' : '查找路径'}
        </button>
        {result && (
          <button onClick={handleClear} style={styles.clearButton}>
            清除
          </button>
        )}
      </div>

      {result && (
        <div style={{ ...styles.result, ...styles[result.type] }}>
          <div>{result.message}</div>
          {result.path && result.nodeNames && (
            <div style={styles.pathDisplay}>
              {result.nodeNames.map((name, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span style={styles.arrow}>→</span>}
                  <span style={styles.nodeBadge}>{name}</span>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
