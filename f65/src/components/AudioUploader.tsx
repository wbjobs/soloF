import { useRef, useCallback, useState } from 'react';
import { Upload, Music } from 'lucide-react';

interface AudioUploaderProps {
  onFileSelect: (file: File) => void;
  fileName: string;
  isLoaded: boolean;
}

export default function AudioUploader({ onFileSelect, fileName, isLoaded }: AudioUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.includes('audio/mpeg')) {
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleClick = () => {
    inputRef.current?.click();
  };

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        flex items-center gap-3 px-4 py-2 rounded-xl cursor-pointer
        transition-all duration-300 backdrop-blur-md
        ${isDragging
          ? 'bg-cyan-500/30 border-2 border-cyan-400 scale-105'
          : isLoaded
          ? 'bg-emerald-500/20 border border-emerald-400/50'
          : 'bg-white/10 border border-white/20 hover:bg-white/20'
        }
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/mpeg"
        onChange={handleChange}
        className="hidden"
      />
      {isLoaded ? (
        <Music className="w-5 h-5 text-emerald-400" />
      ) : (
        <Upload className="w-5 h-5 text-white/80" />
      )}
      <div className="flex flex-col">
        <span className={`text-sm font-medium ${isLoaded ? 'text-emerald-300' : 'text-white/80'}`}>
          {isLoaded ? '已加载' : '上传MP3'}
        </span>
        {fileName && (
          <span className="text-xs text-white/60 truncate max-w-[150px]">
            {fileName}
          </span>
        )}
      </div>
    </div>
  );
}
