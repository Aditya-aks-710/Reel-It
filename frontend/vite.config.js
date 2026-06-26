import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend dev server. API calls (/api, /health) are proxied to the Express
// backend so there are no CORS issues during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
  build: {
    // Build into client/dist; the backend serves this folder in production.
    outDir: 'dist',
  },
});
