import { PipelineSegment, PipelineLayer, Valve } from '../types';

const CENTER_LNG = 116.3974;
const CENTER_LAT = 39.9093;
const AREA_SIZE = 0.02;

export const generatePipelineSegments = (): PipelineSegment[] => {
  const segments: PipelineSegment[] = [];

  segments.push(...generateWaterPipelines());
  segments.push(...generateSewagePipelines());
  segments.push(...generateGasPipelines());

  return segments;
};

export const generateValves = (pipelines: PipelineSegment[]): Valve[] => {
  const valves: Valve[] = [];
  let valveIndex = 0;

  const waterPipelines = pipelines.filter((p) => p.type === 'water');
  waterPipelines.forEach((pipeline) => {
    const step = Math.max(1, Math.floor(pipeline.positions.length / 2));
    for (let i = 0; i < pipeline.positions.length; i += step) {
      if (i === 0 || i === pipeline.positions.length - 1 || Math.random() > 0.6) {
        const pos = pipeline.positions[i];
        valves.push({
          id: `valve-water-${valveIndex++}`,
          name: `给水阀门 ${valveIndex}`,
          type: i === 0 || i === pipeline.positions.length - 1 ? 'gate' : 'butterfly',
          position: [pos[0], pos[1], pos[2] + 0.5],
          status: 'open',
          connectedPipelines: [pipeline.id],
        });
        if (!pipeline.connectedValves) pipeline.connectedValves = [];
        pipeline.connectedValves.push(valves[valves.length - 1].id);
      }
    }
  });

  const sewagePipelines = pipelines.filter((p) => p.type === 'sewage');
  sewagePipelines.forEach((pipeline) => {
    const step = Math.max(1, Math.floor(pipeline.positions.length / 2));
    for (let i = 0; i < pipeline.positions.length; i += step) {
      if (i === 0 || i === pipeline.positions.length - 1 || Math.random() > 0.5) {
        const pos = pipeline.positions[i];
        valves.push({
          id: `valve-sewage-${valveIndex++}`,
          name: `排水阀门 ${valveIndex}`,
          type: 'check',
          position: [pos[0], pos[1], pos[2] + 0.5],
          status: 'open',
          connectedPipelines: [pipeline.id],
        });
        if (!pipeline.connectedValves) pipeline.connectedValves = [];
        pipeline.connectedValves.push(valves[valves.length - 1].id);
      }
    }
  });

  const gasPipelines = pipelines.filter((p) => p.type === 'gas');
  gasPipelines.forEach((pipeline) => {
    const step = Math.max(1, Math.floor(pipeline.positions.length / 2));
    for (let i = 0; i < pipeline.positions.length; i += step) {
      if (i === 0 || i === pipeline.positions.length - 1 || Math.random() > 0.5) {
        const pos = pipeline.positions[i];
        valves.push({
          id: `valve-gas-${valveIndex++}`,
          name: `燃气阀门 ${valveIndex}`,
          type: 'gate',
          position: [pos[0], pos[1], pos[2] + 0.5],
          status: 'open',
          connectedPipelines: [pipeline.id],
        });
        if (!pipeline.connectedValves) pipeline.connectedValves = [];
        pipeline.connectedValves.push(valves[valves.length - 1].id);
      }
    }
  });

  return valves;
};

const generateWaterPipelines = (): PipelineSegment[] => {
  const segments: PipelineSegment[] = [];
  const color = '#3B82F6';

  const mainRoutes: [number, number][][] = [
    [
      [CENTER_LNG - AREA_SIZE * 0.8, CENTER_LAT + AREA_SIZE * 0.8],
      [CENTER_LNG - AREA_SIZE * 0.3, CENTER_LAT + AREA_SIZE * 0.8],
      [CENTER_LNG + AREA_SIZE * 0.2, CENTER_LAT + AREA_SIZE * 0.5],
      [CENTER_LNG + AREA_SIZE * 0.6, CENTER_LAT + AREA_SIZE * 0.3],
      [CENTER_LNG + AREA_SIZE * 0.8, CENTER_LAT - AREA_SIZE * 0.2],
    ],
    [
      [CENTER_LNG - AREA_SIZE * 0.8, CENTER_LAT - AREA_SIZE * 0.8],
      [CENTER_LNG - AREA_SIZE * 0.4, CENTER_LAT - AREA_SIZE * 0.5],
      [CENTER_LNG, CENTER_LAT - AREA_SIZE * 0.3],
      [CENTER_LNG + AREA_SIZE * 0.4, CENTER_LAT - AREA_SIZE * 0.1],
      [CENTER_LNG + AREA_SIZE * 0.8, CENTER_LAT + AREA_SIZE * 0.2],
    ],
  ];

  mainRoutes.forEach((route, idx) => {
    const positions = route.map(([lng, lat]) => [lng, lat, -5 - Math.random() * 3] as [number, number, number]);
    segments.push({
      id: `water-main-${idx}`,
      type: 'water',
      positions,
      radius: 0.8,
      color,
      name: `给水干管 ${idx + 1}`,
    });
  });

  for (let i = 0; i < 8; i++) {
    const startLng = CENTER_LNG - AREA_SIZE * 0.7 + Math.random() * AREA_SIZE * 1.4;
    const startLat = CENTER_LAT - AREA_SIZE * 0.7 + Math.random() * AREA_SIZE * 1.4;
    const positions: [number, number, number][] = [];
    const depth = -3 - Math.random() * 2;

    for (let j = 0; j < 5; j++) {
      positions.push([
        startLng + j * 0.003 * (Math.random() - 0.5),
        startLat + j * 0.003,
        depth,
      ]);
    }

    segments.push({
      id: `water-branch-${i}`,
      type: 'water',
      positions,
      radius: 0.4,
      color,
      name: `给水支管 ${i + 1}`,
    });
  }

  return segments;
};

const generateSewagePipelines = (): PipelineSegment[] => {
  const segments: PipelineSegment[] = [];
  const color = '#6B7280';

  const mainRoutes: [number, number][][] = [
    [
      [CENTER_LNG + AREA_SIZE * 0.8, CENTER_LAT + AREA_SIZE * 0.8],
      [CENTER_LNG + AREA_SIZE * 0.4, CENTER_LAT + AREA_SIZE * 0.6],
      [CENTER_LNG, CENTER_LAT + AREA_SIZE * 0.4],
      [CENTER_LNG - AREA_SIZE * 0.3, CENTER_LAT + AREA_SIZE * 0.1],
      [CENTER_LNG - AREA_SIZE * 0.6, CENTER_LAT - AREA_SIZE * 0.3],
      [CENTER_LNG - AREA_SIZE * 0.8, CENTER_LAT - AREA_SIZE * 0.8],
    ],
  ];

  mainRoutes.forEach((route, idx) => {
    const positions = route.map(([lng, lat]) => [lng, lat, -8 - Math.random() * 4] as [number, number, number]);
    segments.push({
      id: `sewage-main-${idx}`,
      type: 'sewage',
      positions,
      radius: 1.2,
      color,
      name: `排水干管 ${idx + 1}`,
    });
  });

  for (let i = 0; i < 6; i++) {
    const startLng = CENTER_LNG - AREA_SIZE * 0.6 + Math.random() * AREA_SIZE * 1.2;
    const startLat = CENTER_LAT - AREA_SIZE * 0.6 + Math.random() * AREA_SIZE * 1.2;
    const positions: [number, number, number][] = [];
    const depth = -6 - Math.random() * 3;

    for (let j = 0; j < 6; j++) {
      positions.push([
        startLng + j * 0.0025,
        startLat + j * 0.002 * (Math.random() - 0.3),
        depth - j * 0.3,
      ]);
    }

    segments.push({
      id: `sewage-branch-${i}`,
      type: 'sewage',
      positions,
      radius: 0.6,
      color,
      name: `排水支管 ${i + 1}`,
    });
  }

  return segments;
};

const generateGasPipelines = (): PipelineSegment[] => {
  const segments: PipelineSegment[] = [];
  const color = '#EF4444';

  const mainRoutes: [number, number][][] = [
    [
      [CENTER_LNG - AREA_SIZE * 0.8, CENTER_LAT],
      [CENTER_LNG - AREA_SIZE * 0.5, CENTER_LAT + AREA_SIZE * 0.2],
      [CENTER_LNG - AREA_SIZE * 0.2, CENTER_LAT],
      [CENTER_LNG + AREA_SIZE * 0.1, CENTER_LAT - AREA_SIZE * 0.2],
      [CENTER_LNG + AREA_SIZE * 0.4, CENTER_LAT - AREA_SIZE * 0.1],
      [CENTER_LNG + AREA_SIZE * 0.8, CENTER_LAT + AREA_SIZE * 0.1],
    ],
  ];

  mainRoutes.forEach((route, idx) => {
    const positions = route.map(([lng, lat]) => [lng, lat, -4 - Math.random() * 2] as [number, number, number]);
    segments.push({
      id: `gas-main-${idx}`,
      type: 'gas',
      positions,
      radius: 0.5,
      color,
      name: `燃气干管 ${idx + 1}`,
    });
  });

  for (let i = 0; i < 10; i++) {
    const startLng = CENTER_LNG - AREA_SIZE * 0.7 + Math.random() * AREA_SIZE * 1.4;
    const startLat = CENTER_LAT - AREA_SIZE * 0.7 + Math.random() * AREA_SIZE * 1.4;
    const positions: [number, number, number][] = [];
    const depth = -2 - Math.random() * 2;

    for (let j = 0; j < 4; j++) {
      positions.push([
        startLng + j * 0.002 * (Math.random() - 0.2),
        startLat + j * 0.002,
        depth,
      ]);
    }

    segments.push({
      id: `gas-branch-${i}`,
      type: 'gas',
      positions,
      radius: 0.25,
      color,
      name: `燃气支管 ${i + 1}`,
    });
  }

  return segments;
};

export const getDefaultLayers = (): PipelineLayer[] => [
  {
    id: 'water',
    name: '给水管网',
    type: 'water',
    color: '#3B82F6',
    visible: true,
  },
  {
    id: 'sewage',
    name: '排水管网',
    type: 'sewage',
    color: '#6B7280',
    visible: true,
  },
  {
    id: 'gas',
    name: '燃气管网',
    type: 'gas',
    color: '#EF4444',
    visible: true,
  },
];

export const getInitialView = () => ({
  longitude: CENTER_LNG,
  latitude: CENTER_LAT,
  height: 800,
  heading: 0,
  pitch: -45,
});
