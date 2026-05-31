'use client';

import { useState, useEffect, useRef } from 'react';
import * as Tone from 'tone';

interface Note {
  pitch: number;
  start_time: number;
  duration: number;
  velocity: number;
}

interface SimpleInputProps {
  onNotesChange: (notes: Note[]) => void;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OCTAVES = [4, 5, 6];

export default function SimpleInput({ onNotesChange }: SimpleInputProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedDuration, setSelectedDuration] = useState(0.5);
  const synthRef = useRef<Tone.Synth | null>(null);

  useEffect(() => {
    synthRef.current = new Tone.Synth().toDestination();
    return () => {
      synthRef.current?.dispose();
    };
  }, []);

  const playNote = (midi: number) => {
    if (synthRef.current) {
      const freq = Tone.Frequency(midi, 'midi');
      synthRef.current.triggerAttackRelease(freq as any, '8n');
    }
  };

  const addNote = (midi: number) => {
    if (currentTime >= 8) {
      alert('已达到8小节上限！');
      return;
    }

    playNote(midi);
    
    const newNote: Note = {
      pitch: midi,
      start_time: currentTime,
      duration: selectedDuration,
      velocity: 80,
    };

    const newNotes = [...notes, newNote];
    setNotes(newNotes);
    onNotesChange(newNotes);
    setCurrentTime(currentTime + selectedDuration);
  };

  const clearNotes = () => {
    setNotes([]);
    onNotesChange([]);
    setCurrentTime(0);
  };

  const undoNote = () => {
    if (notes.length > 0) {
      const lastNote = notes[notes.length - 1];
      const newNotes = notes.slice(0, -1);
      setNotes(newNotes);
      onNotesChange(newNotes);
      setCurrentTime(lastNote.start_time);
    }
  };

  const isBlackKey = (noteName: string) => noteName.includes('#');

  return (
    <div className="space-y-4">
      <div className="flex gap-2 mb-4">
        {[0.125, 0.25, 0.5, 1].map((dur) => (
          <button
            key={dur}
            onClick={() => setSelectedDuration(dur)}
            className={`px-3 py-1 rounded text-sm font-medium transition-all ${
              selectedDuration === dur
                ? 'bg-purple-500 text-white'
                : 'bg-white/20 text-white/80 hover:bg-white/30'
            }`}
          >
            {dur === 0.125 ? '1/16' : dur === 0.25 ? '1/8' : dur === 0.5 ? '1/4' : '1/2'}
          </button>
        ))}
      </div>

      <div className="relative h-32 bg-white/5 rounded-lg overflow-hidden">
        <div className="absolute inset-0 flex">
          {OCTAVES.map((octave) =>
            NOTE_NAMES.map((noteName, idx) => {
              if (!isBlackKey(noteName)) {
                const midi = octave * 12 + NOTE_NAMES.indexOf(noteName);
                return (
                  <button
                    key={`${noteName}${octave}`}
                    onClick={() => addNote(midi)}
                    className="flex-1 bg-white hover:bg-gray-100 border border-gray-300 rounded-b transition-colors relative z-10"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-gray-600">
                      {noteName}{octave}
                    </span>
                  </button>
                );
              }
              return null;
            })
          )}
        </div>
        
        <div className="absolute top-0 left-0 right-0 h-16 flex pointer-events-none">
          {OCTAVES.map((octave) =>
            NOTE_NAMES.map((noteName, idx) => {
              if (isBlackKey(noteName)) {
                const midi = octave * 12 + NOTE_NAMES.indexOf(noteName);
                const whiteKeysBefore = NOTE_NAMES.slice(0, idx).filter(n => !isBlackKey(n)).length;
                const leftPercent = (octave - 4) * (100 / 3) + (whiteKeysBefore * (100 / 21)) - 1.5;
                
                return (
                  <button
                    key={`${noteName}${octave}`}
                    onClick={() => addNote(midi)}
                    className="absolute w-8 h-full bg-black hover:bg-gray-800 rounded-b z-20 pointer-events-auto transition-colors"
                    style={{ left: `${leftPercent}%` }}
                    onMouseDown={(e) => e.preventDefault()}
                  />
                );
              }
              return null;
            })
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={undoNote}
          disabled={notes.length === 0}
          className="flex-1 py-2 bg-yellow-500 text-white rounded-lg font-medium hover:bg-yellow-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          ↩ 撤销
        </button>
        <button
          onClick={clearNotes}
          className="flex-1 py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-all"
        >
          🗑 清空
        </button>
      </div>

      <div className="text-white/60 text-sm">
        进度: {currentTime.toFixed(2)} / 8 小节
      </div>
    </div>
  );
}
