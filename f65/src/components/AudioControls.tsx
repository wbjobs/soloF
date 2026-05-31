import { useCallback, useMemo } from 'react';
import { Play, Pause, Volume2, VolumeX, SkipBack } from 'lucide-react';

interface AudioControlsProps {
  isPlaying: boolean;
  isLoaded: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number) => void;
}

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export default function AudioControls({
  isPlaying,
  isLoaded,
  currentTime,
  duration,
  volume,
  onTogglePlay,
  onSeek,
  onVolumeChange,
}: AudioControlsProps) {
  const progress = useMemo(() => {
    if (duration === 0) return 0;
    return (currentTime / duration) * 100;
  }, [currentTime, duration]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isLoaded || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    onSeek(percentage * duration);
  }, [isLoaded, duration, onSeek]);

  const handleVolumeClick = useCallback(() => {
    onVolumeChange(volume > 0 ? 0 : 0.7);
  }, [volume, onVolumeChange]);

  const handleVolumeSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onVolumeChange(parseFloat(e.target.value));
  }, [onVolumeChange]);

  const handleRestart = useCallback(() => {
    onSeek(0);
  }, [onSeek]);

  return (
    <div className="flex flex-col gap-3 w-full max-w-2xl">
      <div
        onClick={handleProgressClick}
        className="relative h-1.5 bg-white/20 rounded-full cursor-pointer group"
      >
        <div
          className="absolute left-0 top-0 h-full bg-gradient-to-r from-cyan-400 to-purple-500 rounded-full transition-all duration-75"
          style={{ width: `${progress}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
          style={{ left: `calc(${progress}% - 6px)` }}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={handleRestart}
            disabled={!isLoaded}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <SkipBack className="w-4 h-4 text-white" />
          </button>

          <button
            onClick={onTogglePlay}
            disabled={!isLoaded}
            className="p-3 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-400 hover:to-purple-400 transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-lg hover:shadow-cyan-500/25 hover:scale-105"
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 text-white" />
            ) : (
              <Play className="w-5 h-5 text-white ml-0.5" />
            )}
          </button>

          <span className="text-xs text-white/60 font-mono min-w-[100px]">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleVolumeClick}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            {volume > 0 ? (
              <Volume2 className="w-4 h-4 text-white/80" />
            ) : (
              <VolumeX className="w-4 h-4 text-white/50" />
            )}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={handleVolumeSlider}
            className="w-20 h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md"
          />
        </div>
      </div>
    </div>
  );
}
