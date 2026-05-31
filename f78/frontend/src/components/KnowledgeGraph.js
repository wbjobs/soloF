import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import { useQuery, gql } from '@apollo/client';
import { Spin, Card, Slider, Button, Space, Tag, Switch } from 'antd';
import * as THREE from 'three';

const GRAPH_DATA_QUERY = gql`
  query GetGraphData($limit: Int = 100) {
    graphData(limit: $limit) {
      nodes {
        id
        name
        category
        val
      }
      links {
        source
        target
        name
      }
    }
  }
`;

const categoryColors = {
  'Programming Language': '#1890ff',
  'Framework': '#52c41a',
  'Database': '#faad14',
  'Concept': '#722ed1',
  'Other': '#8c8c8c',
};

function createInstancedMeshes(nodes, scene) {
  const nodeCount = nodes.length;
  if (nodeCount === 0) return {};

  const geoms = new Map();
  const materials = new Map();
  const instancedMeshes = new Map();
  const colorMap = new Map();

  nodes.forEach(node => {
    const color = categoryColors[node.category] || categoryColors['Other'];
    colorMap.set(node.id, color);
    if (!geoms.has(node.category)) {
      geoms.set(node.category, new THREE.SphereGeometry(1, 8, 8));
      materials.set(node.category, new THREE.MeshLambertMaterial({
        color,
        transparent: true,
        opacity: 0.85,
      }));
      instancedMeshes.set(node.category, new THREE.InstancedMesh(
        geoms.get(node.category),
        materials.get(node.category),
        nodeCount
      ));
    }
  });

  const categoryCounts = new Map();
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  nodes.forEach((node, index) => {
    const category = node.category;
    const mesh = instancedMeshes.get(category);
    const count = categoryCounts.get(category) || 0;

    const scale = Math.max(0.5, Math.sqrt(node.val) * 0.5);
    dummy.scale.set(scale, scale, scale);
    dummy.position.set(
      (Math.random() - 0.5) * 100,
      (Math.random() - 0.5) * 100,
      (Math.random() - 0.5) * 100
    );
    dummy.updateMatrix();

    mesh.setMatrixAt(count, dummy.matrix);
    mesh.setColorAt(count, color.set(categoryColors[category] || categoryColors['Other']));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    categoryCounts.set(category, count + 1);
    node.__instancedIndex = count;
    node.__mesh = mesh;
  });

  instancedMeshes.forEach((mesh, category) => {
    mesh.count = categoryCounts.get(category) || 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
  });

  return { instancedMeshes, colorMap };
}

function KnowledgeGraph({ onNodeClick, highlightedNodeIds = [], highlightedLinkIds = [] }) {
  const graphRef = useRef();
  const sceneRef = useRef(null);
  const instancedDataRef = useRef(null);
  const [limit, setLimit] = useState(100);
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [useInstanced, setUseInstanced] = useState(true);
  const [showGlow, setShowGlow] = useState(false);
  const [fps, setFps] = useState(60);
  const fpsRef = useRef({ lastTime: performance.now(), frameCount: 0 });
  const highlightColor = '#ff4757';

  const { loading, data } = useQuery(GRAPH_DATA_QUERY, {
    variables: { limit },
    pollInterval: 30000,
  });

  const forceEngineConfig = useMemo(() => ({
    alphaDecay: 0.02,
    velocityDecay: 0.4,
    linkDistance: (link) => {
      const sourceVal = link.source?.val || 1;
      const targetVal = link.target?.val || 1;
      return 30 + Math.max(10, 100 - (sourceVal + targetVal) * 2);
    },
    linkStrength: 0.6,
    chargeStrength: (node) => -30 - (node.val || 1) * 5,
    gravity: 0.05,
  }), []);

  useEffect(() => {
    const measureFps = () => {
      const now = performance.now();
      fpsRef.current.frameCount++;
      if (now - fpsRef.current.lastTime >= 1000) {
        setFps(fpsRef.current.frameCount);
        fpsRef.current.frameCount = 0;
        fpsRef.current.lastTime = now;
      }
      requestAnimationFrame(measureFps);
    };
    const id = requestAnimationFrame(measureFps);
    return () => cancelAnimationFrame(id);
  }, []);

  const highlightedNodeSet = useMemo(() => new Set(highlightedNodeIds), [highlightedNodeIds]);
  const highlightedLinkSet = useMemo(() => new Set(highlightedLinkIds), [highlightedLinkIds]);

  useEffect(() => {
    if (data?.graphData) {
      const nodes = data.graphData.nodes.map(node => {
        const baseColor = categoryColors[node.category] || categoryColors['Other'];
        const isHighlighted = highlightedNodeSet.has(node.id);
        return {
          ...node,
          val: Math.max(1, node.val),
          color: isHighlighted ? highlightColor : baseColor,
          isHighlighted,
        };
      });

      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const links = data.graphData.links
        .filter(link => nodeMap.has(link.source) && nodeMap.has(link.target))
        .slice(0, limit * 3)
        .map(link => {
          const linkId = `${link.source}-${link.target}`;
          const reverseId = `${link.target}-${link.source}`;
          const isHighlighted = highlightedLinkSet.has(linkId) || highlightedLinkSet.has(reverseId);
          return {
            ...link,
            source: link.source,
            target: link.target,
            color: isHighlighted ? highlightColor : '#444',
            isHighlighted,
          };
        });

      setGraphData({ nodes, links });
    }
  }, [data, limit, highlightedNodeSet, highlightedLinkSet, highlightColor]);

  const handleNodeClick = useCallback((node) => {
    setSelectedNode(node);
    if (onNodeClick) {
      onNodeClick(node);
    }

    if (graphRef.current) {
      const distance = 40;
      const distRatio = 1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
      graphRef.current.cameraPosition(
        {
          x: (node.x || 0) * distRatio,
          y: (node.y || 0) * distRatio,
          z: (node.z || 0) * distRatio
        },
        node,
        1000
      );
    }
  }, [onNodeClick]);

  const handleNodeHover = useCallback((node) => {
    if (graphRef.current) {
      graphRef.current.canvas().style.cursor = node ? 'pointer' : 'default';
    }
  }, []);

  const sharedGeometry = useMemo(() => new THREE.SphereGeometry(1, 8, 8), []);

  const nodeThreeObject = useCallback((node) => {
    const scale = Math.max(0.5, Math.sqrt(node.val) * 0.5);
    const color = categoryColors[node.category] || categoryColors['Other'];

    const group = new THREE.Group();

    const material = new THREE.MeshLambertMaterial({
      color,
      transparent: true,
      opacity: 0.85,
    });

    const sphere = new THREE.Mesh(sharedGeometry, material);
    sphere.scale.set(scale, scale, scale);
    group.add(sphere);

    if (showGlow) {
      const glowMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.15,
      });
      const glow = new THREE.Mesh(sharedGeometry, glowMaterial);
      glow.scale.set(scale * 1.3, scale * 1.3, scale * 1.3);
      group.add(glow);
    }

    return group;
  }, [showGlow, sharedGeometry]);

  const nodeCanvasObject = useCallback((node, ctx, globalScale) => {
    const label = node.name;
    const fontSize = 12 / globalScale;
    ctx.font = `${fontSize}px Sans-Serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillText(label, node.x, node.y - 8);
  }, []);

  const resetView = useCallback(() => {
    if (graphRef.current) {
      graphRef.current.zoomToFit(1000, 50);
    }
    setSelectedNode(null);
  }, []);

  const handleEngineTick = useCallback(() => {
    if (instancedDataRef.current && graphRef.current) {
      const { nodes } = graphData;
      const dummy = new THREE.Object3D();

      nodes.forEach(node => {
        if (node.__mesh && node.__instancedIndex !== undefined) {
          const scale = Math.max(0.5, Math.sqrt(node.val) * 0.5);
          dummy.position.set(node.x || 0, node.y || 0, node.z || 0);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          node.__mesh.setMatrixAt(node.__instancedIndex, dummy.matrix);
        }
      });

      instancedDataRef.current.instancedMeshes.forEach(mesh => {
        mesh.instanceMatrix.needsUpdate = true;
      });
    }
  }, [graphData]);

  useEffect(() => {
    if (graphRef.current && useInstanced && graphData.nodes.length > 0) {
      const scene = graphRef.current.scene();
      if (sceneRef.current !== scene) {
        if (instancedDataRef.current) {
          instancedDataRef.current.instancedMeshes.forEach(mesh => {
            scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
          });
        }
        instancedDataRef.current = createInstancedMeshes(graphData.nodes, scene);
        sceneRef.current = scene;
      }
    }
  }, [useInstanced, graphData.nodes]);

  if (loading && graphData.nodes.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Spin size="large" tip="加载知识图谱中..." />
      </div>
    );
  }

  const fpsColor = fps >= 30 ? 'text-green-500' : fps >= 15 ? 'text-yellow-500' : 'text-red-500';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Card
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 100,
          width: 320,
        }}
        size="small"
        title={`图谱控制 | FPS: <span className="${fpsColor}">${fps}</span>`}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <div>
            <div style={{ marginBottom: 8 }}>节点数量: {limit}</div>
            <Slider
              min={10}
              max={1000}
              step={10}
              value={limit}
              onChange={setLimit}
            />
          </div>
          <div>
            <Space>
              <span>硬件加速:</span>
              <Switch checked={useInstanced} onChange={setUseInstanced} size="small" />
            </Space>
          </div>
          <div>
            <Space>
              <span>显示光晕:</span>
              <Switch checked={showGlow} onChange={setShowGlow} size="small" disabled={useInstanced} />
            </Space>
          </div>
          <Button onClick={resetView} block size="small">重置视角</Button>
          <div>
            <div style={{ marginBottom: 8 }}>图例:</div>
            {Object.entries(categoryColors).map(([cat, color]) => (
              <Tag key={cat} color={color} style={{ marginBottom: 4, fontSize: 11 }}>
                {cat}
              </Tag>
            ))}
          </div>
        </Space>
      </Card>

      {selectedNode && (
        <Card
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            zIndex: 100,
            width: 280,
          }}
          size="small"
          title="节点详情"
          extra={<Button size="small" onClick={() => setSelectedNode(null)}>关闭</Button>}
        >
          <p style={{ margin: '4px 0' }}><strong>名称:</strong> {selectedNode.name}</p>
          <p style={{ margin: '4px 0' }}><strong>分类:</strong> {selectedNode.category}</p>
          <p style={{ margin: '4px 0' }}><strong>出现次数:</strong> {selectedNode.val}</p>
          <p style={{ margin: '4px 0' }}><strong>坐标:</strong> ({selectedNode.x?.toFixed(1)}, {selectedNode.y?.toFixed(1)}, {selectedNode.z?.toFixed(1)})</p>
        </Card>
      )}

      <ForceGraph3D
        ref={graphRef}
        graphData={graphData}
        nodeLabel="name"
        nodeVal={(node) => Math.max(1, Math.sqrt(node.val) * 0.5)}
        nodeColor="color"
        nodeThreeObject={!useInstanced ? nodeThreeObject : undefined}
        nodeOpacity={0.85}
        nodeResolution={8}
        linkColor="color"
        linkOpacity={0.3}
        linkWidth={1}
        linkResolution={2}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onEngineTick={useInstanced ? handleEngineTick : undefined}
        backgroundColor="#1a1a2e"
        showNavInfo={false}
        dagMode={graphData.nodes.length < 200 ? "radialin" : undefined}
        dagLevelDistance={50}
        cooldownTicks={100}
        cooldownTime={3000}
        warmupTicks={50}
        height={window.innerHeight - 64}
        width={window.innerWidth}
        {...forceEngineConfig}
      />
    </div>
  );
}

export default KnowledgeGraph;
