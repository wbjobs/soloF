import { useState, useMemo, useCallback } from 'react';
import CesiumMap from './components/CesiumMap';
import LayerControl from './components/LayerControl';
import BurstControlPanel from './components/BurstControlPanel';
import {
  generatePipelineSegments,
  generateValves,
  getDefaultLayers,
} from './utils/pipelineGenerator';
import { BurstSimulationState, Valve } from './types';
import './App.css';

function App() {
  const [isXrayMode, setIsXrayMode] = useState(false);
  const [layers, setLayers] = useState(getDefaultLayers());
  const [burstState, setBurstState] = useState<BurstSimulationState>({
    isActive: false,
    selectedPipelineId: null,
    burstPosition: null,
    affectedValveIds: [],
    waterSpreadProgress: 0,
  });

  const pipelineSegments = useMemo(() => generatePipelineSegments(), []);
  const valves = useMemo(() => generateValves(pipelineSegments), [pipelineSegments]);

  const handleLayerToggle = (layerId: string) => {
    setLayers((prev) =>
      prev.map((layer) =>
        layer.id === layerId ? { ...layer, visible: !layer.visible } : layer
      )
    );
  };

  const handleXrayToggle = (enabled: boolean) => {
    setIsXrayMode(enabled);
  };

  const handlePipelineSelect = useCallback((pipelineId: string | null) => {
    setBurstState((prev) => ({
      ...prev,
      selectedPipelineId: pipelineId,
    }));
  }, []);

  const handleStartBurstSimulation = useCallback(() => {
    if (!burstState.selectedPipelineId) return;

    const pipeline = pipelineSegments.find((p) => p.id === burstState.selectedPipelineId);
    if (!pipeline) return;

    const midIndex = Math.floor(pipeline.positions.length / 2);
    const burstPosition = pipeline.positions[midIndex];

    const affectedValves: string[] = [];
    const visitedPipelines = new Set<string>();

    const findDownstreamValves = (pipelineId: string, depth: number = 0) => {
      if (depth > 3 || visitedPipelines.has(pipelineId)) return;
      visitedPipelines.add(pipelineId);

      const pipe = pipelineSegments.find((p) => p.id === pipelineId);
      if (pipe?.connectedValves) {
        affectedValves.push(...pipe.connectedValves);
      }
    };

    findDownstreamValves(burstState.selectedPipelineId);

    setBurstState({
      isActive: true,
      selectedPipelineId: burstState.selectedPipelineId,
      burstPosition,
      affectedValveIds: [...new Set(affectedValves)],
      waterSpreadProgress: 0,
    });
  }, [burstState.selectedPipelineId, pipelineSegments]);

  const handleStopBurstSimulation = useCallback(() => {
    setBurstState({
      isActive: false,
      selectedPipelineId: null,
      burstPosition: null,
      affectedValveIds: [],
      waterSpreadProgress: 0,
    });
  }, []);

  const handleUpdateWaterProgress = useCallback((progress: number) => {
    setBurstState((prev) => ({
      ...prev,
      waterSpreadProgress: progress,
    }));
  }, []);

  const selectedPipeline = pipelineSegments.find((p) => p.id === burstState.selectedPipelineId);

  return (
    <div className="app-container">
      <CesiumMap
        pipelineSegments={pipelineSegments}
        layers={layers}
        isXrayMode={isXrayMode}
        onXrayToggle={handleXrayToggle}
        valves={valves}
        burstState={burstState}
        onPipelineSelect={handlePipelineSelect}
        onUpdateWaterProgress={handleUpdateWaterProgress}
      />
      <LayerControl
        layers={layers}
        onLayerToggle={handleLayerToggle}
        isXrayMode={isXrayMode}
        onXrayToggle={handleXrayToggle}
      />
      <BurstControlPanel
        burstState={burstState}
        selectedPipeline={selectedPipeline || null}
        valves={valves.filter((v) => burstState.affectedValveIds.includes(v.id))}
        onStartSimulation={handleStartBurstSimulation}
        onStopSimulation={handleStopBurstSimulation}
      />

      {isXrayMode && (
        <div className="xray-indicator">
          <div className="xray-pulse"></div>
          <span>X 光透视模式</span>
        </div>
      )}

      <div className="status-bar">
        <div className="status-item">
          <span className="status-label">图层数量:</span>
          <span className="status-value">{layers.filter((l) => l.visible).length} / {layers.length}</span>
        </div>
        <div className="status-item">
          <span className="status-label">管道段数:</span>
          <span className="status-value">{pipelineSegments.length}</span>
        </div>
        <div className="status-item">
          <span className="status-label">阀门数量:</span>
          <span className="status-value">{valves.length}</span>
        </div>
        <div className="status-item">
          <span className="status-label">透视模式:</span>
          <span className={`status-value ${isXrayMode ? 'active' : ''}`}>
            {isXrayMode ? '开启' : '关闭'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default App;
