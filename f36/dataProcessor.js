const DataProcessor = (function() {
    function calculateMutationCounts(data) {
        const counts = {};
        
        data.samples.forEach(sample => {
            sample.snps.forEach(snp => {
                const type = snp.mutationType;
                counts[type] = (counts[type] || 0) + 1;
            });
        });

        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => ({ type, count }));
    }

    function calculatePositionFrequencies(data) {
        const positionCounts = {};
        
        data.positions.forEach(pos => {
            positionCounts[pos.position] = 0;
        });

        data.samples.forEach(sample => {
            sample.snps.forEach(snp => {
                positionCounts[snp.position]++;
            });
        });

        return data.positions.map(pos => ({
            position: pos.position,
            refBase: pos.refBase,
            frequency: positionCounts[pos.position] / data.samples.length,
            count: positionCounts[pos.position]
        }));
    }

    function calculateTotalMutations(data) {
        let total = 0;
        data.samples.forEach(sample => {
            total += sample.snps.length;
        });
        return total;
    }

    function getSNPForSampleAndPosition(sample, position) {
        return sample.snps.find(snp => snp.position === position);
    }

    function processData(rawData) {
        return {
            rawData: rawData,
            mutationCounts: calculateMutationCounts(rawData),
            positionFrequencies: calculatePositionFrequencies(rawData),
            totalMutations: calculateTotalMutations(rawData),
            sampleCount: rawData.samples.length,
            positionCount: rawData.positions.length
        };
    }

    function updateStatsUI(processedData) {
        document.getElementById('sampleCount').textContent = processedData.sampleCount;
        document.getElementById('positionCount').textContent = processedData.positionCount;
        document.getElementById('totalMutations').textContent = processedData.totalMutations;
    }

    function updateMutationLegend(mutationCounts, colorScale) {
        const legendContainer = document.getElementById('mutationLegend');
        legendContainer.innerHTML = '';

        mutationCounts.slice(0, 8).forEach(({ type, count }) => {
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `
                <span class="legend-color" style="background: ${colorScale(type)}"></span>
                <span class="legend-label">${type}</span>
                <span class="legend-count">${count}</span>
            `;
            legendContainer.appendChild(item);
        });
    }

    return {
        processData: processData,
        getSNPForSampleAndPosition: getSNPForSampleAndPosition,
        updateStatsUI: updateStatsUI,
        updateMutationLegend: updateMutationLegend
    };
})();
