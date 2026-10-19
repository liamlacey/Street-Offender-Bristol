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
  /**
   * Each deck: where it is, and its picture (drawn on a sheet that rises
   * towards the camera) only while it's near the view (a big map has many
   * bridges, some long and on the slant, each picture as big as its box);
   * the stretches of parapet knocked through, to cut out of it again.
   */
  private readonly sheets: { key: string; x0: number; y0: number; x1: number; y1: number; half: number; made: { sheet: TerrainSheet; texture: Phaser.Textures.CanvasTexture } | null; broken: [number, number, number, number][] }[] = [];
  private readonly palette = artPalette(document.createElement('canvas').getContext('2d')!);

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly decks: Decks,
  ) {
    decks.decks.forEach((deck, i) => {
      const { x0, y0, x1, y1 } = deck;
      this.sheets.push({ key: `deck:${i}`, x0, y0, x1, y1, half: deck.road.width / 2, made: null, broken: [] });
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const s of this.sheets) this.unmake(s);
    });
  }

  /** A deck's picture, now it's near the view: drawn, with any of its parapet that's been knocked through cut out. */
  private make(i: number): NonNullable<DeckLayer['sheets'][number]['made']> {
    const s = this.sheets[i];
    if (s.made) return s.made;
    const deck = this.decks.decks[i];
    const { x0, y0, x1, y1, key } = s;
    const [w, h] = [Math.ceil(x1 - x0), Math.ceil(y1 - y0)];
    const texture = this.scene.textures.createCanvas(key, w, h)!;
    const ctx = texture.context;
    ctx.translate(-x0, -y0);
    drawDeck(ctx, deck.road, this.palette);
    texture.refresh();
    // Each corner at the deck's height where it is (beyond its ends, the end's height).
    const height = (x: number, y: number) => this.decks.height(deck, nearestAlong(deck.road.pts, x, y).along);
    const sheet = new TerrainSheet(this.scene, key, x0, y0, w, h, 0, height);
    s.made = { sheet, texture };
    for (const [ax, ay, bx, by] of s.broken) this.cut(s, [ax, ay], [bx, by]);
    return s.made;
  }

  /** Far off: its picture let go (made again if it's come back to). */
  private unmake(s: DeckLayer['sheets'][number]): void {
    if (!s.made) return;
    s.made.sheet.destroy();
    this.scene.textures.remove(s.key);
    s.made = null;
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
      s.broken.push([from[0], from[1], to[0], to[1]]);
      if (s.made) this.cut(s, from, to);
    }
  }

  /** That stretch of a parapet cut out of its deck's picture. */
  private cut(s: DeckLayer['sheets'][number], from: [number, number], to: [number, number]): void {
    {
      const ctx = s.made!.texture.context;
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
      s.made!.texture.refresh();
    }
  }

  /** Call once a frame: lays the decks near the view where the perspective puts them, each at its depth. */
  update(view: Phaser.Geom.Rectangle, perspective: Perspective, depthOf: (deck: number) => number): void {
    const pad = 200;
    for (const [i, s] of this.sheets.entries()) {
      const near = s.x1 > view.left - pad && s.x0 < view.right + pad && s.y1 > view.top - pad && s.y0 < view.bottom + pad;
      // Well out of view: let go.
      const far = s.x1 < view.left - 4 * pad || s.x0 > view.right + 4 * pad || s.y1 < view.top - 4 * pad || s.y0 > view.bottom + 4 * pad;
      if (far) this.unmake(s);
      if (!near) {
        s.made?.sheet.setVisible(false);
        continue;
      }
      const { sheet } = this.make(i);
      sheet.setVisible(true);
      const depth = depthOf(i);
      if (sheet.mesh.depth !== depth) sheet.mesh.setDepth(depth);
      sheet.update(perspective);
    }
  }
}
