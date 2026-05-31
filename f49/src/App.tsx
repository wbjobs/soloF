import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { AgGridReact, ColDef, ITooltipParams } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import './App.css';

interface ColumnStats {
  column_name: string;
  null_count: number | null;
  distinct_count: number | null;
  max_value: string | null;
  min_value: string | null;
  data_type: string;
}

interface ParquetData {
  columns: string[];
  rows: any[][];
  row_count: number;
  column_count: number;
  warnings: string[];
  column_stats: ColumnStats[];
}

const App: React.FC = () => {
  const [data, setData] = useState<ParquetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasmReady, setWasmReady] = useState(false);
  const wasmModule = useRef<any>(null);

  useEffect(() => {
    const initWasm = async () => {
      try {
        const wasm = await import('./wasm/parquet_wasm');
        await wasm.default();
        wasm.init_panic_hook();
        wasmModule.current = wasm;
        setWasmReady(true);
      } catch (e) {
        console.error('Failed to load WASM:', e);
        setError('WASM 模块加载失败，请先运行 npm run build-wasm 编译 Rust 代码');
      }
    };
    initWasm();
  }, []);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      const resultJson = wasmModule.current.parse_parquet(uint8Array);
      const result: ParquetData = JSON.parse(resultJson);
      
      setData(result);
    } catch (e) {
      console.error('Failed to parse parquet:', e);
      setError(e instanceof Error ? e.message : '解析 Parquet 文件失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const columnDefs: ColDef[] = useMemo(() => {
    if (!data) return [];
    
    const statsMap = new Map<string, ColumnStats>();
    data.column_stats.forEach(stats => {
      statsMap.set(stats.column_name, stats);
    });
    
    return data.columns.map(col => {
      const stats = statsMap.get(col);
      
      return {
        headerName: col,
        field: col,
        filter: true,
        sortable: true,
        resizable: true,
        minWidth: 120,
        headerTooltip: col,
        tooltipValueGetter: (params: ITooltipParams) => {
          if (stats) {
            return null;
          }
          return undefined;
        },
        headerComponentParams: {
          stats,
        },
      };
    });
  }, [data]);

  const rowData = data?.rows.map(row => {
    const obj: Record<string, any> = {};
    data.columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj;
  }) || [];

  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);

  const ColumnStatTooltip = ({ stats }: { stats: ColumnStats }) => (
    <div className="stat-tooltip">
      <h4>{stats.column_name}</h4>
      <div className="stat-item">
        <span className="stat-label">数据类型:</span>
        <span className="stat-value">{stats.data_type}</span>
      </div>
      {stats.null_count !== null && (
        <div className="stat-item">
          <span className="stat-label">空值数量:</span>
          <span className="stat-value">{stats.null_count}</span>
        </div>
      )}
      {stats.distinct_count !== null && (
        <div className="stat-item">
          <span className="stat-label">去重计数:</span>
          <span className="stat-value">{stats.distinct_count}</span>
        </div>
      )}
      {stats.min_value !== null && (
        <div className="stat-item">
          <span className="stat-label">最小值:</span>
          <span className="stat-value">{stats.min_value}</span>
        </div>
      )}
      {stats.max_value !== null && (
        <div className="stat-item">
          <span className="stat-label">最大值:</span>
          <span className="stat-value">{stats.max_value}</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Parquet 文件查看器</h1>
        <p className="subtitle">基于 Rust + WebAssembly + React + AG-Grid</p>
      </header>

      <div className="file-upload-section">
        <label className="file-upload-label">
          <input
            type="file"
            accept=".parquet"
            onChange={handleFileSelect}
            disabled={!wasmReady || loading}
            className="file-input"
          />
          <span className="file-upload-button">
            {loading ? '解析中...' : '选择 Parquet 文件'}
          </span>
        </label>
        
        {!wasmReady && (
          <div className="status-message info">
            正在加载 WASM 模块...
          </div>
        )}
      </div>

      {error && (
        <div className="status-message error">
          {error}
        </div>
      )}

      {data && data.warnings && data.warnings.length > 0 && (
        <div className="status-message warning">
          <strong>⚠️ 警告:</strong>
          <ul>
            {data.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {data && (
        <div className="data-info">
          <span>总行数: {data.row_count}</span>
          <span>总列数: {data.column_count}</span>
        </div>
      )}

      {data && data.column_stats && data.column_stats.length > 0 && (
        <div className="columns-overview">
          <h3>📋 列数据概览 (鼠标悬停查看详情)</h3>
          <div className="columns-list">
            {data.column_stats.map((stats, index) => (
              <div
                key={index}
                className="column-badge"
                onMouseEnter={() => setHoveredColumn(stats.column_name)}
                onMouseLeave={() => setHoveredColumn(null)}
              >
                <span className="column-name">{stats.column_name}</span>
                <span className="column-type">{stats.data_type}</span>
                {hoveredColumn === stats.column_name && (
                  <ColumnStatTooltip stats={stats} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ag-theme-alpine grid-container">
        {data ? (
          <AgGridReact
            columnDefs={columnDefs}
            rowData={rowData}
            pagination={true}
            paginationPageSize={100}
            enableRangeSelection={true}
            domLayout="autoHeight"
            defaultColDef={{
              flex: 1,
              minWidth: 100,
            }}
          />
        ) : (
          <div className="empty-state">
            {!loading && (
              <>
                <div className="empty-icon">📊</div>
                <p>选择一个 .parquet 文件开始查看</p>
              </>
            )}
          </div>
        )}
      </div>

      <footer className="app-footer">
        <p>支持的数据类型: Int8/16/32/64, UInt8/16/32/64, Float32/64, String, Boolean, Struct(扁平化), List(JSON数组)</p>
      </footer>
    </div>
  );
};

export default App;
