# LZ4 High Performance Compression Service

A multi-language high-performance compression service using LZ4 algorithm compiled to WebAssembly, with Node.js API, Python bindings, and Go CLI tool.

## Features

- **LZ4 Compression**: Fast LZ4 algorithm implemented in C++
- **WebAssembly**: Compiled to WASM for cross-platform usage
- **Node.js API**: RESTful API with Express
- **Python Bindings**: WASM-based Python library
- **Go CLI**: Command-line tool for bulk compression
- **Chunk & Streaming**: Support for chunked and streaming compression
- **Performance Benchmark**: Compare with gzip and deflate
- **Prometheus Metrics**: Expose compression metrics
- **Dictionary Training**: Auto-train compression dictionary from historical data
- **Redis Persistence**: Dictionary and history stored in Redis

## Project Structure

```
.
├── cpp/                    # C++ LZ4 implementation
│   ├── lz4_wasm.cpp       # Main LZ4 WASM module
│   └── Makefile           # Build configuration
├── nodejs/                 # Node.js API service
│   └── src/
│       ├── index.js       # Express API server
│       ├── lz4_wasm.js    # WASM wrapper
│       ├── metrics.js     # Prometheus metrics
│       ├── dictionary.js  # Dictionary manager
│       └── benchmark.js   # Performance benchmark
├── python/                 # Python bindings
│   ├── lz4_wasm.py       # Python WASM library
│   └── requirements.txt   # Python dependencies
├── go/                     # Go CLI tool
│   ├── main.go           # CLI implementation
│   └── go.mod            # Go module
└── package.json           # Node.js dependencies
```

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.9+ (for Python bindings)
- Go 1.21+ (for CLI tool)
- Emscripten (to compile C++ to WASM)
- Redis (for dictionary persistence)

### Installation

1. **Install Node.js dependencies**:
```bash
npm install
```

2. **Build WASM module** (requires Emscripten):
```bash
cd cpp && make
```

3. **Install Python dependencies** (optional):
```bash
cd python && pip install -r requirements.txt
```

4. **Build Go CLI** (optional):
```bash
cd go && go build -o lz4-cli
```

### Starting the Service

```bash
npm start
# or for development
npm run dev
```

The service will start on `http://localhost:3000`

## API Endpoints

### Compression

**POST `/api/compress`**
- Compress data or file upload
- Query params: `?download=true` to download compressed file
- Body: `{ "data": "base64_encoded_data" }` or multipart file upload

**POST `/api/compress/stream`**
- Stream compression for large files
- Send raw data in request body

**POST `/api/compress/chunk`**
- Compress multiple chunks in parallel
- Body: `{ "chunks": ["base64_chunk1", ...], "mode": "parallel|sequential" }`

### Decompression

**POST `/api/decompress`**
- Decompress data
- Body: `{ "data": "base64_compressed_data", "outputSize": 12345 }`

**POST `/api/decompress/stream`**
- Stream decompression

**POST `/api/decompress/chunk`**
- Decompress multiple chunks

### Benchmark

**GET `/api/benchmark?size=1`**
- Run performance benchmark with specified MB test data

**GET `/api/benchmark/text?size=1`**
- Get formatted text benchmark results

### Dictionary Management

**POST `/api/dictionary/train`**
- Train compression dictionary from history files

**GET `/api/dictionary/status`**
- Get dictionary status and training files count

### Health & Metrics

**GET `/health`**
- Service health check

**GET `/metrics`**
- Prometheus metrics endpoint

## Go CLI Usage

```bash
# Compress files
lz4-cli compress file1.txt file2.txt -o output_dir

# Compress directory recursively with 8 workers
lz4-cli compress -r -w 8 ./data -o compressed

# Compress with tar archiving
lz4-cli compress -t ./data -o compressed

# Decompress files
lz4-cli decompress compressed/*.lz4 -o decompressed

# Decompress and extract tar
lz4-cli decompress --untar archive.tar.lz4 -o output

# Run benchmark
lz4-cli benchmark -s 5

# Check API health
lz4-cli health

# Use custom API endpoint
lz4-cli -a http://api.example.com:3000 compress file.txt
```

## Python Usage

```python
from lz4_wasm import get_lz4

# Initialize (use mock if WASM not available)
lz4 = get_lz4(use_mock=False)

# Compress
data = b"Hello, World! " * 1000
result = lz4.compress(data)
print(f"Compressed: {result.compressed_size} bytes")
print(f"Ratio: {result.ratio:.2f}x")

# Decompress
decompressed = lz4.decompress(result.data)
print(f"Decompressed: {decompressed.decompressed_size} bytes")

# Set dictionary
dict_data = b"common patterns here"
lz4.set_dictionary(dict_data)

# Chunk compression
chunks = [b"chunk1 data", b"chunk2 data", b"chunk3 data"]
compressed_chunks = lz4.compress_chunks(chunks)
decompressed_chunks = lz4.decompress_chunks(compressed_chunks)
```

## Performance Benchmark

The service includes built-in benchmark comparing LZ4 WASM with native Node.js zlib:

```
=== LZ4 WASM Benchmark Results (1 MB) ===

Compression Performance:
------------------------
LZ4-WASM:
  Ratio: 3.45x
  Speed: 450.23 MB/s
  Time: 2.22 ms

GZIP:
  Ratio: 4.12x
  Speed: 85.45 MB/s
  Time: 11.70 ms

LZ4 Speed Comparison (vs others):
----------------------------------
Compression: 5.3x faster than gzip
Compression: 4.8x faster than deflate
Decompression: 8.2x faster than gzip
```

## Prometheus Metrics

Metrics exposed at `/metrics`:

- `lz4_compression_duration_seconds`: Compression operation duration histogram
- `lz4_decompression_duration_seconds`: Decompression operation duration histogram
- `lz4_compression_ratio`: Current compression ratio
- `lz4_total_compressed_bytes`: Total bytes compressed counter
- `lz4_total_decompressed_bytes`: Total bytes decompressed counter
- `lz4_active_connections`: Active connections gauge
- `lz4_dictionary_size_bytes`: Dictionary size
- `lz4_training_files_count`: Number of training files

## Dictionary Training

The service automatically collects compressed file history and can train a custom dictionary:

1. Compress files normally - they are automatically added to history
2. Train dictionary when history has enough files:
   ```bash
   curl -X POST http://localhost:3000/api/dictionary/train
   ```
3. The trained dictionary is automatically loaded and persisted to Redis
4. Dictionary improves compression ratio for similar files

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Clients                          │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────┐    │
│  │  Go CLI  │  │  Python    │  │  HTTP Client     │    │
│  └──────────┘  └────────────┘  └──────────────────┘    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    Node.js API Server                   │
│  ┌─────────────┐  ┌────────────┐  ┌─────────────────┐ │
│  │   Express   │  │  Metrics   │  │  Dictionary     │ │
│  │    Routes   │  │  (Prom)    │  │  Manager        │ │
│  └─────────────┘  └────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   WASM LZ4 Module                       │
│  ┌───────────────────────────────────────────────────┐ │
│  │  C++ LZ4 Implementation compiled to WebAssembly   │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                         Redis                           │
│  ┌───────────┐  ┌────────────────────────────────────┐ │
│  │ Dictionary │  │  History Files (max 100)          │ │
│  └───────────┘  └────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## License

MIT
