import { readFileSync, statSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import type { GameMap } from './src/map/osm';
import { splitMap } from './src/map/regions';
import { overviewOf } from './src/world/overview';

const MAP = 'src/map/bristol.json';

/**
 * The map, in tiles (see src/map/regions.ts), for the game to fetch as it
 * needs them (it never holds the whole map): `map/index.json`, and a file a
 * tile, `map/t/<i>_<j>.json`; and what the pause menu's map is drawn from,
 * `map/overview.json` (see src/world/overview.ts). Cut from bristol.json when
 * the game's built, and as asked for while developing (again whenever
 * bristol.json changes).
 */
function mapTiles(): Plugin {
  let cut: { at: number; split: ReturnType<typeof splitMap> & { overview: ReturnType<typeof overviewOf> } } | null = null;
  const split = () => {
    const at = statSync(MAP).mtimeMs;
    if (!cut || cut.at !== at) {
      const map = JSON.parse(readFileSync(MAP, 'utf8')) as GameMap;
      cut = { at, split: { ...splitMap(map), overview: overviewOf(map) } };
    }
    return cut.split;
  };
  return {
    name: 'map-tiles',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/map\/(?:(index|overview)|t\/(\d+)_(\d+))\.json(?:\?.*)?$/);
        if (!m) return next();
        const { index, tiles, overview } = split();
        const body = m[1] === 'index' ? index : m[1] === 'overview' ? overview : tiles.get(`${m[2]},${m[3]}`);
        if (!body) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      });
    },
    generateBundle() {
      const { index, tiles, overview } = split();
      this.emitFile({ type: 'asset', fileName: 'map/index.json', source: JSON.stringify(index) });
      this.emitFile({ type: 'asset', fileName: 'map/overview.json', source: JSON.stringify(overview) });
      for (const t of tiles.values()) this.emitFile({ type: 'asset', fileName: `map/t/${t.i}_${t.j}.json`, source: JSON.stringify(t) });
    },
  };
}

export default defineConfig({
  // Relative asset paths so the build works from any sub-path.
  base: './',
  plugins: [mapTiles()],
  // Phaser alone is ~1.3 MB minified (~360 kB gzipped); the map isn't in the code (it's fetched, a tile at a time).
  build: {
    // Down-level modern syntax so older iPhones (iOS 14+) can run it.
    target: ['es2020', 'safari14'],
    chunkSizeWarningLimit: 2200,
  },
  // Only this game's tests (not the example code's). Some walk the people or the traffic round the whole map for
  // a while, which takes a few seconds: 30 s each, so a slow machine doesn't fail them.
  test: { include: ['src/**/*.test.ts'], testTimeout: 30_000 },
});
