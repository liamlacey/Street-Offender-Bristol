import * as Phaser from 'phaser';
import { type Decks, nearestAlong } from './decks';
import { drawDeck } from './ground';
import { artPalette } from './groundArt';
import type { Perspective } from './perspective';
import { TerrainSheet } from './TerrainSheet';

/**
 * The bridges' decks, drawn above the ground at their own height (so they
 * rise towards the camera like everything else up off the map), over the
 * car when it's below and under it when it's on top.
 */
export class DeckLayer {
  private readonly sheets: { sheet: TerrainSheet; key: string; x0: number; y0: number; x1: number; y1: number }[] = [];

  constructor(scene: Phaser.Scene, decks: Decks) {
    const palette = artPalette(document.createElement('canvas').getContext('2d')!);
    decks.decks.forEach((deck, i) => {
      const { x0, y0, x1, y1 } = deck;
      const [w, h] = [Math.ceil(x1 - x0), Math.ceil(y1 - y0)];
      const key = `deck:${i}`;
      const texture = scene.textures.createCanvas(key, w, h)!;
      const ctx = texture.context;
      ctx.translate(-x0, -y0);
      drawDeck(ctx, deck.road, palette);
      texture.refresh();
      // Each corner at the deck's height where it is (beyond its ends, the end's height).
      const height = (x: number, y: number) => decks.height(deck, nearestAlong(deck.road.pts, x, y).along);
      const sheet = new TerrainSheet(scene, key, x0, y0, w, h, 0, height);
      this.sheets.push({ sheet, key, x0, y0, x1, y1 });
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const { sheet, key } of this.sheets) {
        sheet.destroy();
        scene.textures.remove(key);
      }
    });
  }

  /** Call once a frame: lays the decks near the view where the perspective puts them, each at its depth. */
  update(view: Phaser.Geom.Rectangle, perspective: Perspective, depthOf: (deck: number) => number): void {
    const pad = 200;
    for (const [i, s] of this.sheets.entries()) {
      const depth = depthOf(i);
      const near = s.x1 > view.left - pad && s.x0 < view.right + pad && s.y1 > view.top - pad && s.y0 < view.bottom + pad;
      s.sheet.setVisible(near);
      if (!near) continue;
      if (s.sheet.mesh.depth !== depth) s.sheet.mesh.setDepth(depth);
      s.sheet.update(perspective);
    }
  }
}
