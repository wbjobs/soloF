const HeatmapRenderer = (function() {
    let currentZoom = 1;
    let currentColorScheme = 'classic';
    let cachedData = null;
    let xScale = null;
    let yScale = null;
    let cellWidth = 0;
    let cellHeight = 0;
    let margin = { top: 50, right: 30, bottom: 80, left: 100 };

    const colorSchemes = {
        classic: {
            'A→T': '#EF4444',
            'A→C': '#F59E0B',
            'A→G': '#22C55E',
            'T→A': '#3B82F6',
            'T→C': '#8B5CF6',
            'T→G': '#EC4899',
            'C→A': '#06B6D4',
            'C→T': '#84CC16',
            'C→G': '#F97316',
            'G→A': '#6366F1',
            'G→T': '#14B8A6',
            'G→C': '#A855F7'
        },
        viridis: null,
        plasma: null
    };

    function getColorScale(mutationTypes) {
        if (currentColorScheme === 'classic') {
            return d3.scaleOrdinal()
                .domain(mutationTypes)
                .range(Object.values(colorSchemes.classic));
        } else if (currentColorScheme === 'viridis') {
            return d3.scaleSequential(d3.interpolateViridis)
                .domain([0, mutationTypes.length]);
        } else {
            return d3.scaleSequential(d3.interpolatePlasma)
                .domain([0, mutationTypes.length]);
        }
    }

    function getColorForMutation(mutationType, colorScale, mutationTypes) {
        if (currentColorScheme === 'classic') {
            return colorSchemes.classic[mutationType] || '#6B7280';
        } else {
            const index = mutationTypes.indexOf(mutationType);
            return colorScale(index);
        }
    }

    function setupTooltip() {
        const tooltip = d3.select('#tooltip');
        
        return {
            show: function(event, data) {
                const [x, y] = d3.pointer(event, document.body);
                
                tooltip.classed('visible', true)
                    .style('left', (x + 15) + 'px')
                    .style('top', (y + 15) + 'px');
                
                const qualityColor = data.quality >= 80 ? '#22C55E' : 
                                     data.quality >= 60 ? '#F59E0B' : '#EF4444';
                
                tooltip.html(`
                    <div class="tooltip-title">${data.mutationType}</div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">样本ID</span>
                        <span class="tooltip-value">${data.sampleId}</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">基因位置</span>
                        <span class="tooltip-value">${data.position}</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">参考碱基</span>
                        <span class="tooltip-value">${data.refBase}</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">变异碱基</span>
                        <span class="tooltip-value">${data.altBase}</span>
                    </div>
                    <div class="quality-bar">
                        <div class="quality-fill" style="width: ${data.quality}%; background: ${qualityColor}"></div>
                    </div>
                    <div class="tooltip-row" style="margin-top: 4px;">
                        <span class="tooltip-label">质量值</span>
                        <span class="tooltip-value" style="color: ${qualityColor}">${data.quality}</span>
                    </div>
                `);
            },
            hide: function() {
                tooltip.classed('visible', false);
            },
            move: function(event) {
                const [x, y] = d3.pointer(event, document.body);
                tooltip.style('left', (x + 15) + 'px')
                       .style('top', (y + 15) + 'px');
            }
        };
    }

    function getSNPAtPosition(mouseX, mouseY, processedData) {
        if (!cachedData || !xScale || !yScale) return null;

        const data = processedData.rawData;
        const rect = document.getElementById('heatmapCanvas').getBoundingClientRect();
        
        const x = mouseX - rect.left - margin.left;
        const y = mouseY - rect.top - margin.top;

        if (x < 0 || y < 0) return null;

        const positions = data.positions.map(p => p.position);
        const sampleIds = data.samples.map(s => s.id);

        let hitPosition = null;
        let hitSample = null;

        for (let i = 0; i < positions.length; i++) {
            const cellX = xScale(positions[i]);
            if (x >= cellX && x <= cellX + cellWidth) {
                hitPosition = positions[i];
                break;
            }
        }

        for (let i = 0; i < sampleIds.length; i++) {
            const cellY = yScale(sampleIds[i]);
            if (y >= cellY && y <= cellY + cellHeight) {
                hitSample = data.samples[i];
                break;
            }
        }

        if (hitPosition && hitSample) {
            const snp = DataProcessor.getSNPForSampleAndPosition(hitSample, hitPosition);
            if (snp) {
                return {
                    sampleId: hitSample.id,
                    position: hitPosition,
                    refBase: snp.refBase,
                    altBase: snp.altBase,
                    mutationType: snp.mutationType,
                    quality: snp.quality
                };
            }
        }

        return null;
    }

    function renderHeatmap(processedData) {
        cachedData = processedData;
        const data = processedData.rawData;
        const tooltip = setupTooltip();
        
        const container = document.getElementById('heatmapWrapper');
        const width = Math.max(container.clientWidth - 40, 1000) * currentZoom;
        const height = Math.max(1200, data.samples.length * 6) * currentZoom;
        
        const innerWidth = width - margin.left - margin.right;
        const innerHeight = height - margin.top - margin.bottom;

        const canvas = document.getElementById('heatmapCanvas');
        canvas.width = width * window.devicePixelRatio;
        canvas.height = height * window.devicePixelRatio;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

        ctx.fillStyle = '#1E293B';
        ctx.fillRect(0, 0, width, height);

        const sampleIds = data.samples.map(s => s.id);
        const positions = data.positions.map(p => p.position);

        xScale = d3.scaleBand()
            .domain(positions)
            .range([0, innerWidth])
            .padding(0.05);

        yScale = d3.scaleBand()
            .domain(sampleIds)
            .range([0, innerHeight])
            .padding(0.05);

        cellWidth = xScale.bandwidth();
        cellHeight = yScale.bandwidth();

        const mutationTypes = processedData.mutationCounts.map(m => m.type);
        const colorScale = getColorScale(mutationTypes);

        ctx.save();
        ctx.translate(margin.left, margin.top);

        ctx.fillStyle = '#334155';
        ctx.fillRect(0, 0, innerWidth, innerHeight);

        const colorCache = new Map();
        mutationTypes.forEach(type => {
            colorCache.set(type, getColorForMutation(type, colorScale, mutationTypes));
        });

        const positionIndexMap = new Map();
        data.positions.forEach((pos, idx) => {
            positionIndexMap.set(pos.position, idx);
        });

        for (let i = 0; i < data.samples.length; i++) {
            const sample = data.samples[i];
            const y = yScale(sample.id);

            for (let j = 0; j < sample.snps.length; j++) {
                const snp = sample.snps[j];
                const posIdx = positionIndexMap.get(snp.position);
                if (posIdx !== undefined) {
                    const x = xScale(snp.position);
                    const color = colorCache.get(snp.mutationType) || '#6B7280';
                    ctx.fillStyle = color;
                    ctx.fillRect(x, y, cellWidth, cellHeight);
                }
            }
        }

        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, innerWidth, innerHeight);

        ctx.restore();

        ctx.save();
        ctx.translate(margin.left, margin.top);

        ctx.fillStyle = '#94A3B8';
        ctx.font = '11px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        for (let i = 0; i < sampleIds.length; i += Math.max(1, Math.floor(sampleIds.length / 20))) {
            const y = yScale(sampleIds[i]) + cellHeight / 2;
            ctx.fillText(sampleIds[i], -5, y);
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        for (let i = 0; i < positions.length; i += Math.max(1, Math.floor(positions.length / 15))) {
            const x = xScale(positions[i]) + cellWidth / 2;
            ctx.save();
            ctx.translate(x, innerHeight + 5);
            ctx.rotate(-Math.PI / 4);
            ctx.fillText(positions[i].toString(), 0, 0);
            ctx.restore();
        }

        ctx.fillStyle = '#F1F5F9';
        ctx.font = '14px system-ui, -apple-system, sans-serif';
        ctx.fontWeight = '600';

        ctx.save();
        ctx.translate(-50, innerHeight / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('样本ID', 0, 0);
        ctx.restore();

        ctx.fillText('基因位置', innerWidth / 2, innerHeight + 60);

        ctx.restore();

        canvas.onmousemove = function(event) {
            const snpData = getSNPAtPosition(event.clientX, event.clientY, processedData);
            if (snpData) {
                tooltip.show(event, snpData);
            } else {
                tooltip.hide();
            }
        };

        canvas.onmouseout = function() {
            tooltip.hide();
        };

        return colorScale;
    }

    function setZoom(zoomLevel) {
        currentZoom = Math.max(0.5, Math.min(3, zoomLevel));
    }

    function getZoom() {
        return currentZoom;
    }

    function setColorScheme(scheme) {
        currentColorScheme = scheme;
    }

    function getColorScheme() {
        return currentColorScheme;
    }

    return {
        renderHeatmap: renderHeatmap,
        setZoom: setZoom,
        getZoom: getZoom,
        setColorScheme: setColorScheme,
        getColorScheme: getColorScheme
    };
})();
