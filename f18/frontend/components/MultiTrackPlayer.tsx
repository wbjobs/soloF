'use client';

import { useState, useEffect, useRef } from 'react';
import * as Tone from 'tone';

interface Note {
  pitch: number;
  start_time: number;
  duration: number;
  velocity: number;
}

interface MultiTrackPlayerProps {
  tracks: Record<string, Note[]>;
  trackVolumes: Record<string, number>;
  mutedTracks: string[];
  isPlaying: boolean;
  onPlayStateChange: (playing: boolean) => void;
}

const INSTRUMENT_PRESETS: Record<string, any> = {
  piano: {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 1 }
  },
  guitar: {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.2, release: 0.8 }
  },
  bass: {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 0.5 }
  },
  drums: {
    oscillator: { type: 'square' },
    envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 }
  }
};

export default function MultiTrackPlayer({
  tracks,
  trackVolumes,
  mutedTracks,
  isPlaying,
  onPlayStateChange
}: MultiTrackPlayerProps) {
  const synthesizersRef = useRef<Record<string, Tone.PolySynth>>({});
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const animationRef = useRef<number>();
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    const synths: Record<string, Tone.PolySynth> = {};

    Object.keys(tracks).forEach(trackName => {
      const preset = INSTRUMENT_PRESETS[trackName] || INSTRUMENT_PRESETS.piano;
      synths[trackName] = new Tone.PolySynth(Tone.Synth, preset).toDestination();
    });

    synthesizersRef.current = synths;

    return () => {
      Object.values(synthesizersRef.current).forEach(synth => synth.dispose());
    };
  }, []);

  useEffect(() => {
    Object.entries(trackVolumes).forEach(([trackName, volume]) => {
      const synth = synthesizersRef.current[trackName];
      if (synth) {
        const normalizedVol = (volume / 127) * 2 - 1;
        synth.volume.value = normalizedVol * 30;
      }
    });
  }, [trackVolumes]);

  useEffect(() => {
    let maxTime = 0;
    Object.values(tracks).forEach(notes => {
      notes.forEach(note => {
        const endTime = note.start_time + note.duration;
        if (endTime > maxTime) maxTime = endTime;
      });
    });
    setDuration(maxTime);
  }, [tracks]);

  useEffect(() => {
    if (isPlaying) {
      playAllTracks();
    } else {
      stopAllTracks();
    }
  }, [isPlaying]);

  const playAllTracks = async () => {
    await Tone.start();
    startTimeRef.current = Tone.now();

    Object.entries(tracks).forEach(([trackName, notes]) => {
      if (mutedTracks.includes(trackName)) return;

      const synth = synthesizersRef.current[trackName];
      if (!synth) return;

      notes.forEach(note => {
        const midiNote = Tone.Frequency(note.pitch, 'midi') as unknown as string;
        const velocity = note.velocity / 127;
        const startTime = note.start_time;
        const duration = note.duration * 0.8;

        synth.triggerAttackRelease(midiNote, duration, startTime, velocity);
      });
    });

    const updateTime = () => {
      const elapsed = Tone.now() - startTimeRef.current;
      setCurrentTime(elapsed);

      if (elapsed < duration) {
        animationRef.current = requestAnimationFrame(updateTime);
      } else {
        onPlayStateChange(false);
      }
    };

    animationRef.current = requestAnimationFrame(updateTime);
  };

  const stopAllTracks = () => {
    Object.values(synthesizersRef.current).forEach(synth => {
      synth.releaseAll();
    });
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    setCurrentTime(0);
  };

  const formatTime = (time: number) => {
    const bars = Math.floor(time / 4);
    const beats = Math.floor((time % 4));
    return `${bars}:${beats.toString().padStart(2, '0')}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="bg-gray-900/80 backdrop-blur-lg rounded-xl p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <span className="text-2xl">🎵</span> 多轨道播放器
        </h3>

        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-400">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>
      </div>

      <div className="h-2 bg-gray-700 rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-100"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="grid grid-cols-4 gap-3">
        {Object.keys(tracks).map(trackName => {
          const isMuted = mutedTracks.includes(trackName);
          const isActive = isPlaying && !isMuted;

          return (
            <div
              key={trackName}
              className={`p-3 rounded-lg border transition-all ${
                isActive
                  ? 'bg-gray-800 border-purple-500'
                  : isMuted
                    ? 'bg-gray-800/50 border-gray-600 opacity-50'
                    : 'bg-gray-800/80 border-gray-600'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-medium text-sm">
                  {trackName === 'piano' && '🎹 钢琴'}
                  {trackName === 'guitar' && '🎸 吉他'}
                  {trackName === 'bass' && '🎸 贝斯'}
                  {trackName === 'drums' && '🥁 鼓'}
                </span>
                {isActive && (
                  <div className="flex gap-0.5">
                    {[0, 1, 2, 3, 4].map(i => (
                      <div
                        key={i}
                        className="w-1 bg-purple-400 rounded-full animate-pulse"
                        style={{
                          height: `${8 + Math.random() * 8}px`,
                          animationDelay: `${i * 0.1}s`
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="h-8 bg-gray-900 rounded overflow-hidden relative">
                {tracks[trackName]?.slice(0, 100).map((note, idx) => (
                  <div
                    key={idx}
                    className="absolute h-4 rounded-sm"
                    style={{
                      left: `${(note.start_time / Math.max(duration, 1)) * 100}%`,
                      width: `${Math.max((note.duration / Math.max(duration, 1)) * 100, 1)}%`,
                      top: '8px',
                      backgroundColor: isMuted ? '#4b5563' :
                        trackName === 'piano' ? '#3b82f6' :
                        trackName === 'guitar' ? '#10b981' :
                        trackName === 'bass' ? '#f59e0b' :
                        '#ef4444',
                      opacity: note.velocity / 127
                    }}
                  />
                ))}
              </div>

              <div className="mt-2 text-xs text-gray-500">
                {tracks[trackName]?.length || 0} 个音符
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
