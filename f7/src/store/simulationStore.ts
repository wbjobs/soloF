import { create } from 'zustand';

export interface Preset {
  id: number;
  name: string;
  viscosity: number;
  diffusion: number;
  timeStep: number;
  pressureIterations: number;
  createdAt?: string;
}

interface SimulationState {
  viscosity: number;
  diffusion: number;
  timeStep: number;
  pressureIterations: number;
  isRecording: boolean;
  fps: number;
  presets: Preset[];
  activePresetId: number | null;
  
  setViscosity: (value: number) => void;
  setDiffusion: (value: number) => void;
  setTimeStep: (value: number) => void;
  setPressureIterations: (value: number) => void;
  setIsRecording: (value: boolean) => void;
  setFps: (value: number) => void;
  setPresets: (presets: Preset[]) => void;
  setActivePresetId: (id: number | null) => void;
  loadPreset: (preset: Preset) => void;
  resetToDefaults: () => void;
}

const DEFAULT_VALUES = {
  viscosity: 0.0001,
  diffusion: 0.0001,
  timeStep: 0.05,
  pressureIterations: 20,
};

export const useSimulationStore = create<SimulationState>((set) => ({
  ...DEFAULT_VALUES,
  isRecording: false,
  fps: 60,
  presets: [],
  activePresetId: null,

  setViscosity: (value) => set({ viscosity: value }),
  setDiffusion: (value) => set({ diffusion: value }),
  setTimeStep: (value) => set({ timeStep: value }),
  setPressureIterations: (value) => set({ pressureIterations: value }),
  setIsRecording: (value) => set({ isRecording: value }),
  setFps: (value) => set({ fps: value }),
  setPresets: (presets) => set({ presets }),
  setActivePresetId: (id) => set({ activePresetId: id }),
  
  loadPreset: (preset) => set({
    viscosity: preset.viscosity,
    diffusion: preset.diffusion,
    timeStep: preset.timeStep,
    pressureIterations: preset.pressureIterations,
    activePresetId: preset.id,
  }),
  
  resetToDefaults: () => set(DEFAULT_VALUES),
}));
