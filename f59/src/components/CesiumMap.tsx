import { useEffect, useRef, useCallback } from 'react';
import * as Cesium from 'cesium';
import { PipelineSegment, PipelineLayer, Valve, BurstSimulationState } from '../types';
import { getInitialView } from '../utils/pipelineGenerator';

interface CesiumMapProps {
  pipelineSegments: PipelineSegment[];
  layers: PipelineLayer[];
  isXrayMode: boolean;
  onXrayToggle: (enabled: boolean) => void;
  valves: Valve[];
  burstState: BurstSimulationState;
  onPipelineSelect: (pipelineId: string | null) => void;
  onUpdateWaterProgress: (progress: number) => void;
}

const CesiumMap = ({
  pipelineSegments,
  layers,
  isXrayMode,
  onXrayToggle,
  valves,
  burstState,
  onPipelineSelect,
  onUpdateWaterProgress,
}: CesiumMapProps) => {
  const cesiumContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const primitivesRef = useRef<Map<string, Cesium.GroundPrimitive>>(new Map());
  const valveEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const handlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const tilesetRef = useRef<Cesium.Cesium3DTileset | null>(null);
  const selectedPipelinePrimitiveRef = useRef<Cesium.GroundPrimitive | null>(null);
  const particleSystemRef = useRef<Cesium.ParticleSystem | null>(null);
  const waterSpreadAnimationRef = useRef<number | null>(null);
  const burstPointEntityRef = useRef<Cesium.Entity | null>(null);
  const waterSpreadPrimitiveRef = useRef<Cesium.GroundPrimitive | null>(null);

  const createXrayMaterial = (color: Cesium.Color) => {
    return new Cesium.Material({
      fabric: {
        type: 'XrayUnderground',
        uniforms: {
          glowColor: color,
          glowWidth: 0.4,
          innerAlpha: 0.7,
        },
        source: `
          uniform vec4 glowColor;
          uniform float glowWidth;
          uniform float innerAlpha;
          
          czm_material czm_getMaterial(czm_materialInput materialInput) {
            czm_material material = czm_getDefaultMaterial(materialInput);
            
            vec2 st = materialInput.st;
            float dist = abs(st.s - 0.5) * 2.0;
            
            float edgeGlow = smoothstep(0.6, 1.0, 1.0 - dist) * glowWidth;
            float inner = 1.0 - smoothstep(0.0, 0.5, dist);
            
            vec3 edgeColor = glowColor.rgb * 1.5;
            vec3 innerColor = glowColor.rgb * 0.8;
            
            vec3 finalColor = mix(innerColor, edgeColor, edgeGlow);
            float finalAlpha = innerAlpha * (0.3 + inner * 0.5 + edgeGlow * 0.2);
            
            material.diffuse = finalColor;
            material.emission = finalColor * 0.6;
            material.alpha = finalAlpha;
            material.specular = 0.0;
            
            return material;
          }
        `,
      },
    });
  };

  const createStandardMaterial = (color: Cesium.Color) => {
    return new Cesium.Material({
      fabric: {
        type: 'StandardUnderground',
        uniforms: {
          baseColor: color.withAlpha(0.85),
        },
        source: `
          uniform vec4 baseColor;
          
          czm_material czm_getMaterial(czm_materialInput materialInput) {
            czm_material material = czm_getDefaultMaterial(materialInput);
            
            vec2 st = materialInput.st;
            float dist = abs(st.s - 0.5) * 2.0;
            float edge = smoothstep(0.8, 1.0, 1.0 - dist);
            
            material.diffuse = baseColor.rgb * (0.9 + edge * 0.1);
            material.alpha = baseColor.a * (0.7 + edge * 0.3);
            material.specular = 0.1;
            material.shininess = 8.0;
            
            return material;
          }
        `,
      },
    });
  };

  const createSelectedMaterial = (color: Cesium.Color) => {
    return new Cesium.Material({
      fabric: {
        type: 'SelectedPipeline',
        uniforms: {
          baseColor: color,
          glowIntensity: 0.8,
        },
        source: `
          uniform vec4 baseColor;
          uniform float glowIntensity;
          
          czm_material czm_getMaterial(czm_materialInput materialInput) {
            czm_material material = czm_getDefaultMaterial(materialInput);
            
            vec2 st = materialInput.st;
            float dist = abs(st.s - 0.5) * 2.0;
            
            float pulse = sin(czm_frameNumber * 0.05) * 0.3 + 0.7;
            float edgeGlow = smoothstep(0.7, 1.0, 1.0 - dist) * glowIntensity * pulse;
            
            vec3 glowColor = baseColor.rgb * 1.8;
            vec3 finalColor = baseColor.rgb * 0.9 + glowColor * edgeGlow;
            float finalAlpha = 0.9 + edgeGlow * 0.1;
            
            material.diffuse = finalColor;
            material.emission = glowColor * pulse * 0.5;
            material.alpha = finalAlpha;
            material.specular = 0.2;
            
            return material;
          }
        `,
      },
    });
  };

  const createCorridorGeometry = (segment: PipelineSegment, widthMultiplier: number = 1) => {
    const positions = Cesium.Cartesian3.fromDegreesArrayHeights(
      segment.positions.flat() as number[]
    );

    return new Cesium.CorridorGeometry({
      positions,
      width: segment.radius * 6 * widthMultiplier,
      vertexFormat: Cesium.VertexFormat.POSITION_AND_ST,
    });
  };

  const createPipelinePrimitive = useCallback(
    (segment: PipelineSegment, viewer: Cesium.Viewer, isSelected: boolean = false) => {
      const layer = layers.find((l) => l.type === segment.type);
      if (!layer?.visible) return null;

      const color = Cesium.Color.fromCssColorString(segment.color);
      const geometry = createCorridorGeometry(segment, isSelected ? 1.3 : 1);

      let material;
      if (isSelected) {
        material = createSelectedMaterial(color);
      } else if (isXrayMode) {
        material = createXrayMaterial(color);
      } else {
        material = createStandardMaterial(color);
      }

      const appearance = new Cesium.MaterialAppearance({
        material,
        translucent: true,
        closed: false,
        renderState: {
          depthTest: {
            enabled: false,
          },
          depthMask: false,
          blending: Cesium.BlendingState.ALPHA_BLEND,
        },
      });

      const instance = new Cesium.GeometryInstance({
        geometry,
        id: segment.id,
      });

      const primitive = viewer.scene.primitives.add(
        new Cesium.GroundPrimitive({
          geometryInstances: instance,
          appearance,
          classificationType: Cesium.ClassificationType.TERRAIN,
          asynchronous: false,
          interleave: true,
        })
      );

      return primitive;
    },
    [layers, isXrayMode]
  );

  const updatePipelinePrimitives = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    primitivesRef.current.forEach((primitive) => {
      viewer.scene.primitives.remove(primitive);
    });
    primitivesRef.current.clear();

    if (selectedPipelinePrimitiveRef.current) {
      viewer.scene.primitives.remove(selectedPipelinePrimitiveRef.current);
      selectedPipelinePrimitiveRef.current = null;
    }

    pipelineSegments.forEach((segment) => {
      if (segment.id === burstState.selectedPipelineId) {
        const selectedPrimitive = createPipelinePrimitive(segment, viewer, true);
        if (selectedPrimitive) {
          selectedPipelinePrimitiveRef.current = selectedPrimitive;
        }
      } else {
        const primitive = createPipelinePrimitive(segment, viewer, false);
        if (primitive) {
          primitivesRef.current.set(segment.id, primitive);
        }
      }
    });
  }, [pipelineSegments, createPipelinePrimitive, burstState.selectedPipelineId]);

  const createValveEntity = (valve: Valve, viewer: Cesium.Viewer, isAffected: boolean) => {
    const position = Cesium.Cartesian3.fromDegrees(
      valve.position[0],
      valve.position[1],
      valve.position[2]
    );

    const color = isAffected
      ? Cesium.Color.fromCssColorString('#fbbf24')
      : valve.status === 'open'
      ? Cesium.Color.fromCssColorString('#22c55e')
      : Cesium.Color.fromCssColorString('#ef4444');

    const entity = viewer.entities.add({
      id: valve.id,
      name: valve.name,
      position,
      point: {
        pixelSize: isAffected ? 14 : 10,
        color,
        outlineColor: isAffected ? Cesium.Color.WHITE : Cesium.Color.BLACK,
        outlineWidth: isAffected ? 3 : 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: isAffected ? '⚠ 需关闭' : '',
        font: '11px sans-serif',
        pixelOffset: new Cesium.Cartesian2(0, -18),
        fillColor: Cesium.Color.YELLOW,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
      },
    });

    return entity;
  };

  const updateValveEntities = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    valveEntitiesRef.current.forEach((entity) => {
      viewer.entities.remove(entity);
    });
    valveEntitiesRef.current.clear();

    valves.forEach((valve) => {
      const isAffected = burstState.affectedValveIds.includes(valve.id);
      const entity = createValveEntity(valve, viewer, isAffected);
      valveEntitiesRef.current.set(valve.id, entity);
    });
  }, [valves, burstState.affectedValveIds]);

  const createBurstParticleSystem = (position: [number, number, number], viewer: Cesium.Viewer) => {
    const cartesianPosition = Cesium.Cartesian3.fromDegrees(
      position[0],
      position[1],
      position[2] + 2
    );

    const particleSystem = new Cesium.ParticleSystem({
      image: createWaterParticleCanvas(),
      startColor: Cesium.Color.CYAN.withAlpha(0.8),
      endColor: Cesium.Color.WHITE.withAlpha(0.1),
      startScale: 1.0,
      endScale: 4.0,
      minimumParticleLife: 1.5,
      maximumParticleLife: 3.0,
      minimumSpeed: 2.0,
      maximumSpeed: 5.0,
      imageSize: new Cesium.Cartesian2(15, 15),
      emissionRate: 50,
      lifetime: Number.POSITIVE_INFINITY,
      emitter: new Cesium.SphereEmitter(3.0),
      modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(cartesianPosition),
      sizeInMeters: true,
    });

    viewer.scene.primitives.add(particleSystem);
    return particleSystem;
  };

  const createWaterParticleCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      gradient.addColorStop(0, 'rgba(100, 200, 255, 0.9)');
      gradient.addColorStop(0.5, 'rgba(50, 150, 255, 0.5)');
      gradient.addColorStop(1, 'rgba(0, 100, 200, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 32, 32);
    }
    return canvas;
  };

  const createWaterSpreadEffect = (center: [number, number, number], progress: number, viewer: Cesium.Viewer) => {
    if (waterSpreadPrimitiveRef.current) {
      viewer.scene.primitives.remove(waterSpreadPrimitiveRef.current);
      waterSpreadPrimitiveRef.current = null;
    }

    const maxRadius = 150;
    const currentRadius = maxRadius * progress;

    const positions: number[] = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const lng = center[0] + (Math.cos(angle) * currentRadius) / 111320;
      const lat = center[1] + (Math.sin(angle) * currentRadius) / 111320;
      positions.push(lng, lat);
    }

    const geometry = new Cesium.PolygonGeometry({
      polygonHierarchy: new Cesium.PolygonHierarchy(
        Cesium.Cartesian3.fromDegreesArray(positions)
      ),
      vertexFormat: Cesium.VertexFormat.POSITION_AND_ST,
    });

    const material = new Cesium.Material({
      fabric: {
        type: 'WaterSpread',
        uniforms: {
          waterColor: Cesium.Color.CYAN.withAlpha(0.4),
          center: new Cesium.Cartesian2(0.5, 0.5),
          radius: progress,
        },
        source: `
          uniform vec4 waterColor;
          uniform vec2 center;
          uniform float radius;
          
          czm_material czm_getMaterial(czm_materialInput materialInput) {
            czm_material material = czm_getDefaultMaterial(materialInput);
            
            vec2 st = materialInput.st;
            float dist = distance(st, center);
            
            float wave = sin(dist * 20.0 - czm_frameNumber * 0.1) * 0.1 + 0.9;
            float edge = smoothstep(radius * 0.8, radius, dist);
            float inner = 1.0 - smoothstep(0.0, radius * 0.3, dist);
            
            vec3 finalColor = waterColor.rgb * (0.6 + inner * 0.4);
            float finalAlpha = waterColor.a * (1.0 - edge) * wave;
            
            material.diffuse = finalColor;
            material.emission = finalColor * 0.3;
            material.alpha = finalAlpha;
            
            return material;
          }
        `,
      },
    });

    const primitive = viewer.scene.primitives.add(
      new Cesium.GroundPrimitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry,
        }),
        appearance: new Cesium.MaterialAppearance({
          material,
          translucent: true,
          closed: false,
          renderState: {
            depthTest: { enabled: false },
            depthMask: false,
            blending: Cesium.BlendingState.ALPHA_BLEND,
          },
        }),
        classificationType: Cesium.ClassificationType.TERRAIN,
        asynchronous: false,
      })
    );

    waterSpreadPrimitiveRef.current = primitive;
  };

  const createBurstPointEntity = (position: [number, number, number], viewer: Cesium.Viewer) => {
    const cartesianPosition = Cesium.Cartesian3.fromDegrees(
      position[0],
      position[1],
      position[2] + 1
    );

    const entity = viewer.entities.add({
      id: 'burst-point',
      name: '爆管位置',
      position: cartesianPosition,
      point: {
        pixelSize: 20,
        color: Cesium.Color.RED,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: '💥 爆管点',
        font: 'bold 14px sans-serif',
        pixelOffset: new Cesium.Cartesian2(0, -25),
        fillColor: Cesium.Color.RED,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 3,
        outlineColor: Cesium.Color.WHITE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: Cesium.Color.WHITE.withAlpha(0.9),
      },
    });

    return entity;
  };

  const startBurstEffect = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || !burstState.burstPosition) return;

    particleSystemRef.current = createBurstParticleSystem(burstState.burstPosition, viewer);
    burstPointEntityRef.current = createBurstPointEntity(burstState.burstPosition, viewer);

    let progress = 0;
    const animate = () => {
      progress += 0.005;
      if (progress <= 1) {
        onUpdateWaterProgress(progress);
        if (burstState.burstPosition) {
          createWaterSpreadEffect(burstState.burstPosition, progress, viewer);
        }
        waterSpreadAnimationRef.current = requestAnimationFrame(animate);
      }
    };
    animate();
  }, [burstState.burstPosition, onUpdateWaterProgress]);

  const stopBurstEffect = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (particleSystemRef.current) {
      viewer.scene.primitives.remove(particleSystemRef.current);
      particleSystemRef.current = null;
    }

    if (burstPointEntityRef.current) {
      viewer.entities.remove(burstPointEntityRef.current);
      burstPointEntityRef.current = null;
    }

    if (waterSpreadPrimitiveRef.current) {
      viewer.scene.primitives.remove(waterSpreadPrimitiveRef.current);
      waterSpreadPrimitiveRef.current = null;
    }

    if (waterSpreadAnimationRef.current) {
      cancelAnimationFrame(waterSpreadAnimationRef.current);
      waterSpreadAnimationRef.current = null;
    }
  }, []);

  const loadBuildingsTileset = useCallback(async (viewer: Cesium.Viewer) => {
    try {
      const tileset = await Cesium.createGooglePhotorealistic3DTileset();
      tilesetRef.current = tileset;
      viewer.scene.primitives.add(tileset);

      const initialView = getInitialView();
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          initialView.longitude,
          initialView.latitude,
          initialView.height
        ),
        orientation: {
          heading: Cesium.Math.toRadians(initialView.heading),
          pitch: Cesium.Math.toRadians(initialView.pitch),
          roll: 0,
        },
        duration: 2,
      });

      return tileset;
    } catch (error) {
      console.log('Could not load 3D Tiles:', error);
      return null;
    }
  }, []);

  const applyXrayMode = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const globe = viewer.scene.globe;

    globe.translucency.enabled = true;
    globe.translucency.frontFaceAlpha = 0.3;
    globe.translucency.backFaceAlpha = 0.1;

    viewer.scene.fog.enabled = false;
    viewer.scene.skyAtmosphere.show = false;
  }, []);

  const disableXrayMode = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const globe = viewer.scene.globe;

    globe.translucency.enabled = false;
    globe.translucency.frontFaceAlpha = 1.0;
    globe.translucency.backFaceAlpha = 0.5;

    viewer.scene.fog.enabled = true;
    viewer.scene.skyAtmosphere.show = true;
  }, []);

  useEffect(() => {
    if (!cesiumContainerRef.current) return;

    Cesium.Ion.defaultAccessToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYWE1OWUxNy1mMWZiLTQzYjYtYTU0MS1lNTBlYjBkMzIwMzgiLCJpZCI6NTc2ODksImlhdCI6MTYyMjY3NjgxMH0.XfhnCwrcv1V0x9P3v6R8b9aY';

    const viewer = new Cesium.Viewer(cesiumContainerRef.current, {
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      baseLayerPicker: true,
      geocoder: true,
      homeButton: true,
      sceneModePicker: true,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: true,
      infoBox: false,
      selectionIndicator: false,
      imageryProvider: new Cesium.IonImageryProvider({ assetId: 2 }),
    });

    viewer.scene.globe.enableLighting = true;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.fog.enabled = true;

    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.globe.translucency.enabled = false;

    viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
    viewer.scene.orderIndependentTranslucency = true;

    const initialView = getInitialView();
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        initialView.longitude,
        initialView.latitude,
        initialView.height
      ),
      orientation: {
        heading: Cesium.Math.toRadians(initialView.heading),
        pitch: Cesium.Math.toRadians(initialView.pitch),
        roll: 0,
      },
      duration: 2,
    });

    loadBuildingsTileset(viewer);

    viewerRef.current = viewer;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((movement: any) => {
      const pickedFeature = viewer.scene.pick(movement.position);
      
      if (pickedFeature && typeof pickedFeature.id === 'string') {
        const pipelineId = pickedFeature.id as string;
        const segment = pipelineSegments.find((p) => p.id === pipelineId);
        
        if (segment) {
          if (burstState.isActive) {
            onPipelineSelect(null);
          } else {
            onPipelineSelect(
              burstState.selectedPipelineId === pipelineId ? null : pipelineId
            );
          }
        }
      } else {
        if (!burstState.isActive) {
          onPipelineSelect(null);
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction(() => {
      onXrayToggle(!isXrayMode);
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    handlerRef.current = handler;

    return () => {
      if (handlerRef.current) {
        handlerRef.current.destroy();
      }
      if (particleSystemRef.current) {
        viewer.scene.primitives.remove(particleSystemRef.current);
      }
      if (burstPointEntityRef.current) {
        viewer.entities.remove(burstPointEntityRef.current);
      }
      if (waterSpreadPrimitiveRef.current) {
        viewer.scene.primitives.remove(waterSpreadPrimitiveRef.current);
      }
      if (waterSpreadAnimationRef.current) {
        cancelAnimationFrame(waterSpreadAnimationRef.current);
      }
      primitivesRef.current.forEach((primitive) => {
        viewer.scene.primitives.remove(primitive);
      });
      valveEntitiesRef.current.forEach((entity) => {
        viewer.entities.remove(entity);
      });
      if (selectedPipelinePrimitiveRef.current) {
        viewer.scene.primitives.remove(selectedPipelinePrimitiveRef.current);
      }
      if (tilesetRef.current) {
        viewer.scene.primitives.remove(tilesetRef.current);
      }
      viewer.destroy();
    };
  }, []);

  useEffect(() => {
    updatePipelinePrimitives();
  }, [updatePipelinePrimitives]);

  useEffect(() => {
    updateValveEntities();
  }, [updateValveEntities]);

  useEffect(() => {
    if (isXrayMode) {
      applyXrayMode();
    } else {
      disableXrayMode();
    }
  }, [isXrayMode, applyXrayMode, disableXrayMode]);

  useEffect(() => {
    if (burstState.isActive && burstState.burstPosition) {
      startBurstEffect();
    } else {
      stopBurstEffect();
    }
  }, [burstState.isActive, burstState.burstPosition, startBurstEffect, stopBurstEffect]);

  return (
    <div
      ref={cesiumContainerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
      }}
    />
  );
};

export default CesiumMap;
