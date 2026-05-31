import React, { useState } from 'react';
import Papa from 'papaparse';
import { useMutation } from '@apollo/client';
import { useAuth } from '../context/AuthContext';
import { ADD_EDGE_BY_NAME, ADD_NODE } from '../graphql/mutations';

const styles = {
  container: {
    padding: '16px',
    border: '2px dashed #ddd',
    borderRadius: '8px',
    backgroundColor: '#fafafa',
    marginBottom: '16px',
  },
  title: {
    margin: '0 0 12px 0',
    fontSize: '16px',
    color: '#333',
  },
  input: {
    display: 'block',
    marginBottom: '12px',
  },
  button: {
    padding: '8px 16px',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    marginRight: '8px',
  },
  buttonDisabled: {
    padding: '8px 16px',
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'not-allowed',
    marginRight: '8px',
  },
  preview: {
    marginTop: '12px',
    padding: '12px',
    backgroundColor: 'white',
    borderRadius: '4px',
    border: '1px solid #eee',
    maxHeight: '200px',
    overflowY: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '12px',
  },
  th: {
    padding: '6px 8px',
    textAlign: 'left',
    borderBottom: '1px solid #eee',
    backgroundColor: '#f5f5f5',
  },
  td: {
    padding: '4px 8px',
    borderBottom: '1px solid #f0f0f0',
  },
  status: {
    marginTop: '8px',
    fontSize: '14px',
  },
  success: {
    color: '#28a745',
  },
  error: {
    color: '#dc3545',
  },
  info: {
    color: '#17a2b8',
  },
};

export default function CSVUpload({ onImportComplete }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [status, setStatus] = useState(null);
  const [importing, setImporting] = useState(false);
  const { getOwner } = useAuth();
  const owner = getOwner();

  const [addEdgeByName] = useMutation(ADD_EDGE_BY_NAME);
  const [addNode] = useMutation(ADD_NODE);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setStatus(null);

    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data.map(row => ({
          from: row.from?.toString().trim(),
          to: row.to?.toString().trim(),
        })).filter(row => row.from && row.to);
        setPreview(data);
      },
      error: (err) => {
        setStatus({ type: 'error', message: `解析CSV失败: ${err.message}` });
      },
    });
  };

  const handleImport = async () => {
    if (preview.length === 0 || !owner) return;

    setImporting(true);
    setStatus({ type: 'info', message: `正在导入 ${preview.length} 条边...` });

    let successCount = 0;
    let errorCount = 0;

    const uniqueNodes = new Set();
    preview.forEach(row => {
      uniqueNodes.add(row.from);
      uniqueNodes.add(row.to);
    });

    for (const nodeName of uniqueNodes) {
      try {
        await addNode({
          variables: { name: nodeName, owner },
        });
      } catch (err) {
        console.error('创建节点失败:', nodeName, err);
      }
    }

    for (const row of preview) {
      try {
        await addEdgeByName({
          variables: {
            fromName: row.from,
            toName: row.to,
            owner,
            weight: 1.0,
          },
        });
        successCount++;
      } catch (err) {
        errorCount++;
        console.error('导入边失败:', row, err);
      }
    }

    setImporting(false);
    setStatus({
      type: successCount > 0 ? 'success' : 'error',
      message: `导入完成：成功 ${successCount} 条，失败 ${errorCount} 条`,
    });

    if (successCount > 0 && onImportComplete) {
      onImportComplete();
    }

    setFile(null);
    setPreview([]);
  };

  const downloadSample = () => {
    const content = 'from,to\nA,B\nB,C\nC,D\nA,D\nD,E\n';
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_edges.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>📥 批量导入边（CSV）</h3>
      <input
        type="file"
        accept=".csv"
        onChange={handleFileChange}
        style={styles.input}
        disabled={importing}
      />
      <button
        onClick={downloadSample}
        style={styles.button}
        disabled={importing}
      >
        下载示例CSV
      </button>
      {preview.length > 0 && (
        <button
          onClick={handleImport}
          style={importing ? styles.buttonDisabled : { ...styles.button, backgroundColor: '#007bff' }}
          disabled={importing}
        >
          {importing ? '导入中...' : `导入 ${preview.length} 条边`}
        </button>
      )}

      {status && (
        <div style={{ ...styles.status, ...styles[status.type] }}>
          {status.message}
        </div>
      )}

      {preview.length > 0 && (
        <div style={styles.preview}>
          <div style={{ marginBottom: '8px', fontWeight: '500' }}>
            预览（共 {preview.length} 条）：
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>from</th>
                <th style={styles.th}>to</th>
              </tr>
            </thead>
            <tbody>
              {preview.slice(0, 10).map((row, idx) => (
                <tr key={idx}>
                  <td style={styles.td}>{row.from}</td>
                  <td style={styles.td}>{row.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.length > 10 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
              ... 还有 {preview.length - 10} 条
            </div>
          )}
        </div>
      )}
    </div>
  );
}
