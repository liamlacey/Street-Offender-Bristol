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
  private readonly sheets: { sheet: TerrainSheet; key: string; x0: number; y0: number; x1: number; y1: number; texture: Phaser.Textures.CanvasTexture; half: number }[] = [];

  constructor(scene: Phaser.Scene, private readonly decks: Decks) {
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
      this.sheets.push({ sheet, key, x0, y0, x1, y1, texture, half: deck.road.width / 2 });
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const { sheet, key } of this.sheets) {
        sheet.destroy();
        scene.textures.remove(key);
      }
    });
  }

  /**
   * A parapet's been knocked through between two points (along its line):
   * that stretch of it's gone from its deck's picture, the drop beneath
   * showing through.
   */
  breakParapet(from: [number, number], to: [number, number]): void {
    const [mx, my] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    // The deck whose parapet it is: the one whose edge it's along.
    let best = -1;
    let bestOff = 6;
    this.sheets.forEach((s, i) => {
      if (mx < s.x0 - 8 || mx > s.x1 + 8 || my < s.y0 - 8 || my > s.y1 + 8) return;
      const off = Math.abs(nearestAlong(this.decks.decks[i].road.pts, mx, my).distance - s.half - 2);
      if (off < bestOff) [best, bestOff] = [i, off];
    });
    for (const s of best < 0 ? [] : [this.sheets[best]]) {
      const ctx = s.texture.context;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, -s.x0, -s.y0);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineCap = 'butt';
      ctx.lineWidth = 7.5;
      ctx.beginPath();
      ctx.moveTo(from[0], from[1]);
      ctx.lineTo(to[0], to[1]);
      ctx.stroke();
      // Its broken ends, rough.
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#6f6656';
      for (const [px, py] of [from, to]) {
        ctx.beginPath();
        ctx.arc(px, py, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      s.texture.refresh();
    }
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
