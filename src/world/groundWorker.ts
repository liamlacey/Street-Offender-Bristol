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
import { type World, buildWorld } from './world';

export type ToWorker = { type: 'map'; map: GameMap } | { type: 'trees'; trees: number[] } | { type: 'paint'; i: number; j: number; id: number };
export type FromWorker = { id: number; i: number; j: number; picture: ImageBitmap };

let world: World;
let terrain: Terrain;
let palette: Palette;

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'map') {
    world = buildWorld(m.map);
    terrain = new Terrain(m.map.terrain, m.map.pxPerMetre, m.map.ledges);
    palette = artPalette(newCanvas(1, 1).getContext('2d')!);
  } else if (m.type === 'trees') {
    world.map.trees = m.trees;
  } else {
    const canvas = newCanvas(PIECE, PIECE) as unknown as OffscreenCanvas;
    paintPiece(canvas.getContext('2d') as unknown as CanvasRenderingContext2D, world, terrain, palette, m.i, m.j);
    const picture = canvas.transferToImageBitmap();
    const reply: FromWorker = { id: m.id, i: m.i, j: m.j, picture };
    (self as unknown as Worker).postMessage(reply, [picture]);
  }
};
