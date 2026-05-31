import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/events': {
        target: 'http://localhost:3001',
        ws: false,
      },
      '/api': {
        target: 'http://localhost:3001',
      },
    },
  },
});
