export interface PipelineSegment {
  id: string;
  type: 'water' | 'sewage' | 'gas';
  positions: [number, number, number][];
  radius: number;
  color: string;
  name: string;
  connectedValves?: string[];
}

export interface PipelineLayer {
  id: string;
  name: string;
  type: 'water' | 'sewage' | 'gas';
  color: string;
  visible: boolean;
}

export interface Valve {
  id: string;
  name: string;
  type: 'gate' | 'butterfly' | 'check';
  position: [number, number, number];
  status: 'open' | 'closed';
  connectedPipelines: string[];
  isAffected?: boolean;
}

export interface BurstSimulationState {
  isActive: boolean;
  selectedPipelineId: string | null;
  burstPosition: [number, number, number] | null;
  affectedValveIds: string[];
  waterSpreadProgress: number;
}

export interface MapState {
  isXrayMode: boolean;
  layers: PipelineLayer[];
  cameraPosition: {
    longitude: number;
    latitude: number;
    height: number;
  };
}
