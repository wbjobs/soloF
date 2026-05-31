# Prometheus TSDB Manager

A comprehensive tool for analyzing and optimizing Prometheus TSDB block data, featuring both a CLI and Web UI.

## Features

### Core Functionality
- **TSDB Analysis**: Read Prometheus data directory and analyze block files
- **Index Fragmentation Detection**: Calculate index fragmentation rate
- **Query Hotspot Analysis**: Identify frequently queried label patterns
- **Index Optimization**: 
  - Merge small blocks
  - Rebuild inverted index skip lists
  - Clean up orphaned series
- **Dry Run Mode**: Preview changes without applying them
- **Before/After Comparison**: Visualize optimization results

### CLI Features
- `analyze` command: Generate detailed analysis report
- `optimize` command: Run index optimization
- Table and JSON output formats

### Web UI Features
- Interactive dashboard with statistics
- Visual fragmentation gauge chart
- Block statistics visualization
- Detailed analysis tabs
- Optimization interface with dry run option
- Block details table

### REST API
- `GET /api/v1/health`: Health check
- `GET /api/v1/analyze`: Run TSDB analysis
- `POST /api/v1/optimize`: Run TSDB optimization
- `GET /api/v1/blocks`: Get block details

## Project Structure

```
prometheus-tsdb-manager/
├── cmd/
│   └── main.go                 # Main entry point
├── pkg/
│   ├── tsdb/
│   │   ├── analyzer.go         # TSDB analysis logic
│   │   └── optimizer.go        # TSDB optimization logic
│   ├── cli/
│   │   ├── root.go             # CLI root command
│   │   ├── analyze.go          # Analyze command
│   │   └── optimize.go         # Optimize command
│   └── api/
│       └── server.go           # HTTP API server
├── web/
│   ├── src/
│   │   ├── views/
│   │   │   ├── Dashboard.vue   # Dashboard view
│   │   │   ├── Analyze.vue     # Analysis view
│   │   │   ├── Optimize.vue    # Optimization view
│   │   │   └── Blocks.vue      # Blocks list view
│   │   ├── router/
│   │   │   └── index.js        # Vue router config
│   │   ├── App.vue             # Root component
│   │   └── main.js             # Vue entry point
│   ├── index.html              # HTML template
│   ├── package.json            # NPM dependencies
│   └── vite.config.js          # Vite config
├── go.mod                      # Go module file
└── README.md                   # This file
```

## Prerequisites

- Go 1.21 or later
- Node.js 18 or later
- Prometheus TSDB data directory (for testing)

## Installation

### Backend Setup

```bash
# Install Go dependencies
go mod download

# Build the binary
go build -o prometheus-tsdb-manager ./cmd/
```

### Frontend Setup

```bash
cd web

# Install NPM dependencies
npm install

# Build for production
npm run build
```

## Usage

### CLI Mode

#### Analyze TSDB
```bash
# Table output (default)
./prometheus-tsdb-manager analyze --data-dir /path/to/prometheus/data

# JSON output
./prometheus-tsdb-manager analyze --data-dir /path/to/prometheus/data --format json

# Save to file
./prometheus-tsdb-manager analyze --data-dir /path/to/prometheus/data --format json --output report.json
```

#### Optimize TSDB
```bash
# Dry run (no actual changes)
./prometheus-tsdb-manager optimize --data-dir /path/to/prometheus/data --dry-run

# Actual optimization
./prometheus-tsdb-manager optimize --data-dir /path/to/prometheus/data
```

### Server Mode (Web UI + API)

```bash
./prometheus-tsdb-manager --server --port 8080 --data-dir /path/to/prometheus/data
```

Then open http://localhost:8080 in your browser.

#### API Examples

```bash
# Health check
curl http://localhost:8080/api/v1/health

# Run analysis
curl http://localhost:8080/api/v1/analyze

# Run optimization (dry run)
curl -X POST http://localhost:8080/api/v1/optimize \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'

# Get blocks
curl http://localhost:8080/api/v1/blocks
```

## Development

### Backend Development

```bash
# Run in development mode
go run ./cmd/ --server --port 8080 --data-dir ./test-data
```

### Frontend Development

```bash
cd web

# Start dev server with hot reload
npm run dev
```

The frontend dev server will proxy API requests to `http://localhost:8080`.

## Configuration

### Environment Variables

- `DATA_DIR`: Path to Prometheus data directory
- `SERVER_PORT`: HTTP server port (default: 8080)

### CLI Flags

```
--config string      config file
--data-dir string    Path to Prometheus data directory (default "./data")
--dry-run            Run in dry-run mode without making changes
-v, --verbose        Enable verbose output
--server             Run as web server with API
--port int           Server port (default 8080)
```

## Analysis Report Structure

The analysis report includes:

- **Overview**: Basic TSDB statistics
- **Fragmentation**: Index fragmentation metrics
- **Hotspots**: Query hotspot detection
- **Labels**: Label usage statistics
- **Blocks**: Individual block details
- **Recommendations**: Optimization suggestions

## Optimization Results

The optimization result includes:

- Success status
- Saved space in bytes
- List of performed operations
- Before/after comparison metrics

## License

MIT License
