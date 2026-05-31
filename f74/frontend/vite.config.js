import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/grpc': {
        target: 'http://localhost:50051',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    target: 'esnext',
    minify: 'terser'
  },
  optimizeDeps: {
    include: ['three']
  }
});
