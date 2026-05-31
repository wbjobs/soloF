import { useMemo } from 'react';
import { FrequencyData } from '@/utils/audioUtils';

interface SpectrumVisualizerProps {
  frequencyData: FrequencyData;
}

export default function SpectrumVisualizer({ frequencyData }: SpectrumVisualizerProps) {
  const bars = useMemo(() => [
    { label: 'BASS', value: frequencyData.bass, color: 'from-red-500 to-orange-500' },
    { label: 'LOWS', value: frequencyData.lows, color: 'from-orange-500 to-yellow-500' },
    { label: 'MIDS', value: frequencyData.mids, color: 'from-green-500 to-emerald-500' },
    { label: 'HIGHS', value: frequencyData.highs, color: 'from-cyan-500 to-blue-500' },
    { label: 'TREBLE', value: frequencyData.treble, color: 'from-purple-500 to-pink-500' },
  ], [frequencyData]);

  return (
    <div className="flex items-end gap-1.5 h-16 px-2">
      {bars.map((bar) => (
        <div key={bar.label} className="flex flex-col items-center gap-1">
          <div className="relative w-6 h-12 bg-white/10 rounded-sm overflow-hidden">
            <div
              className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t ${bar.color} transition-all duration-100 rounded-sm`}
              style={{ height: `${Math.min(100, bar.value * 100)}%` }}
            />
            <div
              className={`absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r ${bar.color} opacity-80 blur-sm`}
              style={{ bottom: `${Math.min(100, bar.value * 100)}%` }}
            />
          </div>
          <span className="text-[9px] font-bold text-white/40 tracking-wider">
            {bar.label}
          </span>
        </div>
      ))}
    </div>
  );
}
