import React, { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';

interface FPSCounterProps {
  onFPSUpdate?: (fps: number) => void;
}

export const FPSCounter: React.FC<FPSCounterProps> = ({ onFPSUpdate }) => {
  const [fps, setFps] = useState(60);
  const [frameCount, setFrameCount] = useState(0);
  const [lastTime, setLastTime] = useState(performance.now());

  useEffect(() => {
    let animationId: number;

    const updateFPS = () => {
      setFrameCount((prev) => prev + 1);
      animationId = requestAnimationFrame(updateFPS);
    };

    animationId = requestAnimationFrame(updateFPS);

    return () => cancelAnimationFrame(animationId);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const currentTime = performance.now();
      const elapsed = currentTime - lastTime;
      const currentFps = Math.round((frameCount * 1000) / elapsed);
      
      setFps(currentFps);
      onFPSUpdate?.(currentFps);
      setFrameCount(0);
      setLastTime(currentTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [frameCount, lastTime, onFPSUpdate]);

  const getColor = () => {
    if (fps >= 50) return 'text-green-400';
    if (fps >= 30) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="flex items-center gap-2 bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded-lg">
      <Activity className={`w-4 h-4 ${getColor()}`} />
      <span className={`font-mono text-sm ${getColor()}`}>
        {fps} FPS
      </span>
    </div>
  );
};
