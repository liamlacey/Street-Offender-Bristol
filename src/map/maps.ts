/**
 * The maps there are to play: Bristol, and others made the same way (see src/map/README.md's "Other maps"). Each has its own
 * sources (and list of areas), its own made map, its own tiles, served apart, and its own credit. Which is played is chosen in
 * the pause menu (MAPS), and remembered.
 */

export interface MapInfo {
  id: string;
  /** As it's shown (in the pause menu). */
  name: string;
  /** The credit kept on the screen (its data's sources: see the README). */
  credit: string;
  /** Where its sources are kept (its areas.json, a folder an area), from the project's root. */
  sources: string;
  /** The map made from them (see tools/build-map.ts). */
  file: string;
  /** Where its tiles are fetched from, from the game's page (see vite.config.ts). */
  base: string;
}

export const MAPS: MapInfo[] = [
  {
    id: 'bristol',
    name: 'Bristol',
    credit: '© OpenStreetMap contributors · LIDAR © Environment Agency (OGL)',
    sources: 'map-sources',
    file: 'src/map/bristol.json',
    base: 'map/',
  },
  {
    id: 'llanidloes',
    name: 'Llanidloes & Y Fan',
    credit: '© OpenStreetMap contributors · LIDAR © Welsh Government (OGL)',
    sources: 'map-sources/maps/llanidloes',
    file: 'src/map/llanidloes.json',
    base: 'map/llanidloes/',
  },
];

/** Where the choice is remembered (on this phone). */
const CHOSEN = 'street-offender:map';

/** The map being played: `?map=` on the address, else the one last chosen, else Bristol. */
export function currentMap(): MapInfo {
  let id: string | null = null;
  try {
    id = new URLSearchParams(location.search).get('map') ?? localStorage.getItem(CHOSEN);
  } catch {
    // (No storage to be had: Bristol.)
  }
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

/** Plays another map: remembered, and the game loaded again, on it. */
export function chooseMap(id: string): void {
  try {
    localStorage.setItem(CHOSEN, id);
  } catch {
    // (Not remembered: just this once.)
  }
  const url = new URL(location.href);
  url.searchParams.set('map', id);
  location.href = url.toString();
}
