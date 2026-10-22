/**
 * For the tests: the whole map, read as the game's build reads it (see vite.config.ts). It's too big to import as a module.
 */

import { readFileSync } from 'node:fs';
import type { GameMap } from '../map/osm';

const bristol: GameMap = JSON.parse(readFileSync(new URL('../map/bristol.json', import.meta.url), 'utf8'));
export default bristol;
