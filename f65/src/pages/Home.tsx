import { useCallback, useState } from 'react';
import ParticleSystem from '@/components/ParticleSystem';
import AudioUploader from '@/components/AudioUploader';
import AudioControls from '@/components/AudioControls';
import SpectrumVisualizer from '@/components/SpectrumVisualizer';
import { useAudioAnalyzer } from '@/hooks/useAudioAnalyzer';
import { Music2, Gauge } from 'lucide-react';

export default function Home() {
  const {
    audioState,
    frequencyData,
    handleFileUpload,
    togglePlay,
    seek,
    setVolume,
  } = useAudioAnalyzer();

  const [sensitivity, setSensitivity] = useState(1.5);

  const handleFileSelect = useCallback((file: File) => {
    handleFileUpload(file);
  }, [handleFileUpload]);

  const handleSensitivityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSensitivity(parseFloat(e.target.value));
  }, []);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      <ParticleSystem frequencyData={frequencyData} sensitivity={sensitivity} />
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
          <div className="flex items-center gap-3">
            <Music2 className="w-8 h-8 text-cyan-400" />
            <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent tracking-wider">
              Audio Particle Visualizer
            </h1>
          </div>
          <p className="text-white/40 text-sm">
            拖拽或点击上传MP3，感受音乐的视觉之美
          </p>
        </div>

        <div className="absolute top-8 right-8 pointer-events-auto">
          <SpectrumVisualizer frequencyData={frequencyData} />
        </div>

        <div className="absolute top-8 left-8 pointer-events-auto">
          <AudioUploader
            onFileSelect={handleFileSelect}
            fileName={audioState.fileName}
            isLoaded={audioState.isLoaded}
          />
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-3xl px-8 pointer-events-auto">
          <div className="bg-black/40 backdrop-blur-xl rounded-2xl p-6 border border-white/10 shadow-2xl">
            <AudioControls
              isPlaying={audioState.isPlaying}
              isLoaded={audioState.isLoaded}
              currentTime={audioState.currentTime}
              duration={audioState.duration}
              volume={audioState.volume}
              onTogglePlay={togglePlay}
              onSeek={seek}
              onVolumeChange={setVolume}
            />

            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex items-center justify-between gap-6">
                <div className="flex items-center gap-3 flex-1">
                  <Gauge className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                  <span className="text-xs text-white/60 whitespace-nowrap">敏感度</span>
                  <input
                    type="range"
                    min="0.2"
                    max="3"
                    step="0.1"
                    value={sensitivity}
                    onChange={handleSensitivityChange}
                    className="flex-1 h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-gradient-to-r [&::-webkit-slider-thumb]:from-cyan-400 [&::-webkit-slider-thumb]:to-purple-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-pointer"
                  />
                  <span className="text-xs font-mono text-cyan-400 w-8 text-right">
                    {sensitivity.toFixed(1)}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex justify-between text-xs text-white/40">
                <span>💡 拖拽旋转视角 | 滚轮缩放</span>
                <span>低频 → 粒子大小 | 高频 → 粒子颜色</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
