const Cluster = (function() {
    function createSampleVector(sample) {
        const vector = {};
        sample.snps.forEach(snp => {
            vector[`${snp.position}-${snp.mutationType}`] = true;
        });
        return vector;
    }

    function jaccardSimilarity(vecA, vecB) {
        const keysA = Object.keys(vecA);
        const keysB = Object.keys(vecB);
        
        if (keysA.length === 0 && keysB.length === 0) return 1;
        if (keysA.length === 0 || keysB.length === 0) return 0;

        let intersection = 0;
        const smaller = keysA.length <= keysB.length ? keysA : keysB;
        const largerVec = keysA.length > keysB.length ? vecA : vecB;
        
        for (let i = 0; i < smaller.length; i++) {
            if (largerVec[smaller[i]]) {
                intersection++;
            }
        }

        const union = keysA.length + keysB.length - intersection;
        return intersection / union;
    }

    function jaccardDistance(vecA, vecB) {
        return 1 - jaccardSimilarity(vecA, vecB);
    }

    function fastKMeans(vectors, k = 10, maxIterations = 15) {
        const n = vectors.length;
        let centroids = [];
        const shuffled = [...Array(n).keys()].sort(() => Math.random() - 0.5);
        
        for (let i = 0; i < k; i++) {
            centroids.push(vectors[shuffled[i]]);
        }

        let assignments = new Array(n).fill(0);
        
        for (let iter = 0; iter < maxIterations; iter++) {
            let changed = false;
            
            for (let i = 0; i < n; i++) {
                let minDist = Infinity;
                let bestCluster = 0;
                
                for (let c = 0; c < k; c++) {
                    const dist = jaccardDistance(vectors[i], centroids[c]);
                    if (dist < minDist) {
                        minDist = dist;
                        bestCluster = c;
                    }
                }
                
                if (assignments[i] !== bestCluster) {
                    assignments[i] = bestCluster;
                    changed = true;
                }
            }
            
            if (!changed) break;
            
            for (let c = 0; c < k; c++) {
                const clusterMembers = [];
                for (let i = 0; i < n; i++) {
                    if (assignments[i] === c) {
                        clusterMembers.push(i);
                    }
                }
                
                if (clusterMembers.length > 0) {
                    let bestIdx = clusterMembers[0];
                    let minSum = Infinity;
                    const sampleSize = Math.min(clusterMembers.length, 30);
                    
                    for (let s = 0; s < sampleSize; s++) {
                        const idx = clusterMembers[s];
                        let sumDist = 0;
                        for (let t = 0; t < sampleSize; t++) {
                            sumDist += jaccardDistance(vectors[idx], vectors[clusterMembers[t]]);
                        }
                        if (sumDist < minSum) {
                            minSum = sumDist;
                            bestIdx = idx;
                        }
                    }
                    centroids[c] = vectors[bestIdx];
                }
            }
        }
        
        return assignments;
    }

    function sortWithinClusters(vectors, assignments) {
        const clusters = {};
        vectors.forEach((vec, idx) => {
            const c = assignments[idx];
            if (!clusters[c]) clusters[c] = [];
            clusters[c].push({ idx, vec });
        });
        
        const clusterIds = Object.keys(clusters).sort((a, b) => {
            const sizeDiff = clusters[b].length - clusters[a].length;
            if (sizeDiff !== 0) return sizeDiff;
            return parseInt(a) - parseInt(b);
        });
        
        const orderedIndices = [];
        
        clusterIds.forEach(c => {
            const cluster = clusters[c];
            
            let sumVec = {};
            cluster.forEach(item => {
                Object.keys(item.vec).forEach(key => {
                    sumVec[key] = (sumVec[key] || 0) + 1;
                });
            });
            
            const distances = cluster.map(item => ({
                idx: item.idx,
                dist: jaccardDistance(item.vec, sumVec)
            }));
            
            distances.sort((a, b) => a.dist - b.dist);
            
            distances.forEach(d => orderedIndices.push(d.idx));
        });
        
        return orderedIndices;
    }

    function clusterSamples(samples, positions) {
        const vectors = samples.map(sample => createSampleVector(sample));
        
        const k = Math.min(15, Math.ceil(Math.sqrt(samples.length)));
        const assignments = fastKMeans(vectors, k);
        
        const orderedIndices = sortWithinClusters(vectors, assignments);
        
        const orderedSamples = orderedIndices.map(idx => samples[idx]);
        
        return orderedSamples;
    }

    return {
        clusterSamples: clusterSamples,
        jaccardSimilarity: jaccardSimilarity
    };
})();
