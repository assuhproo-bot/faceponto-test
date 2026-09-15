import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': { target: process.env.ADMIN_API_PROXY ?? 'http://127.0.0.1:3001', changeOrigin: true },
      '/health': { target: process.env.ADMIN_API_PROXY ?? 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
