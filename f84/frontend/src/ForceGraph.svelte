<script>
  import { onMount, onDestroy, tick } from 'svelte'
  import { createEventDispatcher } from 'svelte'

  export let nodes = []
  export let edges = []
  export let selectedFile = null
  export let predictedFiles = new Set()
  export let predictionScores = new Map()

  const dispatch = createEventDispatcher()

  let container
  let svg
  let width = 0
  let height = 0
  let simulation = null
  let nodePositions = new Map()
  let displayNodes = []
  let d3Loaded = false
  let d3Force = null
  let d3Selection = null
  let d3Drag = null
  let resizeObserver = null

  function getNodeColor(node) {
    if (predictedFiles.has(node.id)) {
      const score = predictionScores.get(node.id)
      if (score) {
        const intensity = Math.max(0, 1 - (score.rank - 1) * 0.15)
        const purple = `rgba(139, 92, 246, ${intensity})`
        return purple
      }
      return '#8b5cf6'
    }
    if (node.is_external) return '#f59e0b'
    return '#10b981'
  }

  function getNodeRadius(node) {
    const base = edges.filter(e => e.source === node.id || e.target === node.id).length
    let radius = Math.min(30, 8 + base * 1.5)
    if (predictedFiles.has(node.id)) {
      const score = predictionScores.get(node.id)
      if (score) {
        radius = Math.max(radius, 14 + (6 - score.rank))
      } else {
        radius = Math.max(radius, 12)
      }
    }
    return radius
  }

  function getNodeLabel(node) {
    const path = node.id
    const parts = path.split('/')
    return parts[parts.length - 1]
  }

  function handleNodeClick(node) {
    dispatch('select', node)
  }

  async function initSimulation() {
    if (!d3Force || nodes.length === 0 || width === 0) return

    const simNodes = nodes.map(n => ({
      ...n,
      x: nodePositions.get(n.id)?.x || width / 2 + (Math.random() - 0.5) * 200,
      y: nodePositions.get(n.id)?.y || height / 2 + (Math.random() - 0.5) * 200
    }))

    const nodeIds = new Set(nodes.map(n => n.id))
    const simLinks = edges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({ source: e.source, target: e.target, type: e.type }))

    if (simulation) simulation.stop()

    simulation = d3Force.forceSimulation(simNodes)
      .force('link', d3Force.forceLink(simLinks).id(d => d.id).distance(120).strength(0.4))
      .force('charge', d3Force.forceManyBody().strength(-300))
      .force('center', d3Force.forceCenter(width / 2, height / 2))
      .force('collision', d3Force.forceCollide().radius(d => getNodeRadius(d) + 8))

    simulation.on('tick', () => {
      nodePositions = new Map(
        simNodes.map(n => [n.id, { x: n.x, y: n.y }])
      )
      displayNodes = [...simNodes]
    })
  }

  function setupDrag() {
    if (!d3Selection || !d3Drag || !svg || displayNodes.length === 0) return

    const d3Svg = d3Selection.select(svg)

    const drag = d3Drag.drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (event, d) => {
        d.fx = event.x
        d.fy = event.y
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null
        d.fy = null
      })

    d3Svg.selectAll('.node-group').data(displayNodes, d => d.id).call(drag)
  }

  function measureContainer() {
    if (container) {
      width = container.clientWidth
      height = container.clientHeight
    }
  }

  async function loadD3() {
    if (d3Loaded) return
    ;[d3Force, d3Selection, d3Drag] = await Promise.all([
      import('d3-force'),
      import('d3-selection'),
      import('d3-drag')
    ])
    d3Loaded = true
  }

  onMount(async () => {
    measureContainer()
    await loadD3()
    await initSimulation()
    await tick()
    setupDrag()

    resizeObserver = new ResizeObserver(() => {
      measureContainer()
      if (simulation) {
        simulation.force('center', d3Force.forceCenter(width / 2, height / 2))
        simulation.alpha(0.3).restart()
      }
    })
    if (container) resizeObserver.observe(container)
  })

  onDestroy(() => {
    if (simulation) simulation.stop()
    if (resizeObserver) resizeObserver.disconnect()
  })

  $: if (d3Loaded && nodes.length > 0 && width > 0) {
    initSimulation().then(() => {
      tick().then(setupDrag)
    })
  }
</script>

<div class="graph-container" bind:this={container}>
  <svg bind:this={svg} width="100%" height="100%">
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#555" />
      </marker>
    </defs>

    <g class="links">
      {#each edges as edge (edge.source + '->' + edge.target)}
        {@const sourcePos = nodePositions.get(edge.source)}
        {@const targetPos = nodePositions.get(edge.target)}
        {#if sourcePos && targetPos}
          <line
            class="link"
            x1={sourcePos.x}
            y1={sourcePos.y}
            x2={targetPos.x}
            y2={targetPos.y}
            stroke={edge.type === 'reexport' ? '#f59e0b' : edge.type === 'dynamic_import' ? '#8b5cf6' : '#4a5568'}
            stroke-width={edge.type === 'reexport' ? 2 : 1}
            stroke-dasharray={edge.type === 'dynamic_import' ? '5,5' : ''}
            opacity="0.5"
          />
        {/if}
      {/each}
    </g>

    <g class="nodes">
      {#each displayNodes as node (node.id)}
        <g
          class="node-group"
          transform={`translate(${node.x}, ${node.y})`}
          class:selected={selectedFile && selectedFile.id === node.id}
          class:predicted={predictedFiles.has(node.id)}
          on:click={() => handleNodeClick(node)}
        >
          {#if predictedFiles.has(node.id)}
            <circle
              r={getNodeRadius(node) + 4}
              fill="none"
              stroke="#8b5cf6"
              stroke-width="2"
              stroke-dasharray="4,2"
              class="prediction-ring"
            />
          {/if}
          <circle
            r={getNodeRadius(node)}
            fill={getNodeColor(node)}
            stroke={selectedFile && selectedFile.id === node.id ? '#e94560' : '#1a1a2e'}
            stroke-width={selectedFile && selectedFile.id === node.id ? 3 : 1.5}
          />
          {#if getNodeRadius(node) > 14}
            <text
              text-anchor="middle"
              dy="4"
              font-size="10"
              font-family="monospace"
              fill="#fff"
              pointer-events="none"
            >
              {getNodeLabel(node)}
            </text>
          {/if}
          {#if predictedFiles.has(node.id)}
            {#const score = predictionScores.get(node.id)}
            {#if score}
              <g class="prediction-badge" transform={`translate(${getNodeRadius(node) - 2}, ${-getNodeRadius(node) + 2})`}>
                <circle r="8" fill="#8b5cf6" stroke="#fff" stroke-width="1" />
                <text
                  text-anchor="middle"
                  dy="3"
                  font-size="9"
                  font-weight="bold"
                  fill="#fff"
                  pointer-events="none"
                >
                  {score.rank}
                </text>
              </g>
            {/if}
          {/if}
          <title>{node.id}{#if predictedFiles.has(node.id)} - 预测影响排名 {predictionScores.get(node.id)?.rank}{/if}</title>
        </g>
      {/each}
    </g>
  </svg>

  <div class="legend">
    <div class="legend-title">图例</div>
    <div class="legend-row">
      <span class="dot" style="background:#10b981"></span>
      <span>项目文件</span>
    </div>
    <div class="legend-row">
      <span class="dot" style="background:#f59e0b"></span>
      <span>外部包</span>
    </div>
    {#if predictedFiles.size > 0}
      <div class="legend-row">
        <span class="dot" style="background:#8b5cf6"></span>
        <span>预测影响</span>
      </div>
    {/if}
    <div class="legend-row">
      <span class="line-solid"></span>
      <span>import</span>
    </div>
    <div class="legend-row">
      <span class="line-bold" style="background:#f59e0b"></span>
      <span>reexport</span>
    </div>
    <div class="legend-row">
      <span class="line-dashed"></span>
      <span>dynamic</span>
    </div>
  </div>
</div>

<style>
  .graph-container {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
  }

  svg {
    display: block;
  }

  .link {
    fill: none;
    pointer-events: none;
  }

  .node-group {
    cursor: grab;
    transition: stroke 0.15s, stroke-width 0.15s;
  }

  .node-group:active {
    cursor: grabbing;
  }

  .node-group.predicted .prediction-ring {
    animation: rotate 8s linear infinite;
    transform-origin: center;
  }

  @keyframes rotate {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .prediction-badge {
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.1); }
  }

  .node-group.predicted:hover circle {
    stroke: #8b5cf6;
    stroke-width: 2;
  }

  .node-group.selected circle {
    stroke: #e94560;
    stroke-width: 3;
  }

  .legend {
    position: absolute;
    bottom: 16px;
    left: 16px;
    background: rgba(22, 33, 62, 0.95);
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 11px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid #0f3460;
  }

  .legend-title {
    font-weight: 600;
    font-size: 12px;
    margin-bottom: 4px;
    color: #aaa;
  }

  .legend-row {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #ccc;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
  }

  .line-solid {
    width: 18px;
    height: 2px;
    background: #4a5568;
    display: inline-block;
  }

  .line-bold {
    width: 18px;
    height: 2px;
    background: #f59e0b;
    display: inline-block;
  }

  .line-dashed {
    width: 18px;
    height: 0;
    border-top: 2px dashed #8b5cf6;
    display: inline-block;
  }
</style>
