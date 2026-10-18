import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works from any sub-path.
  base: './',
  // Phaser alone is ~1.3 MB minified (~360 kB gzipped), and the map ~0.45 MB (~100 kB gzipped); that's expected.
  build: {
    // Down-level modern syntax so older iPhones (iOS 14+) can run it.
    target: ['es2020', 'safari14'],
    chunkSizeWarningLimit: 2200,
  },
  // Only this game's tests (not the example code's).
  test: { include: ['src/**/*.test.ts'] },
});
