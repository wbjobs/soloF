import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import type { NDVIResult } from '../types';
import {
  renderNDVICanvas,
  calculateHistogram,
  type HistogramResult,
} from '../utils/imageProcessing';

interface NDVICanvasProps {
  ndviResult: NDVIResult | null;
  contrast: number;
  enableHistogramEqualization: boolean;
}

const NDVICanvas: React.FC<NDVICanvasProps> = ({
  ndviResult,
  contrast,
  enableHistogramEqualization,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pendingRenderRef = useRef<{
    data: Float32Array;
    width: number;
    height: number;
    histogram: HistogramResult | null;
    contrast: number;
  } | null>(null);

  const histogram = useMemo(() => {
    if (!ndviResult || !enableHistogramEqualization) return null;
    return calculateHistogram(ndviResult.data, 256);
  }, [ndviResult, enableHistogramEqualization]);

  const performRender = useCallback(() => {
    if (!pendingRenderRef.current || !canvasRef.current) return;

    const { data, width, height, histogram: hist, contrast: c } = pendingRenderRef.current;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    renderNDVICanvas(ctx, data, width, height, hist, c);
    pendingRenderRef.current = null;
  }, []);

  useEffect(() => {
    if (!ndviResult || !canvasRef.current) return;

    const canvas = canvasRef.current;
    if (canvas.width !== ndviResult.width || canvas.height !== ndviResult.height) {
      canvas.width = ndviResult.width;
      canvas.height = ndviResult.height;
    }

    pendingRenderRef.current = {
      data: ndviResult.data,
      width: ndviResult.width,
      height: ndviResult.height,
      histogram,
      contrast,
    };

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = requestAnimationFrame(performRender);
  }, [ndviResult, histogram, contrast, performRender]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <div className="canvas-wrapper">
      <h3>NDVI 伪彩色图 {enableHistogramEqualization ? '(直方图均衡化)' : ''}</h3>
      <div className="canvas-container">
        {ndviResult ? (
          <canvas ref={canvasRef} />
        ) : (
          <div className="loading">
            <div className="spinner" />
            <span>等待计算...</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default NDVICanvas;
