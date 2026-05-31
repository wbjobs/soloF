import React, { useEffect, useRef } from 'react';
import { normalizeBand } from '../services/geotiffService';

interface BandCanvasProps {
  bandData: Float32Array | null;
  width: number;
  height: number;
  title: string;
}

const BandCanvas: React.FC<BandCanvasProps> = ({ bandData, width, height, title }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!bandData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.createImageData(width, height);
    const normalized = normalizeBand(bandData);

    for (let i = 0; i < normalized.length; i++) {
      const value = normalized[i];
      const pixelIndex = i * 4;
      imageData.data[pixelIndex] = value;
      imageData.data[pixelIndex + 1] = value;
      imageData.data[pixelIndex + 2] = value;
      imageData.data[pixelIndex + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
  }, [bandData, width, height]);

  return (
    <div className="canvas-wrapper">
      <h3>{title}</h3>
      <div className="canvas-container">
        {bandData ? (
          <canvas ref={canvasRef} />
        ) : (
          <div className="loading">
            <div className="spinner" />
            <span>等待数据...</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default BandCanvas;
