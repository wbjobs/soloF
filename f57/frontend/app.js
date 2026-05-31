const API_BASE = 'http://localhost:5000/api';

const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

let graphData = null;
let simulation = null;
let canvas = null;
let ctx = null;
let width = 0;
let height = 0;

let transform = { x: 0, y: 0, k: 1 };
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let selectedNode = null;
let hoveredNode = null;

let animationId = null;
let lastFrameTime = 0;
let fps = 0;
let frameCount = 0;
let lastFpsUpdate = 0;

const PERFORMANCE_THRESHOLDS = {
    LOW: 200,
    MEDIUM: 500,
    HIGH: 1000
};

let renderConfig = {
    showEdges: true,
    showLabels: false,
    showArrows: false,
    showGlow: false,
    edgeOpacity: 0.3,
    nodeMinRadius: 2,
    nodeMaxRadius: 12
};

let timeline = {
    timeSlices: [],
    currentIndex: 0,
    isPlaying: false,
    playInterval: null,
    playSpeed: 1000,
    windowSize: 10,
    timeRange: null,
    snapshotCache: new Map()
};

document.addEventListener('DOMContentLoaded', () => {
    initCanvas();
    initEventListeners();
    initTimeline();
    loadGraphData();
});

function initCanvas() {
    const container = document.querySelector('.graph-container');
    canvas = document.getElementById('graphCanvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'graphCanvas';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        container.appendChild(canvas);

        const svg = document.getElementById('graphSvg');
        if (svg) svg.remove();
    }

    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    const container = document.querySelector('.graph-container');
    const dpr = window.devicePixelRatio || 1;
    width = container.clientWidth;
    height = container.clientHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    ctx.scale(dpr, dpr);
}

function initEventListeners() {
    document.getElementById('refreshBtn').addEventListener('click', loadGraphData);
    document.getElementById('generateBtn').addEventListener('click', generateNewData);
    document.getElementById('closeNodeInfo').addEventListener('click', closeNodeInfo);

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDoubleClick);
}

function initTimeline() {
    const playBtn = document.getElementById('playBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const resetBtn = document.getElementById('resetBtn');
    const slider = document.getElementById('timelineSlider');
    const speedSelect = document.getElementById('speedSelect');

    playBtn.addEventListener('click', togglePlay);
    prevBtn.addEventListener('click', prevFrame);
    nextBtn.addEventListener('click', nextFrame);
    resetBtn.addEventListener('click', resetTimeline);
    slider.addEventListener('input', onSliderChange);
    speedSelect.addEventListener('change', (e) => {
        timeline.playSpeed = parseInt(e.target.value);
        if (timeline.isPlaying) {
            stopPlayback();
            startPlayback();
        }
    });
}

async function loadTimelineData() {
    try {
        const [timeRange, slices] = await Promise.all([
            fetchData('/time/range'),
            fetchData('/time/slices?count=20')
        ]);

        timeline.timeRange = timeRange;
        timeline.timeSlices = slices.slices;
        timeline.snapshotCache.clear();

        const slider = document.getElementById('timelineSlider');
        slider.max = Math.max(0, timeline.timeSlices.length - 1);
        slider.value = 0;

        renderTimelineMarkers();
        updateTimeRangeLabel();

        if (timeline.timeSlices.length > 0) {
            await loadSnapshot(0);
        }
    } catch (error) {
        console.error('Error loading timeline data:', error);
    }
}

function renderTimelineMarkers() {
    const container = document.getElementById('timelineMarkers');
    container.innerHTML = '';

    const step = Math.max(1, Math.floor(timeline.timeSlices.length / 5));
    timeline.timeSlices.forEach((slice, index) => {
        if (index % step === 0 || index === timeline.timeSlices.length - 1) {
            const marker = document.createElement('div');
            marker.className = 'timeline-marker';
            marker.textContent = slice.label;
            container.appendChild(marker);
        }
    });
}

function updateTimeRangeLabel() {
    const label = document.getElementById('timeRangeLabel');
    if (timeline.timeRange && timeline.timeRange.min_time) {
        const start = new Date(timeline.timeRange.min_time);
        const end = new Date(timeline.timeRange.max_time);
        label.textContent = `时间范围: ${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}`;
    }
}

function updateCurrentDataInfo(data) {
    const info = document.getElementById('currentDataInfo');
    if (data && data.statistics) {
        info.textContent = `节点: ${data.statistics.total_nodes} | 边: ${data.statistics.display_edges || data.statistics.total_edges}`;
    }
}

async function loadSnapshot(index) {
    if (index < 0 || index >= timeline.timeSlices.length) return;

    timeline.currentIndex = index;

    const slider = document.getElementById('timelineSlider');
    slider.value = index;

    const slice = timeline.timeSlices[index];
    document.getElementById('timeLabel').textContent = slice.label;

    let snapshot = timeline.snapshotCache.get(index);
    if (!snapshot) {
        const nextIndex = Math.min(index + 1, timeline.timeSlices.length - 1);
        const endTime = timeline.timeSlices[nextIndex].time;

        try {
            snapshot = await fetchData(`/graph/snapshot?start=${slice.time}&end=${endTime}`);
            timeline.snapshotCache.set(index, snapshot);
        } catch (error) {
            console.error('Error loading snapshot:', error);
            return;
        }
    }

    if (snapshot.nodes && snapshot.nodes.length > 0) {
        graphData = snapshot;
        updateStatistics(snapshot.statistics);
        updateCurrentDataInfo(snapshot);
        updateRenderConfig(snapshot.statistics.total_nodes);
        initSimulation(snapshot);

        const topPagerank = [...snapshot.nodes]
            .sort((a, b) => b.pagerank - a.pagerank)
            .slice(0, 10);
        renderTopPagerank(topPagerank);
    } else {
        updateCurrentDataInfo({ statistics: { total_nodes: 0, total_edges: 0 } });
        if (simulation) simulation.stop();
    }
}

function togglePlay() {
    if (timeline.isPlaying) {
        stopPlayback();
    } else {
        startPlayback();
    }
}

function startPlayback() {
    if (timeline.timeSlices.length === 0) return;

    timeline.isPlaying = true;
    document.getElementById('playBtn').classList.add('playing');
    document.getElementById('playBtn').innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
        </svg>
    `;

    timeline.playInterval = setInterval(() => {
        if (timeline.currentIndex >= timeline.timeSlices.length - 1) {
            timeline.currentIndex = -1;
        }
        nextFrame();
    }, timeline.playSpeed);
}

function stopPlayback() {
    timeline.isPlaying = false;
    document.getElementById('playBtn').classList.remove('playing');
    document.getElementById('playBtn').innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
        </svg>
    `;

    if (timeline.playInterval) {
        clearInterval(timeline.playInterval);
        timeline.playInterval = null;
    }
}

function prevFrame() {
    const newIndex = timeline.currentIndex > 0 ? timeline.currentIndex - 1 : timeline.timeSlices.length - 1;
    loadSnapshot(newIndex);
}

function nextFrame() {
    const newIndex = timeline.currentIndex < timeline.timeSlices.length - 1 ? timeline.currentIndex + 1 : 0;
    loadSnapshot(newIndex);
}

function resetTimeline() {
    stopPlayback();
    loadSnapshot(0);
    transform = { x: 0, y: 0, k: 1 };
}

function onSliderChange(e) {
    const index = parseInt(e.target.value);
    if (index !== timeline.currentIndex) {
        loadSnapshot(index);
    }
}

async function fetchData(endpoint) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

async function loadGraphData() {
    try {
        showLoading();

        const communities = await fetchData('/communities');
        renderCommunities(communities.communities);

        await loadTimelineData();
    } catch (error) {
        showError('加载数据失败，请确保后端服务已启动');
        console.error('Error loading data:', error);
    }
}

function updateRenderConfig(nodeCount) {
    if (nodeCount > PERFORMANCE_THRESHOLDS.HIGH) {
        renderConfig = {
            showEdges: true,
            showLabels: false,
            showArrows: false,
            showGlow: false,
            edgeOpacity: 0.15,
            nodeMinRadius: 1.5,
            nodeMaxRadius: 8
        };
    } else if (nodeCount > PERFORMANCE_THRESHOLDS.MEDIUM) {
        renderConfig = {
            showEdges: true,
            showLabels: false,
            showArrows: false,
            showGlow: true,
            edgeOpacity: 0.25,
            nodeMinRadius: 2,
            nodeMaxRadius: 10
        };
    } else if (nodeCount > PERFORMANCE_THRESHOLDS.LOW) {
        renderConfig = {
            showEdges: true,
            showLabels: false,
            showArrows: true,
            showGlow: true,
            edgeOpacity: 0.4,
            nodeMinRadius: 3,
            nodeMaxRadius: 15
        };
    } else {
        renderConfig = {
            showEdges: true,
            showLabels: true,
            showArrows: true,
            showGlow: true,
            edgeOpacity: 0.6,
            nodeMinRadius: 5,
            nodeMaxRadius: 25
        };
    }
}

async function generateNewData() {
    if (!confirm('确定要生成新的模拟数据吗？这将覆盖现有数据。')) return;

    stopPlayback();

    try {
        const btn = document.getElementById('generateBtn');
        btn.textContent = '生成中...';
        btn.disabled = true;

        const response = await fetch(`${API_BASE}/generate-data`, { method: 'POST' });
        if (response.ok) {
            const result = await response.json();
            alert(`成功生成 ${result.records_count} 条记录，其中异常记录 ${result.anomaly_count} 条`);
            loadGraphData();
        } else {
            throw new Error('生成数据失败');
        }
    } catch (error) {
        alert('生成数据失败: ' + error.message);
    } finally {
        const btn = document.getElementById('generateBtn');
        btn.textContent = '生成新数据';
        btn.disabled = false;
    }
}

function showLoading() {
    document.getElementById('topPagerankList').innerHTML = '<p class="loading">加载中...</p>';
    document.getElementById('communityList').innerHTML = '<p class="loading">加载中...</p>';
}

function showError(message) {
    document.getElementById('topPagerankList').innerHTML = `<p class="error">${message}</p>`;
    document.getElementById('communityList').innerHTML = `<p class="error">${message}</p>`;
}

function updateStatistics(stats) {
    document.getElementById('totalNodes').textContent = stats.total_nodes;
    const edgesDisplay = stats.display_edges
        ? `${stats.display_edges.toLocaleString()} / ${stats.total_edges.toLocaleString()}`
        : stats.total_edges.toLocaleString();
    document.getElementById('totalEdges').textContent = edgesDisplay;
    document.getElementById('totalCommunities').textContent = stats.num_communities;
    document.getElementById('anomalyNodes').textContent = stats.num_anomaly_nodes || 0;
}

function renderTopPagerank(nodes) {
    const container = document.getElementById('topPagerankList');
    container.innerHTML = '';

    nodes.forEach((node, index) => {
        const item = document.createElement('div');
        item.className = 'pagerank-item';
        item.innerHTML = `
            <span class="rank">${index + 1}</span>
            <span class="ip">${node.id}</span>
            <span class="score">${node.pagerank.toFixed(4)}</span>
        `;
        item.addEventListener('click', () => focusOnNode(node.id));
        container.appendChild(item);
    });
}

function renderCommunities(communities) {
    const container = document.getElementById('communityList');
    container.innerHTML = '';

    communities.forEach(comm => {
        const item = document.createElement('div');
        item.className = 'community-item';
        const color = colorScale(comm.community_id);
        item.innerHTML = `
            <div class="community-color" style="background: ${color}"></div>
            <div class="community-info">
                <span>社区 ${comm.community_id}</span>
                <span>${comm.size} 节点</span>
            </div>
        `;
        container.appendChild(item);
    });
}

function initSimulation(data) {
    if (simulation) {
        simulation.stop();
    }
    if (animationId) {
        cancelAnimationFrame(animationId);
    }

    const nodes = data.nodes.map(d => ({ ...d }));
    const edges = data.edges.map(d => ({ ...d }));

    const maxPagerank = Math.max(...nodes.map(n => n.pagerank));
    const minPagerank = Math.min(...nodes.map(n => n.pagerank));
    const scaleRadius = d3.scaleLinear()
        .domain([minPagerank, maxPagerank])
        .range([renderConfig.nodeMinRadius, renderConfig.nodeMaxRadius]);

    nodes.forEach(n => {
        n.radius = scaleRadius(n.pagerank);
        n.color = n.is_anomaly ? '#ef4444' : colorScale(n.community);
    });

    const nodeCount = nodes.length;
    const linkDistance = Math.max(30, 100 - nodeCount * 0.1);
    const chargeStrength = Math.min(-100, -300 - nodeCount * 0.5);
    const collisionRadius = Math.max(5, 15 - nodeCount * 0.02);

    simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(edges).id(d => d.id).distance(linkDistance).strength(0.3))
        .force('charge', d3.forceManyBody().strength(chargeStrength))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => d.radius + collisionRadius))
        .alphaDecay(0.02)
        .velocityDecay(0.4)
        .on('tick', () => {
            nodes.forEach(n => {
                n.x = Math.max(n.radius, Math.min(width - n.radius, n.x));
                n.y = Math.max(n.radius, Math.min(height - n.radius, n.y));
            });
        });

    transform = { x: 0, y: 0, k: 1 };
    selectedNode = null;
    hoveredNode = null;

    startRenderLoop(nodes, edges);
}

function startRenderLoop(nodes, edges) {
    function render(currentTime) {
        animationId = requestAnimationFrame(render);

        frameCount++;
        if (currentTime - lastFpsUpdate >= 1000) {
            fps = Math.round(frameCount * 1000 / (currentTime - lastFpsUpdate));
            frameCount = 0;
            lastFpsUpdate = currentTime;
            updateFpsDisplay();
        }

        if (fps < 20 && graphData && graphData.statistics) {
            if (renderConfig.edgeOpacity > 0.1) {
                renderConfig.edgeOpacity = Math.max(0.1, renderConfig.edgeOpacity - 0.05);
            }
            if (renderConfig.showLabels && graphData.statistics.total_nodes > 100) {
                renderConfig.showLabels = false;
            }
        }

        draw(nodes, edges);
    }

    animationId = requestAnimationFrame(render);
}

function updateFpsDisplay() {
    let fpsEl = document.getElementById('fpsDisplay');
    if (!fpsEl) {
        fpsEl = document.createElement('div');
        fpsEl.id = 'fpsDisplay';
        fpsEl.style.cssText = `
            position: absolute;
            top: 10px;
            left: 10px;
            background: rgba(0,0,0,0.7);
            color: #00d4ff;
            padding: 4px 8px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 12px;
            z-index: 100;
            pointer-events: none;
        `;
        document.querySelector('.graph-container').appendChild(fpsEl);
    }
    fpsEl.textContent = `FPS: ${fps}`;
}

function draw(nodes, edges) {
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    if (renderConfig.showEdges) {
        drawEdges(edges);
    }

    drawNodes(nodes);

    if (renderConfig.showLabels) {
        drawLabels(nodes);
    }

    ctx.restore();
}

function drawEdges(edges) {
    ctx.lineWidth = 1;
    ctx.globalAlpha = renderConfig.edgeOpacity;

    const viewportPadding = 50;
    const minX = (-transform.x / transform.k) - viewportPadding;
    const maxX = ((-transform.x + width) / transform.k) + viewportPadding;
    const minY = (-transform.y / transform.k) - viewportPadding;
    const maxY = ((-transform.y + height) / transform.k) + viewportPadding;

    let batchNormal = [];
    let batchAnomaly = [];

    for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const sx = e.source.x;
        const sy = e.source.y;
        const tx = e.target.x;
        const ty = e.target.y;

        const inViewport = (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) ||
                          (tx >= minX && tx <= maxX && ty >= minY && ty <= maxY);
        if (!inViewport) continue;

        if (e.is_anomaly) {
            batchAnomaly.push([sx, sy, tx, ty]);
        } else {
            batchNormal.push([sx, sy, tx, ty]);
        }
    }

    ctx.beginPath();
    ctx.strokeStyle = '#3b82f6';
    for (let i = 0; i < batchNormal.length; i++) {
        const [sx, sy, tx, ty] = batchNormal[i];
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < batchAnomaly.length; i++) {
        const [sx, sy, tx, ty] = batchAnomaly[i];
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
    }
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
}

function drawNodes(nodes) {
    const viewportPadding = 50;
    const minX = (-transform.x / transform.k) - viewportPadding;
    const maxX = ((-transform.x + width) / transform.k) + viewportPadding;
    const minY = (-transform.y / transform.k) - viewportPadding;
    const maxY = ((-transform.y + height) / transform.k) + viewportPadding;

    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];

        if (n.x < minX || n.x > maxX || n.y < minY || n.y > maxY) continue;

        if (n.is_anomaly && renderConfig.showGlow) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.radius + 4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
            ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();

        if (n === hoveredNode || n === selectedNode) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            if (renderConfig.showGlow) {
                ctx.beginPath();
                ctx.arc(n.x, n.y, n.radius + 3, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }
}

function drawLabels(nodes) {
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n === hoveredNode || n === selectedNode || (n.pagerank > 0.02 && transform.k > 1.5)) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            const textWidth = ctx.measureText(n.id).width;
            ctx.fillRect(n.x - textWidth / 2 - 4, n.y - n.radius - 18, textWidth + 8, 14);

            ctx.fillStyle = '#ffffff';
            ctx.fillText(n.id, n.x, n.y - n.radius - 11);
        }
    }
}

function screenToWorld(sx, sy) {
    return {
        x: (sx - transform.x) / transform.k,
        y: (sy - transform.y) / transform.k
    };
}

function getNodeAtPosition(wx, wy) {
    if (!graphData || !simulation) return null;

    const nodes = simulation.nodes();
    const scale = transform.k;
    const hitRadius = Math.max(8, 15 / scale);

    let closest = null;
    let closestDist = Infinity;

    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const dx = n.x - wx;
        const dy = n.y - wy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < Math.max(n.radius, hitRadius) && dist < closestDist) {
            closest = n;
            closestDist = dist;
        }
    }

    return closest;
}

function onMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const pos = screenToWorld(sx, sy);

    const node = getNodeAtPosition(pos.x, pos.y);

    if (node && e.button === 0) {
        selectedNode = node;
        if (simulation) {
            simulation.alphaTarget(0.3).restart();
        }
        node.fx = node.x;
        node.fy = node.y;
    } else {
        isDragging = true;
        dragStart = { x: sx - transform.x, y: sy - transform.y };
    }

    canvas.style.cursor = node ? 'grabbing' : 'grabbing';
}

function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const pos = screenToWorld(sx, sy);

    if (selectedNode) {
        selectedNode.fx = pos.x;
        selectedNode.fy = pos.y;
    } else if (isDragging) {
        transform.x = sx - dragStart.x;
        transform.y = sy - dragStart.y;
    } else {
        const node = getNodeAtPosition(pos.x, pos.y);
        hoveredNode = node;
        canvas.style.cursor = node ? 'pointer' : 'grab';

        if (node) {
            showTooltip(node, e.clientX, e.clientY);
        } else {
            hideTooltip();
        }
    }
}

function onMouseUp() {
    if (selectedNode) {
        selectedNode.fx = null;
        selectedNode.fy = null;
        if (simulation) {
            simulation.alphaTarget(0);
        }
        selectedNode = null;
    }

    isDragging = false;
    canvas.style.cursor = 'grab';
}

function onWheel(e) {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const pos = screenToWorld(sx, sy);
    const delta = e.deltaY > 0 ? 0.9 : 1.1;

    transform.k = Math.max(0.1, Math.min(4, transform.k * delta));
    transform.x = sx - pos.x * transform.k;
    transform.y = sy - pos.y * transform.k;
}

function onClick(e) {
    if (isDragging) return;

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const pos = screenToWorld(sx, sy);

    const node = getNodeAtPosition(pos.x, pos.y);
    if (node) {
        showNodeDetail(node.id);
    }
}

function onDoubleClick(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const pos = screenToWorld(sx, sy);

    const node = getNodeAtPosition(pos.x, pos.y);
    if (node) {
        focusOnNode(node.id);
    } else {
        transform = { x: 0, y: 0, k: 1 };
    }
}

function focusOnNode(nodeId) {
    if (!simulation) return;

    const nodes = simulation.nodes();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const targetScale = 2;
    transform.x = width / 2 - node.x * targetScale;
    transform.y = height / 2 - node.y * targetScale;
    transform.k = targetScale;

    showNodeDetail(nodeId);
}

function showTooltip(node, clientX, clientY) {
    const tooltip = document.getElementById('tooltip');
    const graphContainer = document.querySelector('.graph-container');
    const rect = graphContainer.getBoundingClientRect();

    tooltip.innerHTML = `
        <div class="tooltip-title">${node.id}</div>
        <div class="tooltip-row">
            <span class="tooltip-label">PageRank:</span>
            <span>${node.pagerank.toFixed(6)}</span>
        </div>
        <div class="tooltip-row">
            <span class="tooltip-label">社区:</span>
            <span>${node.community}</span>
        </div>
        <div class="tooltip-row">
            <span class="tooltip-label">入度:</span>
            <span>${node.in_degree}</span>
        </div>
        <div class="tooltip-row">
            <span class="tooltip-label">出度:</span>
            <span>${node.out_degree}</span>
        </div>
        <div class="tooltip-row">
            <span class="tooltip-label">异常:</span>
            <span style="color: ${node.is_anomaly ? '#ef4444' : '#22c55e'}">${node.is_anomaly ? '是' : '否'}</span>
        </div>
    `;

    tooltip.style.left = (clientX - rect.left + 15) + 'px';
    tooltip.style.top = (clientY - rect.top - 10) + 'px';
    tooltip.classList.add('visible');
}

function hideTooltip() {
    document.getElementById('tooltip').classList.remove('visible');
}

async function showNodeDetail(ip) {
    try {
        const data = await fetchData(`/node/${encodeURIComponent(ip)}`);
        const panel = document.getElementById('nodeInfo');
        const content = document.getElementById('nodeInfoContent');

        const node = data.node;
        content.innerHTML = `
            <div class="info-row">
                <span class="info-label">IP 地址</span>
                <span class="info-value" style="font-family: 'Courier New', monospace;">${node.id}</span>
            </div>
            <div class="info-row">
                <span class="info-label">PageRank</span>
                <span class="info-value">${node.pagerank.toFixed(6)}</span>
            </div>
            <div class="info-row">
                <span class="info-label">社区 ID</span>
                <span class="info-value">
                    <span style="display: inline-block; width: 12px; height: 12px; background: ${colorScale(node.community)}; border-radius: 2px; margin-right: 4px;"></span>
                    ${node.community}
                </span>
            </div>
            <div class="info-row">
                <span class="info-label">入度</span>
                <span class="info-value">${node.in_degree}</span>
            </div>
            <div class="info-row">
                <span class="info-label">出度</span>
                <span class="info-value">${node.out_degree}</span>
            </div>
            <div class="info-row">
                <span class="info-label">总度数</span>
                <span class="info-value">${node.total_degree}</span>
            </div>
            <div class="info-row">
                <span class="info-label">异常节点</span>
                <span class="info-value" style="color: ${node.is_anomaly ? '#ef4444' : '#22c55e'}">${node.is_anomaly ? '是' : '否'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">关联边数</span>
                <span class="info-value">${data.related_edges.length}</span>
            </div>
        `;

        panel.classList.remove('hidden');
    } catch (error) {
        console.error('Error loading node detail:', error);
    }
}

function closeNodeInfo() {
    document.getElementById('nodeInfo').classList.add('hidden');
}
