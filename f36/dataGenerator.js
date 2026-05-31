const DataGenerator = (function() {
    const BASES = ['A', 'T', 'C', 'G'];
    const NUM_SAMPLES = 200;
    const NUM_POSITIONS = 50;
    const MUTATION_RATE = 0.3;

    function randomChoice(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    function generatePositions() {
        const positions = [];
        let currentPos = 1000;
        for (let i = 0; i < NUM_POSITIONS; i++) {
            positions.push({
                position: currentPos,
                refBase: randomChoice(BASES)
            });
            currentPos += Math.floor(Math.random() * 50) + 10;
        }
        return positions;
    }

    function generateAltBase(refBase) {
        const otherBases = BASES.filter(b => b !== refBase);
        return randomChoice(otherBases);
    }

    function generateSample(sampleId, positions) {
        const snps = [];
        
        positions.forEach(({ position, refBase }) => {
            if (Math.random() < MUTATION_RATE) {
                const altBase = generateAltBase(refBase);
                snps.push({
                    position: position,
                    refBase: refBase,
                    altBase: altBase,
                    mutationType: `${refBase}→${altBase}`,
                    quality: Math.floor(Math.random() * 60) + 40
                });
            }
        });

        return {
            id: `Sample_${String(sampleId).padStart(3, '0')}`,
            snps: snps
        };
    }

    function generateSNPData() {
        const positions = generatePositions();
        const samples = [];

        for (let i = 1; i <= NUM_SAMPLES; i++) {
            samples.push(generateSample(i, positions));
        }

        return {
            positions: positions,
            samples: samples
        };
    }

    function exportToJSON(data) {
        const dataStr = JSON.stringify(data, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `snp_data_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    return {
        generateSNPData: generateSNPData,
        exportToJSON: exportToJSON
    };
})();
