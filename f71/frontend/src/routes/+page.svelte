<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { FftProcessor, init_panic_hook } from 'fft-wasm';

	let isRecording = false;
	let fftSize = 2048;
	let sampleRate = 44100;
	let wsConnected = false;
	let magnitudes: number[] = [];
	let frequencies: number[] = [];
	let error = '';
	let estimatedPacketSize = 0;
	let broadcastRateLimit = 60;

	let audioContext: AudioContext | null = null;
	let analyser: AnalyserNode | null = null;
	let mediaStream: MediaStream | null = null;
	let mediaSource: MediaStreamAudioSourceNode | null = null;
	let animationId: number = 0;
	let ws: WebSocket | null = null;
	let fftProcessor: FftProcessor | null = null;
	let dataBuffer: Float32Array | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let destroyCalled = false;
	let lastSendTime = 0;

	const WS_URL = 'ws://localhost:8080/ws?pub=true';
	const FFT_OPTIONS = [2048, 4096, 8192, 16384];

	onMount(async () => {
		try {
			init_panic_hook();
			fftProcessor = new FftProcessor(fftSize);
			connectWebSocket();
			updateEstimatedPacketSize();
		} catch (e) {
			error = `Failed to initialize: ${e}`;
		}
	});

	onDestroy(async () => {
		destroyCalled = true;
		await stopRecording();
		disconnectWebSocket();
		if (fftProcessor) {
			fftProcessor.free();
			fftProcessor = null;
		}
	});

	function connectWebSocket() {
		if (destroyCalled) return;

		try {
			ws = new WebSocket(WS_URL);

			ws.onopen = () => {
				if (destroyCalled) {
					ws?.close();
					return;
				}
				wsConnected = true;
				error = '';
				sendConfig();
			};

			ws.onclose = () => {
				wsConnected = false;
				if (destroyCalled) return;
				reconnectTimer = setTimeout(() => {
					if (!destroyCalled && !wsConnected) {
						connectWebSocket();
					}
				}, 3000);
			};

			ws.onerror = () => {
				if (!destroyCalled) {
					error = 'WebSocket connection error';
				}
			};
		} catch (e) {
			if (!destroyCalled) {
				error = `WebSocket error: ${e}`;
			}
		}
	}

	function disconnectWebSocket() {
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		if (ws) {
			try {
				ws.onopen = null;
				ws.onclose = null;
				ws.onerror = null;
				ws.onmessage = null;
				ws.close();
			} catch (e) {
			}
			ws = null;
		}
		wsConnected = false;
	}

	async function startRecording() {
		if (destroyCalled) return;

		try {
			mediaStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					sampleRate: sampleRate,
					channelCount: 1,
					echoCancellation: false,
					noiseSuppression: false
				}
			});

			audioContext = new AudioContext({ sampleRate });
			mediaSource = audioContext.createMediaStreamSource(mediaStream);
			analyser = audioContext.createAnalyser();
			analyser.fftSize = fftSize * 2;
			analyser.smoothingTimeConstant = 0.8;

			mediaSource.connect(analyser);
			dataBuffer = new Float32Array(fftSize);

			isRecording = true;
			error = '';
			lastSendTime = 0;
			processAudio();
		} catch (e) {
			error = `Failed to start recording: ${e}`;
		}
	}

	async function stopRecording() {
		isRecording = false;

		if (animationId) {
			cancelAnimationFrame(animationId);
			animationId = 0;
		}

		if (mediaSource) {
			try {
				mediaSource.disconnect();
			} catch (e) {
			}
			mediaSource = null;
		}

		if (analyser) {
			try {
				analyser.disconnect();
			} catch (e) {
			}
			analyser = null;
		}

		if (mediaStream) {
			mediaStream.getTracks().forEach((track) => {
				track.stop();
				mediaStream?.removeTrack(track);
			});
			mediaStream = null;
		}

		if (audioContext) {
			try {
				if (audioContext.state !== 'closed') {
					await audioContext.close();
				}
			} catch (e) {
			}
			audioContext = null;
		}

		dataBuffer = null;
		magnitudes = [];
		frequencies = [];
	}

	function processAudio() {
		if (!isRecording || !analyser || !dataBuffer || !fftProcessor || destroyCalled) return;

		analyser.getFloatTimeDomainData(dataBuffer);

		const resultJson = fftProcessor.process(dataBuffer, sampleRate);
		const result = JSON.parse(resultJson as string);

		magnitudes = result.magnitudes;
		frequencies = result.frequencies;

		const now = Date.now();
		const minInterval = 1000 / broadcastRateLimit;

		if (ws && ws.readyState === WebSocket.OPEN && !destroyCalled && now - lastSendTime >= minInterval) {
			const payload = {
				type: 'fft_data',
				...result,
				timestamp: now
			};
			ws.send(JSON.stringify(payload));
			lastSendTime = now;
		}

		animationId = requestAnimationFrame(processAudio);
	}

	function updateFftSize() {
		if (fftProcessor) {
			fftProcessor.set_fft_size(fftSize);
			if (analyser) {
				analyser.fftSize = fftSize * 2;
			}
			dataBuffer = new Float32Array(fftSize);
		}
		updateEstimatedPacketSize();
		sendConfig();
	}

	function updateEstimatedPacketSize() {
		const numBars = fftSize / 2;
		const jsonOverhead = 150;
		const bytesPerFloat = 8;
		estimatedPacketSize = jsonOverhead + (numBars * bytesPerFloat * 2);
	}

	function sendConfig() {
		if (ws && ws.readyState === WebSocket.OPEN) {
			const config = {
				type: 'config',
				fftSize,
				sampleRate,
				broadcastRateLimit,
				estimatedPacketSize
			};
			ws.send(JSON.stringify(config));
		}
	}

	function onBroadcastRateLimitChange() {
		sendConfig();
	}

	$: barCount = Math.min(magnitudes.length, 128);
</script>

<div class="container">
	<h1>FFT Audio Processor</h1>
	<p class="subtitle">Rust + Wasm + SvelteKit + Go WebSocket</p>

	{#if error}
		<div class="error">{error}</div>
	{/if}

	<div class="controls">
		<div class="control-group slider-group">
			<label for="fftSize">FFT Size: <strong>{fftSize}</strong></label>
			<input
				type="range"
				id="fftSize"
				bind:value={fftSize}
				min={2048}
				max={16384}
				step={2048}
				on:input={updateFftSize}
				disabled={isRecording}
				class="slider"
			/>
			<div class="slider-labels">
				<span>2048</span>
				<span>4096</span>
				<span>8192</span>
				<span>16384</span>
			</div>
		</div>

		<div class="control-group">
			<label for="sampleRate">Sample Rate:</label>
			<select id="sampleRate" bind:value={sampleRate} disabled={isRecording}>
				<option value={22050}>22050 Hz</option>
				<option value={44100}>44100 Hz</option>
				<option value={48000}>48000 Hz</option>
			</select>
		</div>

		<div class="control-group slider-group">
			<label for="broadcastRate">Broadcast Rate: <strong>{broadcastRateLimit}</strong> fps</label>
			<input
				type="range"
				id="broadcastRate"
				bind:value={broadcastRateLimit}
				min={1}
				max={60}
				step={1}
				on:input={onBroadcastRateLimitChange}
				class="slider"
			/>
			<div class="slider-labels">
				<span>1</span>
				<span>30</span>
				<span>60</span>
			</div>
		</div>

		<div class="status">
			<span class="ws-status {wsConnected ? 'connected' : 'disconnected'}">
				WebSocket: {wsConnected ? 'Connected' : 'Disconnected'}
			</span>
		</div>
	</div>

	<div class="buttons">
		{#if !isRecording}
			<button class="start-btn" on:click={startRecording}>
				Start Recording
			</button>
		{:else}
			<button class="stop-btn" on:click={stopRecording}>
				Stop Recording
			</button>
		{/if}
	}

	{#if magnitudes.length > 0}
		<div class="visualizer">
			{#each magnitudes.slice(0, barCount) as mag, i}
				<div
					class="bar"
					style="height: {Math.min(mag * 100, 100)}%;"
					title="{frequencies[i]?.toFixed(1) || 0} Hz: {mag.toFixed(4)}"
				/>
			{/each}
		</div>

		<div class="info">
			<p>Bars: {barCount}</p>
			<p>Max Magnitude: {Math.max(...magnitudes.slice(0, barCount)).toFixed(4)}</p>
			<p>Est. Packet Size: {estimatedPacketSize} bytes</p>
			<p>Data Rate: {Math.round((estimatedPacketSize * broadcastRateLimit) / 1024)} KB/s</p>
		</div>
	{/if}
</div>

<style>
	.container {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	h1 {
		text-align: center;
		color: #333;
		margin-bottom: 0.5rem;
	}

	.subtitle {
		text-align: center;
		color: #666;
		margin-bottom: 2rem;
	}

	.error {
		background: #fee;
		color: #c33;
		padding: 1rem;
		border-radius: 8px;
		margin-bottom: 1rem;
	}

	.controls {
		display: flex;
		gap: 1.5rem;
		align-items: center;
		justify-content: center;
		margin-bottom: 2rem;
		flex-wrap: wrap;
	}

	.control-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.slider-group {
		min-width: 220px;
	}

	label {
		font-weight: 600;
		color: #444;
	}

	label strong {
		color: #007bff;
	}

	select {
		padding: 0.5rem 1rem;
		font-size: 1rem;
		border: 2px solid #ddd;
		border-radius: 6px;
		background: white;
	}

	select:disabled {
		opacity: 0.6;
	}

	.slider {
		width: 100%;
		height: 8px;
		border-radius: 4px;
		background: #ddd;
		outline: none;
		-webkit-appearance: none;
		appearance: none;
	}

	.slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #007bff;
		cursor: pointer;
		transition: background 0.2s;
	}

	.slider::-webkit-slider-thumb:hover {
		background: #0056b3;
	}

	.slider::-moz-range-thumb {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #007bff;
		cursor: pointer;
		border: none;
	}

	.slider:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.slider-labels {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: #999;
		margin-top: -0.25rem;
	}

	.status {
		display: flex;
		align-items: center;
	}

	.ws-status {
		padding: 0.5rem 1rem;
		border-radius: 20px;
		font-weight: 600;
	}

	.connected {
		background: #d4edda;
		color: #155724;
	}

	.disconnected {
		background: #f8d7da;
		color: #721c24;
	}

	.buttons {
		display: flex;
		justify-content: center;
		margin-bottom: 2rem;
	}

	button {
		padding: 1rem 2.5rem;
		font-size: 1.1rem;
		font-weight: 600;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.start-btn {
		background: #28a745;
		color: white;
	}

	.start-btn:hover {
		background: #218838;
	}

	.stop-btn {
		background: #dc3545;
		color: white;
	}

	.stop-btn:hover {
		background: #c82333;
	}

	.visualizer {
		display: flex;
		align-items: flex-end;
		height: 300px;
		background: #f8f9fa;
		border-radius: 8px;
		padding: 1rem;
		gap: 2px;
	}

	.bar {
		flex: 1;
		background: linear-gradient(to top, #007bff, #00d4ff);
		border-radius: 3px 3px 0 0;
		min-height: 2px;
		transition: height 0.05s ease-out;
	}

	.info {
		display: flex;
		justify-content: center;
		gap: 2rem;
		margin-top: 1rem;
		color: #666;
	}
</style>
