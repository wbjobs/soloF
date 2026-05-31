import React, { useState, useEffect, useCallback } from 'react';
import FileUpload from './components/FileUpload';
import BandCanvas from './components/BandCanvas';
import NDVICanvas from './components/NDVICanvas';
import NDVIStats from './components/NDVIStats';
import type { GeoTIFFData, NDVIResult } from './types';
import { initWasm, calculateNDVI, ndviWorkerService } from './services/ndviService';

const App: React.FC = () => {
  const [geoTiffData, setGeoTiffData] = useState<GeoTIFFData | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [redBandIndex, setRedBandIndex] = useState<number>(0);
  const [nirBandIndex, setNirBandIndex] = useState<number>(1);
  const [ndviResult, setNdviResult] = useState<NDVIResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [calculationProgress, setCalculationProgress] = useState<number>(0);
  const [wasmReady, setWasmReady] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [contrast, setContrast] = useState<number>(0.5);
  const [enableHistogramEqualization, setEnableHistogramEqualization] = useState<boolean>(true);

  useEffect(() => {
    const loadWasm = async () => {
      try {
        await initWasm();
        setWasmReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'WASM 初始化失败');
      }
    };
    loadWasm();

    return () => {
      ndviWorkerService.terminate();
    };
  }, []);

  useEffect(() => {
    ndviWorkerService.setProgressCallback((progress) => {
      setCalculationProgress(progress);
    });

    return () => {
      ndviWorkerService.setProgressCallback(null);
    };
  }, []);

  const handleFileLoaded = useCallback((data: GeoTIFFData, name: string) => {
    setGeoTiffData(data);
    setFileName(name);
    setNdviResult(null);
    setRedBandIndex(0);
    setNirBandIndex(Math.min(1, data.bands.length - 1));
    setIsLoading(false);
  }, []);

  const handleCalculate = useCallback(async () => {
    if (!geoTiffData || !wasmReady) return;

    setIsCalculating(true);
    setCalculationProgress(0);
    setError('');

    try {
      const redBand = geoTiffData.bands[redBandIndex];
      const nirBand = geoTiffData.bands[nirBandIndex];

      const result = await calculateNDVI(
        redBand,
        nirBand,
        geoTiffData.width,
        geoTiffData.height
      );

      setNdviResult(result);
      setCalculationProgress(100);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'NDVI 计算失败');
    } finally {
      setIsCalculating(false);
    }
  }, [geoTiffData, wasmReady, redBandIndex, nirBandIndex]);

  const handleCancel = useCallback(() => {
    ndviWorkerService.terminate();
    setIsCalculating(false);
    setCalculationProgress(0);
    setError('计算已取消');
  }, []);

  return (
    <div className="app">
      <header>
        <h1>🛰️ 卫星遥感 NDVI 分析工具</h1>
        <p>基于 Rust + WASM + Web Worker 的高性能植被指数计算</p>
        {wasmReady ? (
          <p style={{ color: '#4ade80', marginTop: '10px' }}>
            ✅ Web Worker 就绪，支持大分辨率影像处理
          </p>
        ) : (
          <p style={{ color: '#fbbf24', marginTop: '10px' }}>
            🔄 正在初始化 Web Worker...
          </p>
        )}
        {error && (
          <p style={{ color: '#f87171', marginTop: '10px' }}>{error}</p>
        )}
      </header>

      <FileUpload
        onFileLoaded={handleFileLoaded}
        isLoading={isLoading}
      />

      {geoTiffData && (
        <>
          <div className="upload-section">
            <div className="file-info">
              <p><strong>文件名:</strong> {fileName}</p>
              <p><strong>尺寸:</strong> {geoTiffData.width.toLocaleString()} × {geoTiffData.height.toLocaleString()} 像素</p>
              <p><strong>波段数:</strong> {geoTiffData.samples}</p>
              <p><strong>数据量:</strong> {((geoTiffData.width * geoTiffData.height * geoTiffData.samples * 4) / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          </div>

          <div className="upload-section">
            <div className="band-selector">
              <div>
                <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>
                  红波段 (Red)
                </label>
                <select
                  value={redBandIndex}
                  onChange={(e) => setRedBandIndex(Number(e.target.value))}
                  disabled={isCalculating}
                >
                  {geoTiffData.bandNames.map((name, index) => (
                    <option key={index} value={index}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>
                  近红外波段 (NIR)
                </label>
                <select
                  value={nirBandIndex}
                  onChange={(e) => setNirBandIndex(Number(e.target.value))}
                  disabled={isCalculating}
                >
                  {geoTiffData.bandNames.map((name, index) => (
                    <option key={index} value={index}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isCalculating && (
              <div style={{ marginTop: '20px' }}>
                <div style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: '#1e293b',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${calculationProgress}%`,
                    height: '100%',
                    backgroundColor: '#4ade80',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <p style={{
                  textAlign: 'center',
                  color: '#94a3b8',
                  marginTop: '10px',
                  fontSize: '0.9rem',
                }}>
                  正在后台计算 NDVI... {calculationProgress}%
                </p>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button
                className="calculate-btn"
                onClick={handleCalculate}
                disabled={isCalculating || redBandIndex === nirBandIndex || !wasmReady}
                style={{ flex: 1 }}
              >
                {isCalculating ? '计算中...' : '计算 NDVI (WASM + Web Worker)'}
              </button>
              {isCalculating && (
                <button
                  className="calculate-btn"
                  onClick={handleCancel}
                  style={{
                    flex: 'none',
                    padding: '0 30px',
                    background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  }}
                >
                  取消
                </button>
              )}
            </div>
          </div>

          <div className="visualization-section">
            <BandCanvas
              bandData={geoTiffData.bands[redBandIndex]}
              width={geoTiffData.width}
              height={geoTiffData.height}
              title={`红波段 - ${geoTiffData.bandNames[redBandIndex]}`}
            />
            <BandCanvas
              bandData={geoTiffData.bands[nirBandIndex]}
              width={geoTiffData.width}
              height={geoTiffData.height}
              title={`近红外波段 - ${geoTiffData.bandNames[nirBandIndex]}`}
            />
          </div>

          {ndviResult && (
            <div className="upload-section">
              <h3 style={{ marginBottom: '20px', color: '#94a3b8' }}>
                🎨 图像增强控制
              </h3>
              
              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                    fontSize: '0.95rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={enableHistogramEqualization}
                    onChange={(e) => setEnableHistogramEqualization(e.target.checked)}
                    style={{
                      width: '18px',
                      height: '18px',
                      accentColor: '#22c55e',
                    }}
                  />
                  启用直方图均衡化
                </label>
              </div>

              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '10px',
                  }}
                >
                  <label style={{ color: '#cbd5e1', fontSize: '0.95rem' }}>
                    对比度增强强度
                  </label>
                  <span style={{
                    color: '#22c55e',
                    fontWeight: '600',
                    fontFamily: 'monospace',
                  }}>
                    {(contrast * 100).toFixed(0)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={contrast}
                  onChange={(e) => setContrast(parseFloat(e.target.value))}
                  disabled={!enableHistogramEqualization}
                  style={{
                    width: '100%',
                    height: '8px',
                    borderRadius: '4px',
                    background: '#1e293b',
                    cursor: enableHistogramEqualization ? 'pointer' : 'not-allowed',
                    opacity: enableHistogramEqualization ? 1 : 0.5,
                    accentColor: '#22c55e',
                  }}
                />
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: '#64748b',
                  fontSize: '0.8rem',
                  marginTop: '5px',
                }}>
                  <span>原始颜色</span>
                  <span>完全均衡</span>
                </div>
              </div>

              <div style={{
                marginTop: '20px',
                padding: '15px',
                background: '#1e293b',
                borderRadius: '8px',
                fontSize: '0.85rem',
                color: '#94a3b8',
              }}>
                <p>
                  <strong>💡 提示：</strong>直方图均衡化通过重新分布像素值来增强图像对比度。
                  对于植被密集区域，提高对比度可以更清晰地显示植被分布的细微差异。
                </p>
              </div>
            </div>
          )}

          <div className="visualization-section">
            <NDVICanvas
              ndviResult={ndviResult}
              contrast={contrast}
              enableHistogramEqualization={enableHistogramEqualization}
            />
          </div>

          <NDVIStats
            ndviResult={ndviResult}
            contrast={contrast}
            enableHistogramEqualization={enableHistogramEqualization}
          />
        </>
      )}
    </div>
  );
};

export default App;
