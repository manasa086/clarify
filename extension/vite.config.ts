import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds the popup React app to dist/.
// Background service worker and content script are built separately
// by scripts/build-scripts.js using esbuild (they require different
// output formats: esm for background, iife for content script).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
