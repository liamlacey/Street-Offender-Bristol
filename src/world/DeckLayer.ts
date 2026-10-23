import * as Phaser from 'phaser';
import { type Decks, nearestAlong } from './decks';
import { drawDeck } from './ground';
import { artPalette } from './groundArt';
import type { Perspective } from './perspective';
import { TerrainSheet } from './TerrainSheet';
import { softTexture } from './canvas';

/** The pieces a deck's picture is drawn in, px (a long bridge on the slant would be a huge picture in one). */
const PIECE = 512;
/** Pieces this near the view are drawn; well out of it, let go, px. */
const NEAR = 240;
const FAR = 800;
/** New pieces drawn a frame, at most (so coming up to a big bridge never holds a frame up for long). */
const PER_FRAME = 2;
/** How see-through a deck is with you under it, and how quickly it fades to that (or back), a frame. */
const SEE_THROUGH = 0.35;
const FADE = 0.08;

type Sheet = DeckLayer['sheets'][number];

/**
 * The bridges' decks, drawn above the ground at their own height (so they
 * rise towards the camera like everything else up off the map), over the
 * car when it's below and under it when it's on top.
 */
export class DeckLayer {
  /**
   * Each deck: where it is (and its name, by where it is: see `use`); its
   * picture, in pieces (each on a sheet that rises towards the camera), only
   * those near the view; and the stretches of its parapet knocked through, to
   * cut out of it again.
   */
  private sheets: { name: string; x0: number; y0: number; x1: number; y1: number; half: number; alpha: number; pieces: Map<string, { sheet: TerrainSheet; key: string; texture: Phaser.Textures.CanvasTexture }>; broken: [number, number, number, number][] }[] = [];
  /** Every stretch of parapet knocked through (for the next region's decks: see `use`). */
  private readonly breaks: [[number, number], [number, number]][] = [];
  private made = 0;
  private readonly palette = artPalette(document.createElement('canvas').getContext('2d')!);

  constructor(
    private readonly scene: Phaser.Scene,
    private decks: Decks,
  ) {
    this.use(decks);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const s of this.sheets) this.unmake(s);
    });
  }

  /** The next region's decks (see streamer.ts): a bridge in both keeps its pictures; any of its parapet that's been knocked through, cut out. */
  use(decks: Decks): void {
    const had = new Map(this.sheets.map((s) => [s.name, s]));
    this.decks = decks;
    this.sheets = decks.decks.map((deck) => {
      const p = deck.road.pts;
      const name = `${deck.road.kind},${p[0]},${p[1]},${p[p.length - 2]},${p[p.length - 1]}`;
      const old = had.get(name);
      if (old) {
        had.delete(name);
        return old;
      }
      const { x0, y0, x1, y1 } = deck;
      return { name, x0, y0, x1, y1, half: deck.road.width / 2, alpha: 1, pieces: new Map(), broken: [] };
    });
    for (const s of had.values()) this.unmake(s);
    for (const s of this.sheets) {
      if (s.broken.length) continue;
      for (const [from, to] of this.breaks) this.breakParapet(from, to, s);
    }
  }

  /** A piece of a deck's picture (its corner at (px, py)), now it's near the view: drawn, with any of its parapet that's been knocked through cut out. */
  private make(i: number, px: number, py: number): TerrainSheet {
    const s = this.sheets[i];
    const at = `${px},${py}`;
    const had = s.pieces.get(at);
    if (had) return had.sheet;
    const deck = this.decks.decks[i];
    const [w, h] = [Math.ceil(Math.min(PIECE, s.x1 - px)), Math.ceil(Math.min(PIECE, s.y1 - py))];
    const key = `deck:${this.made++}`;
    const texture = softTexture(this.scene, key, w, h);
    const ctx = texture.context;
    ctx.translate(-px, -py);
    drawDeck(ctx, deck.road, this.palette, this.decks.raised(deck), this.decks.edges(deck));
    // (Its parapet's broken stretches cut out first: then sent to the GPU once.)
    for (const [ax, ay, bx, by] of s.broken) if (touches(px, py, w, h, ax, ay, bx, by)) this.cutPiece(texture, px, py, [ax, ay], [bx, by]);
    texture.refresh();
    // Each corner at the deck's height where it is (beyond its ends, the end's height).
    const height = (x: number, y: number) => this.decks.height(deck, nearestAlong(deck.road.pts, x, y).along);
    const sheet = new TerrainSheet(this.scene, key, px, py, w, h, 0, height);
    s.pieces.set(at, { sheet, key, texture });
    return sheet;
  }

  /** A deck's pictures all let go. */
  private unmake(s: Sheet): void {
    for (const at of [...s.pieces.keys()]) this.unmakePiece(s, at);
  }

  private unmakePiece(s: Sheet, at: string): void {
    const p = s.pieces.get(at);
    if (!p) return;
    p.sheet.destroy();
    this.scene.textures.remove(p.key);
    s.pieces.delete(at);
  }

  /**
   * A parapet's been knocked through between two points (along its line):
   * that stretch of it's gone from its deck's picture, the drop beneath
   * showing through.
   */
  breakParapet(from: [number, number], to: [number, number], only?: Sheet): void {
    if (!only) this.breaks.push([from, to]);
    const [mx, my] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    // The deck whose parapet it is: the one whose edge it's along.
    let best = -1;
    let bestOff = 6;
    this.sheets.forEach((s, i) => {
      if (only && s !== only) return;
      if (mx < s.x0 - 8 || mx > s.x1 + 8 || my < s.y0 - 8 || my > s.y1 + 8) return;
      const off = Math.abs(nearestAlong(this.decks.decks[i].road.pts, mx, my).distance - s.half - 2);
      if (off < bestOff) [best, bestOff] = [i, off];
    });
    for (const s of best < 0 ? [] : [this.sheets[best]]) {
      s.broken.push([from[0], from[1], to[0], to[1]]);
      // (Only the pieces it's in: each sent to the GPU again, once.)
      for (const [at, p] of s.pieces) {
        const [px, py] = at.split(',').map(Number);
        if (!touches(px, py, p.texture.width, p.texture.height, from[0], from[1], to[0], to[1])) continue;
        this.cutPiece(p.texture, px, py, from, to);
        p.texture.refresh();
      }
    }
  }

  /** That stretch of a parapet cut out of a piece of its deck's picture (not yet sent to the GPU: the caller refreshes it). */
  private cutPiece(texture: Phaser.Textures.CanvasTexture, px: number, py: number, from: [number, number], to: [number, number]): void {
    const ctx = texture.context;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, -px, -py);
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
    for (const [x, y] of [from, to]) {
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Every piece out of sight (a tunnel's, while you're not down in it). */
  hide(): void {
    for (const s of this.sheets) for (const p of s.pieces.values()) p.sheet.setVisible(false);
  }

  /**
   * Call once a frame: lays the decks near the view where the perspective
   * puts them, each at its depth (the pieces of them near it, drawn as they
   * come near); see-through, fading to it, while `under` says you're beneath it.
   */
  update(view: Phaser.Geom.Rectangle, perspective: Perspective, depthOf: (deck: number) => number, under: (deck: number) => boolean = () => false): void {
    let fresh = 0;
    for (const [i, s] of this.sheets.entries()) {
      // Its pieces well out of view: let go.
      for (const [at, p] of s.pieces) {
        const [px, py] = at.split(',').map(Number);
        const far = px + PIECE < view.left - FAR || px > view.right + FAR || py + PIECE < view.top - FAR || py > view.bottom + FAR;
        if (far) this.unmakePiece(s, at);
        else p.sheet.setVisible(false);
      }
      if (s.x1 < view.left - NEAR || s.x0 > view.right + NEAR || s.y1 < view.top - NEAR || s.y0 > view.bottom + NEAR) continue;
      const depth = depthOf(i);
      const road = this.decks.decks[i].road;
      const alpha = under(i) ? SEE_THROUGH : 1;
      if (s.alpha !== alpha) s.alpha += Math.sign(alpha - s.alpha) * Math.min(Math.abs(alpha - s.alpha), FADE);
      // The pieces near the view the deck runs through.
      for (let px = s.x0 + Math.max(0, Math.floor((view.left - NEAR - s.x0) / PIECE)) * PIECE; px < Math.min(s.x1, view.right + NEAR); px += PIECE) {
        for (let py = s.y0 + Math.max(0, Math.floor((view.top - NEAR - s.y0) / PIECE)) * PIECE; py < Math.min(s.y1, view.bottom + NEAR); py += PIECE) {
          if (!s.pieces.has(`${px},${py}`)) {
            if (fresh >= PER_FRAME || !crosses(road.pts, px, py, road.width / 2 + 12)) continue;
            fresh++;
          }
          const sheet = this.make(i, px, py);
          sheet.setVisible(true);
          if (sheet.mesh.depth !== depth) sheet.mesh.setDepth(depth);
          if (sheet.mesh.alpha !== s.alpha) sheet.mesh.setAlpha(s.alpha);
          sheet.update(perspective);
        }
      }
    }
  }
}

/** Whether a stretch of parapet (its broken ends a little round it) reaches into a piece's picture, w by h at (px, py). */
function touches(px: number, py: number, w: number, h: number, ax: number, ay: number, bx: number, by: number): boolean {
  const pad = 6;
  return Math.max(ax, bx) > px - pad && Math.min(ax, bx) < px + w + pad && Math.max(ay, by) > py - pad && Math.min(ay, by) < py + h + pad;
}

/** Whether a line comes within `pad` px of a PIECE square (its corner at (px, py)). */
function crosses(pts: number[], px: number, py: number, pad: number): boolean {
  const [x0, y0, x1, y1] = [px - pad, py - pad, px + PIECE + pad, py + PIECE + pad];
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const [ax, ay, bx, by] = [pts[k], pts[k + 1], pts[k + 2], pts[k + 3]];
    if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) continue;
    // (Near enough: its box reaches into the square's. A segment on the slant across a corner's box may not, quite: drawn anyway, empty.)
    return true;
  }
  return false;
}
