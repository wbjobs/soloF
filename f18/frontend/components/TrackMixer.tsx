'use client';

import { useState, useEffect } from 'react';

interface TrackState {
  volume: number;
  muted: boolean;
  solo: boolean;
}

interface TrackMixerProps {
  tracks: string[];
  trackColors: Record<string, string>;
  trackNames: Record<string, string>;
  trackNotes: Record<string, any[]>;
  onTrackChange: (track: string, state: Partial<TrackState>) => void;
  onExport: () => void;
}

export default function TrackMixer({
  tracks,
  trackColors,
  trackNames,
  trackNotes,
  onTrackChange,
  onExport
}: TrackMixerProps) {
  const [trackStates, setTrackStates] = useState<Record<string, TrackState>>({});

  useEffect(() => {
    const initialStates: Record<string, TrackState> = {};
    tracks.forEach(track => {
      initialStates[track] = {
        volume: 100,
        muted: false,
        solo: false
      };
    });
    setTrackStates(initialStates);
  }, [tracks]);

  const handleVolumeChange = (track: string, volume: number) => {
    const newState = { ...trackStates[track], volume };
    setTrackStates({ ...trackStates, [track]: newState });
    onTrackChange(track, newState);
  };

  const toggleMute = (track: string) => {
    const newState = { ...trackStates[track], muted: !trackStates[track].muted };
    setTrackStates({ ...trackStates, [track]: newState });
    onTrackChange(track, newState);
  };

  const toggleSolo = (track: string) => {
    const newState = { ...trackStates[track], solo: !trackStates[track].solo };
    setTrackStates({ ...trackStates, [track]: newState });
    onTrackChange(track, newState);
  };

  const getNoteCount = (track: string) => {
    return trackNotes[track]?.length || 0;
  };

  return (
    <div className="bg-gray-900/80 backdrop-blur-lg rounded-xl p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <span className="text-2xl">🎛️</span> 音轨混音器
        </h3>
        <button
          onClick={onExport}
          className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg font-medium hover:from-purple-600 hover:to-pink-600 transition-all"
        >
          📥 导出混音
        </button>
      </div>

      <div className="space-y-3">
        {tracks.map((track) => (
          <div
            key={track}
            className={`p-3 rounded-lg border transition-all ${
              trackStates[track]?.muted
                ? 'bg-gray-800/50 border-gray-600 opacity-60'
                : 'bg-gray-800/80 border-gray-600 hover:border-gray-500'
            }`}
            style={{
              borderLeftColor: trackColors[track],
              borderLeftWidth: '4px'
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-xl"
                  style={{ backgroundColor: trackColors[track] }}
                >
                  {track === 'piano' && '🎹'}
                  {track === 'guitar' && '🎸'}
                  {track === 'bass' && '🎸'}
                  {track === 'drums' && '🥁'}
                </div>
                <div>
                  <div className="font-medium text-white">{trackNames[track]}</div>
                  <div className="text-xs text-gray-400">
                    {getNoteCount(track)} 个音符
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleSolo(track)}
                  className={`w-8 h-8 rounded text-xs font-bold transition-all ${
                    trackStates[track]?.solo
                      ? 'bg-yellow-500 text-black'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                  title="独奏"
                >
                  S
                </button>
                <button
                  onClick={() => toggleMute(track)}
                  className={`w-8 h-8 rounded text-xs font-bold transition-all ${
                    trackStates[track]?.muted
                      ? 'bg-red-500 text-white'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                  title="静音"
                >
                  M
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-8">🔊</span>
              <input
                type="range"
                min="0"
                max="127"
                value={trackStates[track]?.volume || 100}
                onChange={(e) => handleVolumeChange(track, parseInt(e.target.value))}
                className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, ${trackColors[track]} ${(trackStates[track]?.volume || 100) / 1.27}%, #374151 ${(trackStates[track]?.volume || 100) / 1.27}%)`
                }}
              />
              <span className="text-xs text-gray-400 w-10 text-right">
                {trackStates[track]?.volume || 100}
              </span>
            </div>

            <div className="mt-2 h-8 bg-gray-900 rounded overflow-hidden relative">
              {trackNotes[track]?.slice(0, 50).map((note: any, idx: number) => (
                <div
                  key={idx}
                  className="absolute h-6 rounded-sm"
                  style={{
                    left: `${(note.start_time / 16) * 100}%`,
                    width: `${Math.min((note.duration / 4) * 100, 20)}%`,
                    top: '4px',
                    backgroundColor: trackColors[track],
                    opacity: note.velocity / 127
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-700">
        <div className="flex items-center justify-between text-sm">
          <div className="text-gray-400">
            总音符数: {Object.values(trackNotes).flat().length}
          </div>
          <div className="text-gray-400">
            活跃音轨: {tracks.filter(t => !trackStates[t]?.muted).length} / {tracks.length}
          </div>
        </div>
      </div>
    </div>
  );
}
