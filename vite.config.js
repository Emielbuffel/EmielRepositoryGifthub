import { defineConfig } from 'vite';

// base './' so the built app works from Capacitor's local file server on iOS and macOS.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'safari15', assetsInlineLimit: 0, chunkSizeWarningLimit: 800 },
  server: { host: true },
});
