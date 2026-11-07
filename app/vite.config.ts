import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  envDir: '..',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || process.env.VITE_VLM_PROXY_URL || 'http://127.0.0.1:8788',
        changeOrigin: true,
      },
    },
  },
});
