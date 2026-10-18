import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  // Phaser alone is ~1.3 MB minified (~360 kB gzipped); that's expected.
  build: {
    // Down-level modern syntax so older iPhones (iOS 14+) can run it.
    target: ['es2020', 'safari14'],
    chunkSizeWarningLimit: 1600,
  },
});
