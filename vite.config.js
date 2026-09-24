import { defineConfig } from 'vite';

export default defineConfig({
  // Packaged desktop loads dist/index.html from file:// inside app.asar —
  // absolute "/assets/…" URLs break with file://  (they resolve against the
  // filesystem root, not the app root). Relative asset URLs are required.
  base: './',
  server: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: false,
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true
  },
  build: {
    target: 'es2020',
    sourcemap: false
  }
});
