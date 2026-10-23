/**
 * The ground worker: paints pieces of the ground (see groundPiece.ts) away
 * from the game, and hands each back as a picture, so the game never waits
 * for one. It has its own copy of the map, told when a tree falls (its
 * shadow goes).
 */

import type { GameMap } from '../map/osm';
import { newCanvas } from './canvas';
import type { Palette } from './ground';
import { artPalette } from './groundArt';
import { PIECE, paintPiece } from './groundPiece';
import { Terrain } from './terrain';
import { assembleWork } from '../map/regions';
import { TileStore } from '../map/tileStore';
import { layOut } from './layout';
import { type World, indexChunks } from './world';
import { drain } from './work.ts';

export type ToWorker =
  | { type: 'map'; map: GameMap; chunks: World['chunks'] }
  | { type: 'prepare'; id: number; base: string; keys: string[]; bounds: { x0: number; y0: number; x1: number; y1: number } }
  | { type: 'use'; id: number }
  | { type: 'trees'; trees: number[] }
  | { type: 'felled'; felled: number[] }
  | { type: 'paint'; i: number; j: number; id: number };
export type FromWorker = { type: 'painted'; id: number; i: number; j: number; picture: ImageBitmap } | { type: 'need'; id: number };

let world: World | undefined;
let terrain: Terrain;
let palette: Palette;

/**
 * The regions made ready ahead (asked as soon as the next is chosen): their map put together from the same tiles as the game's,
 * laid out (the gardens' and places' ground put down on it) and indexed by piece, just as the game makes its own. Taken up when
 * the game moves into one, so its map needn't be sent (copying it held the game up a tenth of a second or more).
 */
const prepared = new Map<number, Promise<{ map: GameMap; chunks: World['chunks'] }>>();
let store: Promise<TileStore> | null = null;

async function prepare(m: Extract<ToWorker, { type: 'prepare' }>): Promise<{ map: GameMap; chunks: World['chunks'] }> {
  store ??= TileStore.open(m.base);
  const s = await store;
  const tiles = await s.get(m.keys);
  s.keep(m.keys);
  const map = drain(assembleWork(s.index, tiles, m.bounds));
  layOut(map);
  return { map, chunks: drain(indexChunks(map)) };
}

async function handle(m: ToWorker): Promise<void> {
  if (m.type === 'map') {
    world = { map: m.map, chunks: m.chunks } as World;
    setUp(m.map);
  } else if (m.type === 'prepare') {
    const p = prepare(m);
    // (Not one that couldn't be: the game sends its map.)
    p.catch(() => {});
    prepared.set(m.id, p);
  } else if (m.type === 'use') {
    const p = prepared.get(m.id);
    prepared.clear();
    try {
      if (!p) throw new Error('not prepared');
      const { map, chunks } = await p;
      world = { map, chunks } as World;
      setUp(map);
    } catch {
      const reply: FromWorker = { type: 'need', id: m.id };
      (self as unknown as Worker).postMessage(reply);
    }
  } else if (m.type === 'trees') {
    if (world) world.map.trees = m.trees;
  } else if (m.type === 'felled') {
    if (world) for (const i of m.felled) world.map.trees[i * 4 + 2] = 0;
  } else {
    if (!world) return;
    const canvas = newCanvas(PIECE, PIECE) as unknown as OffscreenCanvas;
    paintPiece(canvas.getContext('2d') as unknown as CanvasRenderingContext2D, world, terrain, palette, m.i, m.j);
    const picture = canvas.transferToImageBitmap();
    const reply: FromWorker = { type: 'painted', id: m.id, i: m.i, j: m.j, picture };
    (self as unknown as Worker).postMessage(reply, [picture]);
  }
}

function setUp(map: GameMap): void {
  terrain = new Terrain(map.terrain, map.pxPerMetre, map.ledges);
  palette ??= artPalette(newCanvas(1, 1).getContext('2d')!);
}

// (One at a time, in the order sent: what's painted after a region's taken up is painted from it, however long it takes.)
let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  queue = queue.then(() => handle(m)).catch((err) => console.error('ground:', err));
};
