'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface Note {
  pitch: number;
  start_time: number;
  duration: number;
  velocity: number;
  channel?: number;
}

interface MultiTrackPianoRollProps {
  tracks: Record<string, Note[]>;
  trackColors: Record<string, string>;
  trackNames: Record<string, string>;
  activeTrack: string;
  onTrackSelect: (track: string) => void;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MIN_PITCH = 36;
const MAX_PITCH = 84;
const TOTAL_BARS = 16;

export default function MultiTrackPianoRoll({
  tracks,
  trackColors,
  trackNames,
  activeTrack,
  onTrackSelect
}: MultiTrackPianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [scrollY, setScrollY] = useState(0);
  const [showTracks, setShowTracks] = useState<Record<string, boolean>>({});
  const [hoveredNote, setHoveredNote] = useState<{ track: string; note: Note } | null>(null);

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    Object.keys(tracks).forEach(track => {
      initial[track] = true;
    });
    setShowTracks(initial);
  }, [Object.keys(tracks).join(',')]);

  const canvasWidth = TOTAL_BARS * 60 * zoom;
  const canvasHeight = (MAX_PITCH - MIN_PITCH + 1) * 14;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    for (let i = 0; i <= MAX_PITCH - MIN_PITCH; i++) {
      const pitch = MIN_PITCH + i;
      const noteName = NOTE_NAMES[pitch % 12];
      const isBlack = noteName.includes('#');
      const isC = noteName === 'C';

      ctx.fillStyle = isBlack ? '#1a1a2e' : '#151525';
      ctx.fillRect(0, i * 14, canvasWidth, 14);

      if (isC) {
        ctx.strokeStyle = '#3a3a5e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, i * 14);
        ctx.lineTo(canvasWidth, i * 14);
        ctx.stroke();
      }
    }

    for (let bar = 0; bar <= TOTAL_BARS; bar++) {
      const x = (bar / TOTAL_BARS) * canvasWidth;
      ctx.strokeStyle = bar % 4 === 0 ? '#4a4a6e' : '#2a2a3e';
      ctx.lineWidth = bar % 4 === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }

    Object.entries(tracks).forEach(([trackName, notes]) => {
      if (!showTracks[trackName]) return;

      const color = trackColors[trackName];
      const isActive = trackName === activeTrack;

      notes.forEach((note, idx) => {
        const x = (note.start_time / TOTAL_BARS) * canvasWidth;
        const y = (MAX_PITCH - note.pitch) * 14;
        const width = Math.max((note.duration / TOTAL_BARS) * canvasWidth, 4);
        const height = 12;

        const alpha = isActive ? note.velocity / 127 : note.velocity / 255;

        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, width - 2, height, 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        if (isActive && width > 30) {
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.font = '8px Arial';
          ctx.fillText(NOTE_NAMES[note.pitch % 12], x + 4, y + 10);
        }
      });
    });
  }, [tracks, trackColors, activeTrack, showTracks, canvasWidth, canvasHeight]);

  useEffect(() => {
    draw();
  }, [draw]);

  const toggleTrack = (track: string) => {
    setShowTracks(prev => ({
      ...prev,
      [track]: !prev[track]
    }));
  };

  const getNoteAtPosition = (x: number, y: number) => {
    for (const [trackName, notes] of Object.entries(tracks)) {
      if (!showTracks[trackName]) continue;

      for (const note of notes) {
        const noteX = (note.start_time / TOTAL_BARS) * canvasWidth;
        const noteY = (MAX_PITCH - note.pitch) * 14;
        const noteWidth = Math.max((note.duration / TOTAL_BARS) * canvasWidth, 4);

        if (x >= noteX && x <= noteX + noteWidth &&
            y >= noteY && y <= noteY + 14) {
          return { track: trackName, note };
        }
      }
    }
    return null;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const noteAtPos = getNoteAtPosition(x, y);
    setHoveredNote(noteAtPos);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const noteAtPos = getNoteAtPosition(x, y);
    if (noteAtPos) {
      onTrackSelect(noteAtPos.track);
    }
  };

  return (
    <div className="bg-gray-900/80 backdrop-blur-lg rounded-xl p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <span className="text-2xl">🎼</span> 多轨道编辑
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">缩放:</span>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="w-24"
            />
            <span className="text-sm text-gray-400">{zoom.toFixed(1)}x</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {Object.entries(trackNames).map(([track, name]) => (
          <button
            key={track}
            onClick={() => toggleTrack(track)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
              showTracks[track]
                ? activeTrack === track
                  ? 'text-white ring-2 ring-white/50'
                  : 'text-white/80 hover:text-white'
                : 'bg-gray-700 text-gray-500 opacity-50'
            }`}
            style={{
              backgroundColor: showTracks[track] ? trackColors[track] : undefined
            }}
          >
            {track === 'piano' && '🎹'}
            {track === 'guitar' && '🎸'}
            {track === 'bass' && '🎸'}
            {track === 'drums' && '🥁'}
            <span>{name}</span>
            <span className="text-xs opacity-70">
              ({tracks[track]?.length || 0})
            </span>
          </button>
        ))}
      </div>

      <div className="flex">
        <div
          className="w-12 flex-shrink-0 bg-gray-900 rounded-l-lg overflow-hidden border-r border-gray-700"
          style={{ height: Math.min(400, canvasHeight) }}
        >
          <div
            style={{
              height: canvasHeight,
              transform: `translateY(-${scrollY}px)`
            }}
          >
            {Array.from({ length: MAX_PITCH - MIN_PITCH + 1 }, (_, i) => {
              const pitch = MAX_PITCH - i;
              const noteName = NOTE_NAMES[pitch % 12];
              const octave = Math.floor(pitch / 12) - 1;
              if (noteName === 'C') {
                return (
                  <div
                    key={pitch}
                    className="text-xs text-gray-500 text-right pr-1 font-mono"
                    style={{ height: 14 * 12, lineHeight: '14px' }}
                  >
                    {noteName}{octave}
                  </div>
                );
              }
              return <div key={pitch} style={{ height: 14 }} />;
            })}
          </div>
        </div>

        <div
          ref={containerRef}
          className="flex-1 overflow-auto rounded-r-lg border border-gray-700 max-h-96"
          onScroll={(e) => setScrollY(e.currentTarget.scrollTop)}
        >
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            onClick={handleCanvasClick}
            onMouseMove={handleMouseMove}
            className="cursor-crosshair"
          />
        </div>
      </div>

      <div className="flex mt-1">
        <div className="w-12 flex-shrink-0" />
        <div
          className="flex"
          style={{ width: Math.min(canvasWidth, 800) }}
        >
          {Array.from({ length: TOTAL_BARS + 1 }, (_, i) => (
            <div
              key={i}
              className="text-xs text-gray-600 text-center"
              style={{ width: `${100 / (TOTAL_BARS / zoom)}%` }}
            >
              {i % 4 === 0 ? i : ''}
            </div>
          ))}
        </div>
      </div>

      {hoveredNote && (
        <div className="mt-3 p-3 bg-gray-800 rounded-lg">
          <div className="flex items-center gap-2">
            <span
              className="w-4 h-4 rounded"
              style={{ backgroundColor: trackColors[hoveredNote.track] }}
            />
            <span className="text-white font-medium">
              {trackNames[hoveredNote.track]}
            </span>
            <span className="text-gray-400">
              - {NOTE_NAMES[hoveredNote.note.pitch % 12]}{Math.floor(hoveredNote.note.pitch / 12) - 1}
            </span>
            <span className="text-gray-500 text-sm">
              | 时间: {hoveredNote.note.start_time.toFixed(2)} | 时长: {hoveredNote.note.duration.toFixed(2)} | 力度: {hoveredNote.note.velocity}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
