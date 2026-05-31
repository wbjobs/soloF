'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface Note {
  pitch: number;
  start_time: number;
  duration: number;
  velocity: number;
}

interface PianoRollProps {
  inputNotes: Note[];
  generatedNotes: Note[];
  onNotesChange: (notes: Note[]) => void;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MIN_PITCH = 36;
const MAX_PITCH = 84;
const TOTAL_BARS = 24;
const PIXELS_PER_BAR = 60;
const PIXELS_PER_NOTE = 16;

export default function PianoRoll({ inputNotes, generatedNotes, onNotesChange }: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [draggingNote, setDraggingNote] = useState<{ index: number; type: string; startX: number; startTime: number; startPitch: number } | null>(null);
  const [resizingNote, setResizingNote] = useState<{ index: number; type: string; startX: number; startDuration: number } | null>(null);
  const [zoom, setZoom] = useState(1);

  const allNotes = [
    ...inputNotes.map(n => ({ ...n, type: 'input' })),
    ...generatedNotes.map(n => ({ ...n, type: 'generated' }))
  ];

  const canvasWidth = TOTAL_BARS * PIXELS_PER_BAR * zoom;
  const canvasHeight = (MAX_PITCH - MIN_PITCH + 1) * PIXELS_PER_NOTE;

  const pitchToY = (pitch: number) => (MAX_PITCH - pitch) * PIXELS_PER_NOTE;
  const timeToX = (time: number) => time * PIXELS_PER_BAR * zoom;
  const xToTime = (x: number) => x / (PIXELS_PER_BAR * zoom);
  const yToPitch = (y: number) => MAX_PITCH - Math.floor(y / PIXELS_PER_NOTE);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    for (let i = 0; i <= MAX_PITCH - MIN_PITCH; i++) {
      const pitch = MIN_PITCH + i;
      const noteName = NOTE_NAMES[pitch % 12];
      const isBlack = noteName.includes('#');
      
      ctx.fillStyle = isBlack ? '#2a2a4e' : '#1f1f3a';
      ctx.fillRect(0, i * PIXELS_PER_NOTE, canvasWidth, PIXELS_PER_NOTE);
      
      if (noteName === 'C') {
        ctx.fillStyle = '#4a4a6e';
        ctx.fillRect(0, i * PIXELS_PER_NOTE, canvasWidth, 1);
      }
    }

    for (let bar = 0; bar <= TOTAL_BARS; bar++) {
      const x = timeToX(bar);
      ctx.strokeStyle = bar % 4 === 0 ? '#4a4a6e' : '#3a3a5e';
      ctx.lineWidth = bar % 4 === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }

    allNotes.forEach((note, index) => {
      const x = timeToX(note.start_time);
      const y = pitchToY(note.pitch);
      const width = timeToX(note.duration);
      const height = PIXELS_PER_NOTE - 2;

      const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
      if (note.type === 'input') {
        gradient.addColorStop(0, '#3b82f6');
        gradient.addColorStop(1, '#1d4ed8');
      } else {
        gradient.addColorStop(0, '#a855f7');
        gradient.addColorStop(1, '#7c3aed');
      }

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, Math.max(width - 2, 10), height, 4);
      ctx.fill();

      ctx.strokeStyle = note.type === 'input' ? '#60a5fa' : '#c084fc';
      ctx.lineWidth = 2;
      ctx.stroke();

      if (width > 30) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = '10px Arial';
        const pitchName = NOTE_NAMES[note.pitch % 12] + Math.floor(note.pitch / 12 - 1);
        ctx.fillText(pitchName, x + 5, y + height / 2 + 3);
      }
    });
  }, [allNotes, canvasWidth, canvasHeight, zoom]);

  useEffect(() => {
    draw();
  }, [draw]);

  const getNoteAtPosition = (x: number, y: number) => {
    for (let i = generatedNotes.length - 1; i >= 0; i--) {
      const note = generatedNotes[i];
      const noteX = timeToX(note.start_time);
      const noteY = pitchToY(note.pitch);
      const noteWidth = timeToX(note.duration);
      const noteHeight = PIXELS_PER_NOTE;

      if (x >= noteX && x <= noteX + noteWidth && y >= noteY && y <= noteY + noteHeight) {
        if (x > noteX + noteWidth - 15) {
          return { index: i, type: 'generated', action: 'resize' };
        }
        return { index: i, type: 'generated', action: 'drag' };
      }
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const noteInfo = getNoteAtPosition(x, y);
    if (noteInfo && noteInfo.type === 'generated') {
      if (noteInfo.action === 'resize') {
        setResizingNote({
          index: noteInfo.index,
          type: noteInfo.type,
          startX: x,
          startDuration: generatedNotes[noteInfo.index].duration
        });
      } else {
        setDraggingNote({
          index: noteInfo.index,
          type: noteInfo.type,
          startX: x,
          startTime: generatedNotes[noteInfo.index].start_time,
          startPitch: generatedNotes[noteInfo.index].pitch
        });
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (draggingNote) {
      const dx = x - draggingNote.startX;
      const newTime = Math.max(0, draggingNote.startTime + xToTime(dx));
      const newPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, yToPitch(y)));

      const newNotes = [...generatedNotes];
      newNotes[draggingNote.index] = {
        ...newNotes[draggingNote.index],
        start_time: newTime,
        pitch: newPitch
      };
      onNotesChange(newNotes);
    }

    if (resizingNote) {
      const dx = x - resizingNote.startX;
      const newDuration = Math.max(0.125, resizingNote.startDuration + xToTime(dx));

      const newNotes = [...generatedNotes];
      newNotes[resizingNote.index] = {
        ...newNotes[resizingNote.index],
        duration: newDuration
      };
      onNotesChange(newNotes);
    }

    canvas.style.cursor = draggingNote || resizingNote ? 'grabbing' : 'default';
  };

  const handleMouseUp = () => {
    setDraggingNote(null);
    setResizingNote(null);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const pitch = yToPitch(y);
    const time = Math.floor(xToTime(x) * 4) / 4;

    const newNote: Note = {
      pitch,
      start_time: time,
      duration: 0.5,
      velocity: 80
    };

    onNotesChange([...generatedNotes, newNote]);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        <span className="text-white text-sm">缩放:</span>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          className="w-32"
        />
        <span className="text-white text-sm">{zoom.toFixed(1)}x</span>
        <span className="text-white/60 text-sm ml-4">双击添加音符，拖拽移动，右侧边缘调整时长</span>
      </div>
      
      <div className="overflow-auto max-h-96">
        <div className="flex">
          <div className="w-12 flex-shrink-0">
            <div
              className="bg-gray-900"
              style={{ height: canvasHeight }}
            >
              {Array.from({ length: MAX_PITCH - MIN_PITCH + 1 }, (_, i) => {
                const pitch = MAX_PITCH - i;
                const noteName = NOTE_NAMES[pitch % 12];
                if (noteName === 'C') {
                  return (
                    <div
                      key={pitch}
                      className="text-xs text-gray-400 text-right pr-2"
                      style={{ height: PIXELS_PER_NOTE, lineHeight: `${PIXELS_PER_NOTE}px` }}
                    >
                      {noteName}{Math.floor(pitch / 12 - 1)}
                    </div>
                  );
                }
                return <div key={pitch} style={{ height: PIXELS_PER_NOTE }} />;
              })}
            </div>
          </div>
          
          <div className="overflow-x-auto flex-1">
            <canvas
              ref={canvasRef}
              width={canvasWidth}
              height={canvasHeight}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onDoubleClick={handleDoubleClick}
              className="cursor-crosshair"
            />
          </div>
        </div>
        
        <div className="flex pl-12">
          {Array.from({ length: TOTAL_BARS + 1 }, (_, i) => (
            <div
              key={i}
              className="text-xs text-gray-500 text-center"
              style={{ width: PIXELS_PER_BAR * zoom }}
            >
              {i % 4 === 0 ? i : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
