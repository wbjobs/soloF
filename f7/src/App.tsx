import React, { useRef, useEffect, useState, useCallback } from 'react';
import { FluidSimulation, SmokeEmitter } from './utils/FluidSimulation';
import { ControlPanel } from './components/ControlPanel';
import { FPSCounter } from './components/FPSCounter';
import { useSimulationStore } from './store/simulationStore';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<FluidSimulation | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  
  const { isRecording, setIsRecording, setFps } = useSimulationStore();
  const [emitters, setEmitters] = useState<SmokeEmitter[]>([]);
  const [canvasReady, setCanvasReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const simulation = new FluidSimulation(containerRef.current, 512);
    simulationRef.current = simulation;
    setEmitters(simulation.getEmitters());
    setCanvasReady(true);

    let animationId: number;
    const animate = () => {
      simulation.update();
      animationId = requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => {
      if (containerRef.current) {
        simulation.resize(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        );
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      simulation.dispose();
    };
  }, []);

  const handleParamsChange = useCallback((params: {
    viscosity: number;
    diffusion: number;
    timeStep: number;
    pressureIterations: number;
  }) => {
    simulationRef.current?.setParams(params);
  }, []);

  const handleEmitterUpdate = useCallback((id: number, updates: Partial<SmokeEmitter>) => {
    simulationRef.current?.updateEmitter(id, updates);
    setEmitters(prev => prev.map(e => 
      e.id === id ? { ...e, ...updates } : e
    ));
  }, []);

  const handleStartRecording = useCallback(() => {
    if (!simulationRef.current) return;

    const canvas = simulationRef.current.getCanvas();
    const stream = canvas.captureStream(30);
    
    const options: MediaRecorderOptions = {
      mimeType: 'video/webm;codecs=vp9',
    };

    try {
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fluid-simulation-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
      alert('您的浏览器不支持 WebM 录制功能');
    }
  }, [setIsRecording]);

  const handleStopRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [setIsRecording]);

  return (
    <div className="flex h-screen w-screen bg-gray-950 overflow-hidden">
      {emitters.length > 0 && (
        <ControlPanel
          onParamsChange={handleParamsChange}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          isRecording={isRecording}
          emitters={emitters}
          onEmitterUpdate={handleEmitterUpdate}
        />
      )}
      
      <div className="flex-1 relative">
        <div ref={containerRef} className="w-full h-full" />
        
        <div className="absolute bottom-4 left-4">
          <FPSCounter onFPSUpdate={setFps} />
        </div>

        {isRecording && (
          <div className="absolute top-4 right-4 flex items-center gap-2 bg-red-600/90 px-4 py-2 rounded-lg">
            <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
            <span className="text-white font-medium text-sm">录制中</span>
          </div>
        )}

        <div className="absolute top-4 left-4 max-w-md">
          <div className="bg-gray-900/80 backdrop-blur-sm p-4 rounded-lg">
            <h1 className="text-xl font-bold text-white mb-2">彩色烟雾流体模拟</h1>
            <p className="text-sm text-gray-300">
              基于纳维-斯托克斯方程的GPU流体模拟，支持最多5个独立控制的烟雾发射器。
              每个发射器可以独立设置颜色、位置、强度、半径和风速。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
