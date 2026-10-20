/**
 * The map's tiles, fetched as they're needed (see regions.ts, and the
 * map-tiles plugin in vite.config.ts that serves them), and kept only while
 * they are: the region round you, and the next one being made ready.
 */

import { type MapIndex, type Tile, tileKey } from './regions';

export class TileStore {
  private readonly held = new Map<string, Tile>();
  private readonly coming = new Map<string, Promise<Tile>>();

  private constructor(readonly index: MapIndex) {}

  /** The map's index, and a store for its tiles. */
  static async open(base = 'map/'): Promise<TileStore> {
    const store = new TileStore(await fetchJson<MapIndex>(`${base}index.json`));
    store.base = base;
    return store;
  }

  private base = 'map/';

  /** These tiles ("i,j"), fetched if they're not here already (each once, however many ask for it). */
  async get(keys: string[]): Promise<Tile[]> {
    return Promise.all(
      keys.map((k) => {
        const have = this.held.get(k);
        if (have) return have;
        let p = this.coming.get(k);
        if (!p) {
          const [i, j] = k.split(',');
          p = fetchJson<Tile>(`${this.base}t/${i}_${j}.json`).then((t) => {
            this.coming.delete(k);
            this.held.set(k, t);
            return t;
          });
          this.coming.set(k, p);
        }
        return p;
      }),
    );
  }

  /** Lets go of all but these tiles. */
  keep(keys: Iterable<string>): void {
    const want = new Set(keys);
    for (const k of [...this.held.keys()]) if (!want.has(k)) this.held.delete(k);
  }

  /** How many tiles it's holding. */
  get size(): number {
    return this.held.size;
  }
}

/** A JSON file, tried a few times (a phone's connection drops now and then). */
export async function fetchJson<T>(url: string): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  throw last;
}

export { tileKey };
