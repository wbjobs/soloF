import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';

const styles = {
  container: {
    width: '100%',
    height: '600px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    backgroundColor: '#fafafa',
    position: 'relative',
    overflow: 'hidden',
  },
  tooltip: {
    position: 'absolute',
    padding: '6px 12px',
    backgroundColor: 'rgba(0,0,0,0.75)',
    color: 'white',
    borderRadius: '4px',
    fontSize: '12px',
    pointerEvents: 'none',
    zIndex: 100,
  },
  legend: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    padding: '8px 12px',
    backgroundColor: 'white',
    borderRadius: '4px',
    border: '1px solid #eee',
    fontSize: '12px',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: '4px',
  },
  legendColor: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    marginRight: '6px',
  },
};

export default function ForceGraph({
  nodes,
  edges,
  onNodeClick,
  highlightNodes = [],
  highlightEdges = [],
  selectedNode = null,
}) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [tooltip, setTooltip] = useState({ visible: false, text: '', x: 0, y: 0 });
  
  const simulationRef = useRef(null);
  const gRef = useRef(null);
  const zoomRef = useRef(null);
  const dataRef = useRef({ nodes: new Map(), edges: new Map() });
  const nodeGroupRef = useRef(null);
  const linkGroupRef = useRef(null);
  const labelGroupRef = useRef(null);
  const isInitializedRef = useRef(false);

  const nodeColorMap = useMemo(() => {
    const map = new Map();
    nodes.forEach(n => {
      if (highlightNodes.includes(n.id)) {
        map.set(n.id, '#ff6b6b');
      } else if (selectedNode === n.id) {
        map.set(n.id, '#4ecdc4');
      } else {
        map.set(n.id, '#667eea');
      }
    });
    return map;
  }, [nodes, highlightNodes, selectedNode]);

  const edgeColorMap = useMemo(() => {
    const map = new Map();
    edges.forEach(e => {
      map.set(e.id, highlightEdges.includes(e.id) ? '#ff6b6b' : '#b8c0ff');
    });
    return map;
  }, [edges, highlightEdges]);

  const getNodeRadius = useCallback((nodeId, edgeList) => {
    const degree = edgeList.filter(e => 
      (typeof e.from === 'object' ? e.from.id : e.from) === nodeId ||
      (typeof e.to === 'object' ? e.to.id : e.to) === nodeId
    ).length;
    return Math.max(8, Math.min(20, 8 + degree * 1.5));
  }, []);

  const drag = useCallback((simulation) => {
    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    return d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended);
  }, []);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    if (isInitializedRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g');
    gRef.current = g;

    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    zoomRef.current = zoom;
    svg.call(zoom);

    const arrowId = 'arrowhead';
    svg.append('defs').append('marker')
      .attr('id', arrowId)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#b8c0ff');

    const highlightArrowId = 'arrowhead-highlight';
    svg.append('defs').append('marker')
      .attr('id', highlightArrowId)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#ff6b6b');

    linkGroupRef.current = g.append('g').attr('class', 'links');
    nodeGroupRef.current = g.append('g').attr('class', 'nodes');
    labelGroupRef.current = g.append('g').attr('class', 'labels');

    const simulation = d3.forceSimulation()
      .force('link', d3.forceLink().id(d => d.id).distance(120).strength(0.8))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(35))
      .on('tick', () => {
        linkGroupRef.current?.selectAll('line')
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);

        nodeGroupRef.current?.selectAll('circle')
          .attr('cx', d => d.x)
          .attr('cy', d => d.y);

        labelGroupRef.current?.selectAll('text')
          .attr('x', d => d.x)
          .attr('y', d => d.y);
      });

    simulationRef.current = simulation;
    isInitializedRef.current = true;

    const handleResize = () => {
      if (!containerRef.current || !simulationRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      svg.attr('width', w).attr('height', h);
      simulationRef.current.force('center', d3.forceCenter(w / 2, h / 2));
      simulationRef.current.alpha(0.3).restart();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      simulation.stop();
    };
  }, []);

  useEffect(() => {
    if (!isInitializedRef.current || !simulationRef.current) return;
    if (nodes.length === 0) {
      nodeGroupRef.current?.selectAll('circle').remove();
      linkGroupRef.current?.selectAll('line').remove();
      labelGroupRef.current?.selectAll('text').remove();
      dataRef.current = { nodes: new Map(), edges: new Map() };
      return;
    }

    const simulation = simulationRef.current;
    const { nodes: oldNodesMap, edges: oldEdgesMap } = dataRef.current;

    const newNodesMap = new Map();
    nodes.forEach(n => {
      const existing = oldNodesMap.get(n.id);
      if (existing) {
        newNodesMap.set(n.id, { ...existing, name: n.name });
      } else {
        newNodesMap.set(n.id, { 
          id: n.id, 
          name: n.name,
          x: Math.random() * (containerRef.current?.clientWidth || 800),
          y: Math.random() * (containerRef.current?.clientHeight || 600),
        });
      }
    });

    const newEdgesMap = new Map();
    edges.forEach(e => {
      const fromId = typeof e.from === 'object' ? e.from.id : e.from;
      const toId = typeof e.to === 'object' ? e.to.id : e.to;
      const existing = oldEdgesMap.get(e.id);
      if (existing) {
        newEdgesMap.set(e.id, { ...existing, source: newNodesMap.get(fromId), target: newNodesMap.get(toId) });
      } else {
        newEdgesMap.set(e.id, {
          id: e.id,
          source: newNodesMap.get(fromId),
          target: newNodesMap.get(toId),
          weight: e.weight || 1.0,
        });
      }
    });

    dataRef.current = { nodes: newNodesMap, edges: newEdgesMap };

    const currentNodes = Array.from(newNodesMap.values());
    const currentEdges = Array.from(newEdgesMap.values());

    const nodeSelection = nodeGroupRef.current
      .selectAll('circle')
      .data(currentNodes, d => d.id);

    nodeSelection.exit().remove();

    const newNodes = nodeSelection.enter()
      .append('circle')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .call(drag(simulation))
      .on('mouseover', (event, d) => {
        setTooltip({
          visible: true,
          text: d.name,
          x: event.offsetX + 10,
          y: event.offsetY + 10,
        });
      })
      .on('mousemove', (event) => {
        setTooltip(prev => ({
          ...prev,
          x: event.offsetX + 10,
          y: event.offsetY + 10,
        }));
      })
      .on('mouseout', () => {
        setTooltip(prev => ({ ...prev, visible: false }));
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        if (onNodeClick) onNodeClick(d);
      });

    nodeSelection.merge(newNodes)
      .attr('r', d => getNodeRadius(d.id, currentEdges))
      .attr('fill', d => nodeColorMap.get(d.id) || '#667eea')
      .attr('opacity', d => highlightNodes.length > 0 ? (highlightNodes.includes(d.id) ? 1 : 0.15) : 1);

    const linkSelection = linkGroupRef.current
      .selectAll('line')
      .data(currentEdges, d => d.id);

    linkSelection.exit().remove();

    const newLinks = linkSelection.enter()
      .append('line')
      .attr('marker-end', d => highlightEdges.includes(d.id) ? 'url(#arrowhead-highlight)' : 'url(#arrowhead)');

    linkSelection.merge(newLinks)
      .attr('stroke', d => edgeColorMap.get(d.id) || '#b8c0ff')
      .attr('stroke-width', d => highlightEdges.includes(d.id) ? 3 : 1.5)
      .attr('opacity', d => highlightEdges.length > 0 ? (highlightEdges.includes(d.id) ? 1 : 0.15) : 0.6);

    const labelSelection = labelGroupRef.current
      .selectAll('text')
      .data(currentNodes, d => d.id);

    labelSelection.exit().remove();

    const newLabels = labelSelection.enter()
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', -15)
      .attr('font-size', '11px')
      .attr('fill', '#333')
      .text(d => d.name);

    labelSelection.merge(newLabels)
      .attr('opacity', d => highlightNodes.length > 0 ? (highlightNodes.includes(d.id) ? 1 : 0.15) : 1);

    simulation.nodes(currentNodes);
    simulation.force('link').links(currentEdges);
    simulation.alpha(0.3).restart();
  }, [nodes, edges, onNodeClick, drag, getNodeRadius, nodeColorMap, edgeColorMap, highlightNodes, highlightEdges]);

  useEffect(() => {
    if (!isInitializedRef.current) return;

    nodeGroupRef.current?.selectAll('circle')
      .attr('fill', d => nodeColorMap.get(d.id) || '#667eea')
      .attr('opacity', d => highlightNodes.length > 0 ? (highlightNodes.includes(d.id) ? 1 : 0.15) : 1);

    linkGroupRef.current?.selectAll('line')
      .attr('stroke', d => edgeColorMap.get(d.id) || '#b8c0ff')
      .attr('stroke-width', d => highlightEdges.includes(d.id) ? 3 : 1.5)
      .attr('opacity', d => highlightEdges.length > 0 ? (highlightEdges.includes(d.id) ? 1 : 0.15) : 0.6)
      .attr('marker-end', d => highlightEdges.includes(d.id) ? 'url(#arrowhead-highlight)' : 'url(#arrowhead)');

    labelGroupRef.current?.selectAll('text')
      .attr('opacity', d => highlightNodes.length > 0 ? (highlightNodes.includes(d.id) ? 1 : 0.15) : 1);
  }, [nodeColorMap, edgeColorMap, highlightNodes, highlightEdges]);

  return (
    <div ref={containerRef} style={styles.container}>
      <svg ref={svgRef}></svg>
      {tooltip.visible && (
        <div
          style={{
            ...styles.tooltip,
            left: tooltip.x,
            top: tooltip.y,
          }}
        >
          {tooltip.text}
        </div>
      )}
      <div style={styles.legend}>
        <div style={styles.legendItem}>
          <span style={{ ...styles.legendColor, backgroundColor: '#667eea' }}></span>
          <span>普通节点</span>
        </div>
        <div style={styles.legendItem}>
          <span style={{ ...styles.legendColor, backgroundColor: '#4ecdc4' }}></span>
          <span>选中节点</span>
        </div>
        <div style={styles.legendItem}>
          <span style={{ ...styles.legendColor, backgroundColor: '#ff6b6b' }}></span>
          <span>路径高亮</span>
        </div>
      </div>
    </div>
  );
}
