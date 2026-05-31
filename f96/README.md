# Parquet Query Service

A high-performance service for querying large Parquet files with column projection, row filtering, and streaming pagination.

## Architecture

```
┌─────────────────┐     ┌────────────────────┐     ┌─────────────────┐
│  Python Client  │────▶│  FastAPI Service   │────▶│  Parquet File   │
└─────────────────┘     │  - JWT Auth        │     │  (5GB sensor)   │
┌─────────────────┐     │  - Column Proj.    │     └─────────────────┘
│  Node.js Client │────▶│  - Filter Pushdown │
└─────────────────┘     │  - Stream Paging   │
                        └────────────────────┘
```

## Features

- **Column Projection**: Select only needed columns (e.g., `SELECT temp, humidity`)
- **Row Filter Pushdown**: Filter at Parquet level (e.g., `WHERE sensor_id=5`)
- **Streaming Pagination**: Results streamed in batches, never load full table to memory
- **JWT Authentication**: Every query requires a valid token
- **Arrow IPC Format**: Results returned as Apache Arrow RecordBatches

## Quick Start

### 1. Generate Test Data

```bash
cd data
pip install pyarrow numpy pandas
python generate_test_data.py --rows 50000000 --output sensor_data.parquet
```

This will generate ~5GB of sensor data with columns: `sensor_id`, `timestamp`, `temp`, `humidity`, `pressure`, `vibration`, `status`.

### 2. Start the Server

```bash
cd server
pip install -r requirements.txt
set PARQUET_FILE=../data/sensor_data.parquet
set JWT_SECRET=your-super-secret-key
python main.py
```

Server starts on `http://localhost:8000`

### 3. Authentication

Default credentials: `admin` / `password`

Get a token:
```bash
curl -X POST http://localhost:8000/token \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'
```

## Python CLI Client

### Setup
```bash
cd client/python
pip install -r requirements.txt
```

### Usage

```bash
# Login to get token
python client.py login -u admin -p password

# List available columns (use token from login)
python client.py --token <your-token> columns

# Query with column projection and row filter
python client.py --token <your-token> query \
  -c "temp,humidity,sensor_id,timestamp" \
  -f "sensor_id=5" \
  -f "temp>30" \
  --limit 20

# Query with POST method and custom page size
python client.py --token <your-token> query \
  -c "temp,humidity,pressure" \
  -f "sensor_id=10" \
  --page-size 50000 \
  --method POST \
  --output result.parquet
```

## Node.js CLI Client

### Setup
```bash
cd client/nodejs
npm install
```

### Usage

```bash
# Login
node client.js login -u admin -p password

# List columns
node client.js --token <your-token> columns

# Query with filters
node client.js --token <your-token> query \
  -c "temp,humidity,sensor_id" \
  -f "sensor_id=5" \
  -f "humidity>=60" \
  --limit 20

# Save output to Arrow file
node client.js --token <your-token> query \
  -c "temp,pressure" \
  -f "status=error" \
  --output result.arrow
```

## API Reference

### `POST /token`
Authenticate and receive JWT token.

**Request:**
```json
{"username": "admin", "password": "password"}
```

**Response:**
```json
{"access_token": "<jwt-token>", "token_type": "bearer"}
```

### `GET /DoGet` / `POST /DoGet`
Execute a query with column projection and row filtering.

**Headers:**
- `Authorization: Bearer <jwt-token>`

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `columns` | string | Comma-separated column names |
| `filters` | string | JSON object of filter conditions |
| `page_size` | int | Rows per batch (default: 10000) |

**Filter Examples:**
```json
{"sensor_id": 5}
{"temp": {">": 30}}
{"sensor_id": 5, "humidity": {"<=": 70}}
```

**Supported Operators:**
`=`, `!=`, `>`, `>=`, `<`, `<=`

**Response:**
Stream of `application/vnd.apache.arrow.stream` with custom binary framing:
- 4 bytes: JSON header length (big-endian)
- N bytes: JSON header (contains schema, row count, total rows)
- 4 bytes: Arrow IPC data length (big-endian)
- M bytes: Arrow IPC RecordBatch data

## Project Structure

```
f96/
├── server/
│   ├── main.py              # FastAPI server with DoGet endpoint
│   ├── parquet_engine.py    # Parquet query engine with pushdown
│   ├── auth.py              # JWT authentication
│   ├── config.py            # Configuration settings
│   └── requirements.txt     # Python dependencies
├── client/
│   ├── python/
│   │   ├── client.py        # Python CLI client
│   │   └── requirements.txt
│   └── nodejs/
│       ├── client.js        # Node.js CLI client
│       └── package.json
├── data/
│   └── generate_test_data.py  # Test data generator
└── README.md
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PARQUET_FILE` | `data/sensor_data.parquet` | Path to Parquet file |
| `JWT_SECRET` | `your-secret-key-...` | JWT signing secret |
| `PAGE_SIZE` | `10000` | Default rows per page |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8000` | Server port |
