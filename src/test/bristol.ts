/**
 * For the tests: the whole map, read as the game's build reads it (see vite.config.ts). It's too big to import as a module.
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { GameMap } from '../map/osm';

const bristol: GameMap = JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(new URL('../map/bristol.json.gz', import.meta.url)))));
export default bristol;
