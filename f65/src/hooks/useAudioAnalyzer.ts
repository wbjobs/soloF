import { useRef, useState, useCallback, useEffect } from 'react';
import { extractFrequencyBands, FrequencyData } from '@/utils/audioUtils';

export interface AudioState {
  isPlaying: boolean;
  isLoaded: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  fileName: string;
}

export const useAudioAnalyzer = () => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const frequencyDataRef = useRef<Uint8Array | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);

  const [audioState, setAudioState] = useState<AudioState>({
    isPlaying: false,
    isLoaded: false,
    currentTime: 0,
    duration: 0,
    volume: 0.7,
    fileName: '',
  });

  const [frequencyData, setFrequencyData] = useState<FrequencyData>({
    lows: 0,
    mids: 0,
    highs: 0,
    average: 0,
    bass: 0,
    treble: 0,
  });

  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      analyserRef.current.smoothingTimeConstant = 0.85;
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.gain.value = 0.7;
      analyserRef.current.connect(gainNodeRef.current);
      gainNodeRef.current.connect(audioContextRef.current.destination);
      const bufferLength = analyserRef.current.frequencyBinCount;
      frequencyDataRef.current = new Uint8Array(bufferLength);
      console.log('AudioContext initialized', audioContextRef.current.sampleRate);
    }
  }, []);

  const handleFileUpload = useCallback(async (file: File) => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch (e) {
        // Ignore if already stopped
      }
      sourceRef.current = null;
    }

    initAudioContext();

    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    setAudioState((prev) => ({
      ...prev,
      isLoaded: false,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      fileName: file.name,
    }));

    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContextRef.current!.decodeAudioData(arrayBuffer);
      audioBufferRef.current = audioBuffer;
      pausedAtRef.current = 0;
      isPlayingRef.current = false;

      setAudioState((prev) => ({
        ...prev,
        isLoaded: true,
        duration: audioBuffer.duration,
        currentTime: 0,
      }));
      console.log('Audio decoded successfully', audioBuffer.duration);
    } catch (error) {
      console.error('Error decoding audio:', error);
    }
  }, [initAudioContext]);

  const startAnalysis = useCallback(() => {
    const analyze = () => {
      if (analyserRef.current && frequencyDataRef.current && audioContextRef.current) {
        analyserRef.current.getByteFrequencyData(frequencyDataRef.current);

        let nonZeroCount = 0;
        for (let i = 0; i < frequencyDataRef.current.length; i++) {
          if (frequencyDataRef.current[i] > 0) {
            nonZeroCount++;
          }
        }

        if (nonZeroCount > 5) {
          const bands = extractFrequencyBands(
            frequencyDataRef.current,
            audioContextRef.current.sampleRate
          );
          setFrequencyData(bands);
        }
      }

      if (isPlayingRef.current && audioContextRef.current && audioBufferRef.current) {
        const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
        if (elapsed < audioBufferRef.current.duration) {
          setAudioState((prev) => ({ ...prev, currentTime: elapsed }));
        }
      }

      animationFrameRef.current = requestAnimationFrame(analyze);
    };
    analyze();
  }, []);

  const stopAnalysis = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const play = useCallback(async () => {
    if (!audioBufferRef.current || !audioContextRef.current || !analyserRef.current) return;

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch (e) {
        // Ignore
      }
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBufferRef.current;
    source.connect(analyserRef.current);
    sourceRef.current = source;

    const offset = pausedAtRef.current;
    source.start(0, offset);
    startTimeRef.current = audioContextRef.current.currentTime - offset;
    isPlayingRef.current = true;

    source.onended = () => {
      if (isPlayingRef.current) {
        setAudioState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }));
        isPlayingRef.current = false;
        pausedAtRef.current = 0;
        stopAnalysis();
        setFrequencyData({
          lows: 0,
          mids: 0,
          highs: 0,
          average: 0,
          bass: 0,
          treble: 0,
        });
      }
    };

    setAudioState((prev) => ({ ...prev, isPlaying: true }));
    startAnalysis();
    console.log('Audio playing from', offset);
  }, [startAnalysis, stopAnalysis]);

  const pause = useCallback(() => {
    if (sourceRef.current && audioContextRef.current) {
      try {
        sourceRef.current.stop();
      } catch (e) {
        // Ignore
      }
      pausedAtRef.current = audioContextRef.current.currentTime - startTimeRef.current;
      isPlayingRef.current = false;
      sourceRef.current = null;
    }
    setAudioState((prev) => ({ ...prev, isPlaying: false }));
    stopAnalysis();
  }, [stopAnalysis]);

  const togglePlay = useCallback(() => {
    if (audioState.isPlaying) {
      pause();
    } else {
      play();
    }
  }, [audioState.isPlaying, play, pause]);

  const seek = useCallback((time: number) => {
    if (!audioBufferRef.current) return;

    const wasPlaying = isPlayingRef.current;
    if (wasPlaying && sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch (e) {
        // Ignore
      }
      sourceRef.current = null;
    }

    pausedAtRef.current = Math.max(0, Math.min(time, audioBufferRef.current.duration - 0.1));
    setAudioState((prev) => ({ ...prev, currentTime: pausedAtRef.current }));

    if (wasPlaying) {
      play();
    }
  }, [play]);

  const setVolume = useCallback((volume: number) => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume;
    }
    setAudioState((prev) => ({ ...prev, volume }));
  }, []);

  useEffect(() => {
    return () => {
      stopAnalysis();
      if (sourceRef.current) {
        try {
          sourceRef.current.stop();
        } catch (e) {
          // Ignore
        }
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stopAnalysis]);

  return {
    audioState,
    frequencyData,
    handleFileUpload,
    play,
    pause,
    togglePlay,
    seek,
    setVolume,
  };
};
