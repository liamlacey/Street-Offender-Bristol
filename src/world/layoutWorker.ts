/**
 * The layout worker: given the tiles of the next region (and where it is), fetches them (the browser has them already, as
 * often as not), puts the region's map together just as the game does, lays it out (see layout.ts) and hands that back, so
 * the game needn't, in its frames.
 */

import { assembleWork } from '../map/regions';
import { TileStore } from '../map/tileStore';
import { type Layout, layOut } from './layout';
import { drain } from './work.ts';

export type ToLayout = { id: number; base: string; keys: string[]; bounds: { x0: number; y0: number; x1: number; y1: number } };
export type FromLayout = { id: number; layout: Layout | null };

let store: Promise<TileStore> | null = null;

self.onmessage = async (e: MessageEvent<ToLayout>) => {
  const { id, base, keys, bounds } = e.data;
  let layout: Layout | null = null;
  try {
    store ??= TileStore.open(base);
    const s = await store;
    const tiles = await s.get(keys);
    s.keep(keys);
    layout = layOut(drain(assembleWork(s.index, tiles, bounds)));
  } catch (err) {
    // (The game lays it out itself.)
    console.error('layout:', err);
  }
  const reply: FromLayout = { id, layout };
  (self as unknown as Worker).postMessage(reply);
};
