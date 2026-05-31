import React, { useState, useEffect } from 'react';
import {
  Settings,
  Save,
  Trash2,
  Video,
  VideoOff,
  RotateCcw,
  Wind,
  Droplets,
  Clock,
  Layers,
  Plus,
  Minus,
  Eye,
  EyeOff,
  CircleDot,
} from 'lucide-react';
import { useSimulationStore, Preset } from '../store/simulationStore';
import { SmokeEmitter } from '../utils/FluidSimulation';

interface ControlPanelProps {
  onParamsChange: (params: {
    viscosity: number;
    diffusion: number;
    timeStep: number;
    pressureIterations: number;
  }) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  isRecording: boolean;
  emitters: SmokeEmitter[];
  onEmitterUpdate: (id: number, updates: Partial<SmokeEmitter>) => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  onParamsChange,
  onStartRecording,
  onStopRecording,
  isRecording,
  emitters,
  onEmitterUpdate,
}) => {
  const {
    viscosity,
    diffusion,
    timeStep,
    pressureIterations,
    presets,
    activePresetId,
    setViscosity,
    setDiffusion,
    setTimeStep,
    setPressureIterations,
    setPresets,
    setActivePresetId,
    loadPreset,
    resetToDefaults,
  } = useSimulationStore();

  const [newPresetName, setNewPresetName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [expandedEmitter, setExpandedEmitter] = useState<number | null>(1);

  useEffect(() => {
    fetchPresets();
  }, []);

  const fetchPresets = async () => {
    try {
      const response = await fetch('/api/presets');
      const data = await response.json();
      setPresets(data);
    } catch (error) {
      console.error('Failed to fetch presets:', error);
    }
  };

  const handleSavePreset = async () => {
    if (!newPresetName.trim()) return;
    
    try {
      const response = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newPresetName,
          viscosity,
          diffusion,
          timeStep,
          pressureIterations,
        }),
      });
      
      if (response.ok) {
        await fetchPresets();
        setNewPresetName('');
        setShowSaveDialog(false);
      }
    } catch (error) {
      console.error('Failed to save preset:', error);
    }
  };

  const handleDeletePreset = async (id: number) => {
    try {
      await fetch(`/api/presets/${id}`, { method: 'DELETE' });
      await fetchPresets();
      if (activePresetId === id) {
        setActivePresetId(null);
      }
    } catch (error) {
      console.error('Failed to delete preset:', error);
    }
  };

  const handleLoadPreset = (preset: Preset) => {
    loadPreset(preset);
    onParamsChange({
      viscosity: preset.viscosity,
      diffusion: preset.diffusion,
      timeStep: preset.timeStep,
      pressureIterations: preset.pressureIterations,
    });
  };

  const handleReset = () => {
    resetToDefaults();
    onParamsChange({
      viscosity: 0.0001,
      diffusion: 0.0001,
      timeStep: 0.05,
      pressureIterations: 20,
    });
    setActivePresetId(null);
  };

  const SliderControl = ({ 
    label, 
    value, 
    onChange, 
    min, 
    max, 
    step, 
    icon: Icon,
    formatValue 
  }: { 
    label: string; 
    value: number; 
    onChange: (v: number) => void; 
    min: number; 
    max: number; 
    step: number;
    icon: React.ElementType;
    formatValue?: (v: number) => string;
  }) => (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-cyan-400" />
          <span className="text-sm text-gray-300">{label}</span>
        </div>
        <span className="text-xs font-mono text-cyan-300 bg-cyan-900/30 px-2 py-1 rounded">
          {formatValue ? formatValue(value) : value.toFixed(6)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
      />
    </div>
  );

  const ColorPicker = ({ 
    emitter,
  }: { 
    emitter: SmokeEmitter;
  }) => (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-sm text-gray-400 w-16">颜色</span>
      <input
        type="color"
        value={`${Math.round(emitter.color.r * 255).toString(16).padStart(2, '0')}${Math.round(emitter.color.g * 255).toString(16).padStart(2, '0')}${Math.round(emitter.color.b * 255).toString(16).padStart(2, '0')}`}
        onChange={(e) => {
          const hex = e.target.value;
          const r = parseInt(hex.slice(1, 3), 16) / 255;
          const g = parseInt(hex.slice(3, 5), 16) / 255;
          const b = parseInt(hex.slice(5, 7), 16) / 255;
          onEmitterUpdate(emitter.id, { color: { r, g, b } });
        }}
        className="w-10 h-10 rounded cursor-pointer border-2 border-gray-600"
      />
      <div 
        className="w-8 h-8 rounded-full shadow-lg"
        style={{ 
          backgroundColor: `rgb(${Math.round(emitter.color.r * 255)}, ${Math.round(emitter.color.g * 255)}, ${Math.round(emitter.color.b * 255)})`,
          boxShadow: `0 0 10px rgba(${Math.round(emitter.color.r * 255)}, ${Math.round(emitter.color.g * 255)}, ${Math.round(emitter.color.b * 255)}, 0.5)`
        }}
      />
    </div>
  );

  return (
    <div className="w-88 bg-gray-900/95 backdrop-blur-sm border-r border-gray-700 h-full flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-cyan-400" />
          <h2 className="text-lg font-semibold text-white">流体模拟控制</h2>
        </div>
        <p className="text-xs text-gray-400 mt-1">拖动鼠标创建风力场，可控制5个独立发射器</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4" />
            物理参数
          </h3>
          
          <SliderControl
            label="粘性系数"
            value={viscosity}
            onChange={(v) => {
              setViscosity(v);
              onParamsChange({ viscosity: v, diffusion, timeStep, pressureIterations });
            }}
            min={0}
            max={0.001}
            step={0.00001}
            icon={Droplets}
          />
          
          <SliderControl
            label="扩散系数"
            value={diffusion}
            onChange={(v) => {
              setDiffusion(v);
              onParamsChange({ viscosity, diffusion: v, timeStep, pressureIterations });
            }}
            min={0}
            max={0.001}
            step={0.00001}
            icon={Droplets}
          />
          
          <SliderControl
            label="时间步长"
            value={timeStep}
            onChange={(v) => {
              setTimeStep(v);
              onParamsChange({ viscosity, diffusion, timeStep: v, pressureIterations });
            }}
            min={0.01}
            max={0.2}
            step={0.01}
            icon={Clock}
            formatValue={(v) => v.toFixed(3)}
          />
          
          <SliderControl
            label="压力投影迭代"
            value={pressureIterations}
            onChange={(v) => {
              setPressureIterations(v);
              onParamsChange({ viscosity, diffusion, timeStep, pressureIterations: v });
            }}
            min={5}
            max={50}
            step={1}
            icon={Wind}
            formatValue={(v) => v.toString()}
          />
        </div>

        <button
          onClick={handleReset}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          重置为默认值
        </button>

        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
            <CircleDot className="w-4 h-4" />
            烟雾发射器 ({emitters.filter(e => e.enabled).length}/5)
          </h3>
          
          <div className="space-y-2">
            {emitters.map((emitter) => (
              <div key={emitter.id} className="bg-gray-800 rounded-lg overflow-hidden">
                <div 
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-700 transition-colors"
                  onClick={() => setExpandedEmitter(expandedEmitter === emitter.id ? null : emitter.id)}
                >
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-4 h-4 rounded-full"
                      style={{ 
                        backgroundColor: `rgb(${Math.round(emitter.color.r * 255)}, ${Math.round(emitter.color.g * 255)}, ${Math.round(emitter.color.b * 255)})` 
                      }}
                    />
                    <span className="text-sm text-white font-medium">{emitter.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEmitterUpdate(emitter.id, { enabled: !emitter.enabled });
                      }}
                      className="p-1 text-gray-400 hover:text-cyan-400 transition-colors"
                    >
                      {emitter.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    {expandedEmitter === emitter.id ? <Minus className="w-4 h-4 text-gray-400" /> : <Plus className="w-4 h-4 text-gray-400" />}
                  </div>
                </div>
                
                {expandedEmitter === emitter.id && (
                  <div className="px-3 pb-3 space-y-3 border-t border-gray-700 pt-3">
                    <ColorPicker emitter={emitter} />
                    
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-400 w-16">强度</span>
                      <input
                        type="range"
                        min={0.005}
                        max={0.1}
                        step={0.005}
                        value={emitter.strength}
                        onChange={(e) => onEmitterUpdate(emitter.id, { strength: parseFloat(e.target.value) })}
                        className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                      />
                      <span className="text-xs text-cyan-300 w-12 text-right">{emitter.strength.toFixed(3)}</span>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-400 w-16">半径</span>
                      <input
                        type="range"
                        min={10}
                        max={50}
                        step={1}
                        value={emitter.radius}
                        onChange={(e) => onEmitterUpdate(emitter.id, { radius: parseFloat(e.target.value) })}
                        className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                      />
                      <span className="text-xs text-cyan-300 w-12 text-right">{emitter.radius}</span>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-400 w-16">风速 X</span>
                        <input
                          type="range"
                          min={-10}
                          max={10}
                          step={0.5}
                          value={emitter.velocity.x}
                          onChange={(e) => onEmitterUpdate(emitter.id, { 
                            velocity: { ...emitter.velocity, x: parseFloat(e.target.value) } 
                          })}
                          className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                        />
                        <span className="text-xs text-cyan-300 w-12 text-right">{emitter.velocity.x.toFixed(1)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-400 w-16">风速 Y</span>
                        <input
                          type="range"
                          min={-10}
                          max={10}
                          step={0.5}
                          value={emitter.velocity.y}
                          onChange={(e) => onEmitterUpdate(emitter.id, { 
                            velocity: { ...emitter.velocity, y: parseFloat(e.target.value) } 
                          })}
                          className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                        />
                        <span className="text-xs text-cyan-300 w-12 text-right">{emitter.velocity.y.toFixed(1)}</span>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-400 w-16">位置 X</span>
                        <input
                          type="range"
                          min={0.05}
                          max={0.95}
                          step={0.01}
                          value={emitter.position.x}
                          onChange={(e) => onEmitterUpdate(emitter.id, { 
                            position: { ...emitter.position, x: parseFloat(e.target.value) } 
                          })}
                          className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                        />
                        <span className="text-xs text-cyan-300 w-12 text-right">{emitter.position.x.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-400 w-16">位置 Y</span>
                        <input
                          type="range"
                          min={0.05}
                          max={0.95}
                          step={0.01}
                          value={emitter.position.y}
                          onChange={(e) => onEmitterUpdate(emitter.id, { 
                            position: { ...emitter.position, y: parseFloat(e.target.value) } 
                          })}
                          className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                        />
                        <span className="text-xs text-cyan-300 w-12 text-right">{emitter.position.y.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
            <Save className="w-4 h-4" />
            预设管理
          </h3>
          
          {showSaveDialog ? (
            <div className="bg-gray-800 rounded-lg p-3 mb-3">
              <input
                type="text"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="输入预设名称"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm mb-2 focus:outline-none focus:border-cyan-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSavePreset}
                  className="flex-1 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm transition-colors"
                >
                  保存
                </button>
                <button
                  onClick={() => setShowSaveDialog(false)}
                  className="flex-1 py-1.5 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowSaveDialog(true)}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors mb-3"
            >
              <Save className="w-4 h-4" />
              保存当前配置
            </button>
          )}

          <div className="space-y-2 max-h-40 overflow-y-auto">
            {presets.map((preset) => (
              <div
                key={preset.id}
                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${
                  activePresetId === preset.id
                    ? 'bg-cyan-900/50 border border-cyan-500'
                    : 'bg-gray-800 hover:bg-gray-700 border border-transparent'
                }`}
                onClick={() => handleLoadPreset(preset)}
              >
                <span className="text-sm text-white truncate">{preset.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeletePreset(preset.id);
                  }}
                  className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-gray-700">
        <button
          onClick={isRecording ? onStopRecording : onStartRecording}
          className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg transition-all font-medium ${
            isRecording
              ? 'bg-red-600 hover:bg-red-500 text-white animate-pulse'
              : 'bg-green-600 hover:bg-green-500 text-white'
          }`}
        >
          {isRecording ? (
            <>
              <VideoOff className="w-5 h-5" />
              停止录制
            </>
          ) : (
            <>
              <Video className="w-5 h-5" />
              开始录制 (WebM)
            </>
          )}
        </button>
      </div>
    </div>
  );
}
