(function() {
    let rawData = null;
    let originalSamples = null;
    let processedData = null;
    let isClustered = false;

    function initialize() {
        generateAndRenderData();
        setupEventListeners();
    }

    function generateAndRenderData() {
        rawData = DataGenerator.generateSNPData();
        originalSamples = [...rawData.samples];
        isClustered = false;
        processedData = DataProcessor.processData(rawData);
        
        DataProcessor.updateStatsUI(processedData);
        const colorScale = HeatmapRenderer.renderHeatmap(processedData);
        DataProcessor.updateMutationLegend(processedData.mutationCounts, colorScale);
        updateClusterButtonState();
    }

    function performClustering() {
        if (!rawData) return;

        const clusterBtn = document.getElementById('clusterBtn');
        clusterBtn.disabled = true;
        clusterBtn.innerHTML = '<span>⏳</span> 计算中...';

        setTimeout(() => {
            const startTime = performance.now();
            
            const orderedSamples = Cluster.clusterSamples(rawData.samples, rawData.positions);
            rawData.samples = orderedSamples;
            isClustered = true;
            
            processedData = DataProcessor.processData(rawData);
            
            const endTime = performance.now();
            console.log(`聚类完成，耗时: ${(endTime - startTime).toFixed(2)}ms`);
            
            DataProcessor.updateStatsUI(processedData);
            const colorScale = HeatmapRenderer.renderHeatmap(processedData);
            DataProcessor.updateMutationLegend(processedData.mutationCounts, colorScale);
            
            clusterBtn.disabled = false;
            updateClusterButtonState();
        }, 50);
    }

    function resetSampleOrder() {
        if (!rawData || !originalSamples) return;
        
        rawData.samples = [...originalSamples];
        isClustered = false;
        
        processedData = DataProcessor.processData(rawData);
        
        DataProcessor.updateStatsUI(processedData);
        const colorScale = HeatmapRenderer.renderHeatmap(processedData);
        DataProcessor.updateMutationLegend(processedData.mutationCounts, colorScale);
        
        updateClusterButtonState();
    }

    function updateClusterButtonState() {
        const clusterBtn = document.getElementById('clusterBtn');
        const resetBtn = document.getElementById('resetOrderBtn');
        
        if (isClustered) {
            clusterBtn.innerHTML = '<span>✅</span> 已聚类';
            clusterBtn.classList.add('btn-success');
            clusterBtn.classList.remove('btn-primary');
        } else {
            clusterBtn.innerHTML = '<span>🧬</span> 聚类分析';
            clusterBtn.classList.add('btn-primary');
            clusterBtn.classList.remove('btn-success');
        }
        
        resetBtn.disabled = !isClustered;
    }

    function setupEventListeners() {
        document.getElementById('clusterBtn').addEventListener('click', function() {
            if (!isClustered) {
                performClustering();
            }
        });

        document.getElementById('resetOrderBtn').addEventListener('click', function() {
            resetSampleOrder();
        });

        document.getElementById('regenerateBtn').addEventListener('click', function() {
            generateAndRenderData();
        });

        document.getElementById('exportBtn').addEventListener('click', function() {
            if (rawData) {
                DataGenerator.exportToJSON(rawData);
            }
        });

        document.getElementById('zoomIn').addEventListener('click', function() {
            const currentZoom = HeatmapRenderer.getZoom();
            HeatmapRenderer.setZoom(currentZoom + 0.25);
            const colorScale = HeatmapRenderer.renderHeatmap(processedData);
            DataProcessor.updateMutationLegend(processedData.mutationCounts, colorScale);
        });

        document.getElementById('zoomOut').addEventListener('click', function() {
            const currentZoom = HeatmapRenderer.getZoom();
            HeatmapRenderer.setZoom(currentZoom - 0.25);
            const colorScale = HeatmapRenderer.renderHeatmap(processedData);
            DataProcessor.updateMutationLegend(processedData.mutationCounts, colorScale);
        });

        document.getElementById('zoomReset').addEventListener('click', function() {
            HeatmapRenderer.setZoom(1);
            const colorScale = HeatmapRenderer.renderHeatmap(processedData);
            DataProcessor.updateMutationLegend(processedData.mutationCounts, colorScale);
        });

        document.querySelectorAll('.color-scheme-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.color-scheme-btn').forEach(b => {
                    b.classList.remove('active');
                });
                this.classList.add('active');
                
                const scheme = this.getAttribute('data-scheme');
                HeatmapRenderer.setColorScheme(scheme);
                const colorScale = HeatmapRenderer.renderHeatmap(processedData);
                DataProcessor.updateMutationLegend(processedData.mutationCounts, colorScale);
            });
        });

        window.addEventListener('resize', function() {
            if (processedData) {
                const colorScale = HeatmapRenderer.renderHeatmap(processedData);
                DataProcessor.updateMutationLegend(processedData.mutationCounts, colorScale);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
