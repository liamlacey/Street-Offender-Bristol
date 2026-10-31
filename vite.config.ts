import { existsSync, readFileSync, statSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { MAPS, type MapInfo } from './src/map/maps';
import type { GameMap } from './src/map/osm';
import { splitMap } from './src/map/regions';
import { overviewOf } from './src/world/overview';

/**
 * Each map (see src/map/maps.ts), in tiles (see src/map/regions.ts), for the
 * game to fetch as it needs them (it never holds the whole map): under the
 * map's `base` (Bristol's `map/`, the others' `map/<id>/`), `index.json`, and a
 * file a tile, `t/<i>_<j>.json`; and what the pause menu's map is drawn from,
 * `overview.json` (see src/world/overview.ts). Cut from the map's made file
 * (bristol.json, ...) when the game's built, and as asked for while
 * developing (again whenever it changes). A map not made yet is left out.
 */
function mapTiles(): Plugin {
  type Cut = ReturnType<typeof splitMap> & { overview: ReturnType<typeof overviewOf> };
  const cuts = new Map<string, { at: number; split: Cut }>();
  const made = () => MAPS.filter((m) => existsSync(m.file));
  const split = (m: MapInfo): Cut => {
    const at = statSync(m.file).mtimeMs;
    let cut = cuts.get(m.id);
    if (!cut || cut.at !== at) {
      const map = JSON.parse(readFileSync(m.file, 'utf8')) as GameMap;
      cut = { at, split: { ...splitMap(map), overview: overviewOf(map) } };
      cuts.set(m.id, cut);
    }
    return cut.split;
  };
  return {
    name: 'map-tiles',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/(map\/(?:[a-z-]+\/)?)(?:(index|overview)|t\/(\d+)_(\d+))\.json(?:\?.*)?$/);
        const info = m && made().find((i) => i.base === m[1]);
        if (!m || !info) return next();
        const { index, tiles, overview } = split(info);
        const body = m[2] === 'index' ? index : m[2] === 'overview' ? overview : tiles.get(`${m[3]},${m[4]}`);
        if (!body) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      });
    },
    generateBundle() {
      for (const info of made()) {
        const { index, tiles, overview } = split(info);
        this.emitFile({ type: 'asset', fileName: `${info.base}index.json`, source: JSON.stringify(index) });
        this.emitFile({ type: 'asset', fileName: `${info.base}overview.json`, source: JSON.stringify(overview) });
        for (const t of tiles.values()) this.emitFile({ type: 'asset', fileName: `${info.base}t/${t.i}_${t.j}.json`, source: JSON.stringify(t) });
      }
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
