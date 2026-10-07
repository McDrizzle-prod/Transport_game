import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.API_TARGET ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  // The game uses no PostCSS plugins. An inline (empty) config stops Vite from searching for
  // PostCSS config files in parent folders, where a stray empty/broken file breaks the build.
  css: { postcss: {} },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': apiTarget,
      '/ws': { target: apiTarget.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
