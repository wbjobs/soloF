import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
	plugins: [sveltekit(), wasm()],
	optimizeDeps: {
		exclude: ['fft-wasm']
	},
	server: {
		port: 5173,
		cors: true
	}
});
