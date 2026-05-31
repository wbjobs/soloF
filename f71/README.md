# FFT Audio Processing System

A complete audio processing system using Rust + WebAssembly for FFT computation, SvelteKit for the frontend, and Go for WebSocket broadcasting.

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  SvelteKit UI   │─────▶│  Rust Wasm FFT  │─────▶│  Go WebSocket   │
│  (Web Audio API)│      │   (rustfft)     │      │   (Broadcast)   │
└─────────────────┘      └─────────────────┘      └─────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
  Microphone Input       FFT Calculation          Multiple Subscribers
```

## Project Structure

```
fft-audio-system/
├── fft-wasm/              # Rust WebAssembly FFT library
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs
├── go-server/             # Go WebSocket server
│   ├── go.mod
│   └── main.go
├── frontend/              # SvelteKit frontend
│   ├── package.json
│   ├── svelte.config.js
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── app.d.ts
│       └── routes/
│           └── +page.svelte
└── README.md
```

## Prerequisites

- Rust (nightly recommended) with `wasm-pack`
  ```bash
  cargo install wasm-pack
  ```
- Go 1.21+
- Node.js 18+
- npm or yarn

## Build and Run

### 1. Build Rust Wasm Library

```bash
cd fft-wasm
wasm-pack build --target web
```

This will generate the Wasm package in `fft-wasm/pkg/`.

### 2. Start Go WebSocket Server

```bash
cd go-server
go mod tidy
go run main.go
```

The server will start on `ws://localhost:8080`

Endpoints:
- Publisher: `ws://localhost:8080/ws?pub=true` (for sending FFT data)
- Subscriber: `ws://localhost:8080/ws` (for receiving broadcast data)
- Health check: `http://localhost:8080/health`

### 3. Start SvelteKit Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## How It Works

### Audio Flow

1. **Audio Capture**: The frontend uses Web Audio API's `getUserMedia` to access the microphone
2. **Time Domain Data**: `AnalyserNode` captures raw audio samples in Float32Array format
3. **Wasm FFT**: Samples are sent to Rust Wasm which uses `rustfft` to compute the Fast Fourier Transform
4. **Frequency Domain**: The Wasm module returns magnitude and frequency arrays
5. **WebSocket Broadcast**: Results are sent to the Go WebSocket server
6. **Multi-client Broadcast**: The Go server broadcasts the spectrum data to all subscribers

### FFT Features

- Configurable FFT size (1024, 2048, 4096, 8192)
- Hann windowing to reduce spectral leakage
- Real-time processing using `requestAnimationFrame`
- Sample rate options: 22050 Hz, 44100 Hz, 48000 Hz

## WebSocket Data Format

```json
{
  "magnitudes": [0.1, 0.5, 0.3, ...],
  "frequencies": [0, 43.066, 86.133, ...],
  "sampleRate": 44100,
  "fftSize": 2048,
  "timestamp": 1700000000000
}
```

## License

MIT
