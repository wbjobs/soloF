export class TerrainService {
    constructor(host = 'http://localhost:50051') {
        this.host = host;
    }

    async getChunk(chunkX, chunkY, chunkZ, chunkSize, lodLevel) {
        const response = await fetch(`${this.host}/getChunk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chunkX, chunkY, chunkZ, chunkSize, lodLevel })
        });
        return await response.json();
    }

    async streamChunks(cameraX, cameraY, cameraZ, viewDistance, chunkSize, onChunkReceived) {
        const response = await fetch(`${this.host}/streamChunks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cameraX, cameraY, cameraZ, viewDistance, chunkSize })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const chunkData = JSON.parse(line);
                        onChunkReceived(chunkData);
                    } catch (e) {
                        console.warn('Failed to parse chunk data:', e);
                    }
                }
            }
        }
    }

    async editChunk(editRequest) {
        const response = await fetch(`${this.host}/editChunk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(editRequest)
        });
        return await response.json();
    }

    async batchEdit(edits) {
        const response = await fetch(`${this.host}/batchEdit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ edits })
        });
        return await response.json();
    }

    async getChunkModifications(chunkX, chunkY, chunkZ) {
        const response = await fetch(`${this.host}/getChunkModifications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chunkX, chunkY, chunkZ })
        });
        return await response.json();
    }
}
