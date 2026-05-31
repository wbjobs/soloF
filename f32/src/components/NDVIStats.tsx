import React, { useEffect, useRef, useMemo } from 'react';
import type { NDVIResult } from '../types';
import {
  createColorGradientImageData,
  calculateHistogram,
} from '../utils/imageProcessing';

interface NDVIStatsProps {
  ndviResult: NDVIResult | null;
  contrast: number;
  enableHistogramEqualization: boolean;
}

const NDVIStats: React.FC<NDVIStatsProps> = ({
  ndviResult,
  contrast,
  enableHistogramEqualization,
}) => {
  const gradientCanvasRef = useRef<HTMLCanvasElement>(null);
  const histogramCanvasRef = useRef<HTMLCanvasElement>(null);

  const histogram = useMemo(() => {
    if (!ndviResult) return null;
    return calculateHistogram(ndviResult.data, 256);
  }, [ndviResult]);

  useEffect(() => {
    if (!gradientCanvasRef.current || !ndviResult) return;

    const canvas = gradientCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const displayHistogram = enableHistogramEqualization ? histogram : null;
    const imageData = createColorGradientImageData(
      canvas.width,
      canvas.height,
      displayHistogram,
      contrast
    );
    ctx.putImageData(imageData, 0, 0);
  }, [ndviResult, histogram, contrast, enableHistogramEqualization]);

  useEffect(() => {
    if (!histogramCanvasRef.current || !histogram) return;

    const canvas = histogramCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const maxCount = Math.max(...histogram.histogram);
    const barWidth = canvas.width / histogram.histogram.length;

    for (let i = 0; i < histogram.histogram.length; i++) {
      const barHeight = (histogram.histogram[i] / maxCount) * canvas.height;
      const hue = (i / histogram.histogram.length) * 120;
      ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
      ctx.fillRect(
        i * barWidth,
        canvas.height - barHeight,
        Math.max(1, barWidth - 1),
        barHeight
      );
    }
  }, [histogram]);

  if (!ndviResult) return null;

  return (
    <>
      <div className="color-bar">
        <h3>NDVI 色标 {enableHistogramEqualization ? '(直方图均衡化)' : ''}</h3>
        <canvas
          ref={gradientCanvasRef}
          width={512}
          height={30}
          style={{
            width: '100%',
            height: '30px',
            borderRadius: '6px',
          }}
        />
        <div className="color-labels">
          <span>低 (-1.0)</span>
          <span>中 (0.0)</span>
          <span>高 (1.0)</span>
        </div>
      </div>

      {histogram && (
        <div className="color-bar">
          <h3>NDVI 值分布直方图</h3>
          <canvas
            ref={histogramCanvasRef}
            width={512}
            height={100}
            style={{
              width: '100%',
              height: '100px',
              borderRadius: '6px',
            }}
          />
        </div>
      )}

      <div className="stats">
        <h3>NDVI 统计信息</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-label">最小值</div>
            <div className="stat-value">{ndviResult.min.toFixed(4)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">最大值</div>
            <div className="stat-value">{ndviResult.max.toFixed(4)}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">平均值</div>
            <div className="stat-value">{ndviResult.mean.toFixed(4)}</div>
          </div>
        </div>
      </div>
    </>
  );
};

export default NDVIStats;
