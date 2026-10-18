import * as Phaser from 'phaser';
import { BLOCK, CELL, COLS, type Island, ROAD_WIDTH, ROAD_WIDTHS, type RoadKind, SIZE, type Vec2, YARD, harbourPoint, heightAt, railPose, townPoint } from './island';
import { hash, noise } from './noise';
import { TANK_TEXTURE } from './art';

/** Size of a piece of ground, px, and of the picture it's drawn at (stretched to fit, smoothly). */
export const CHUNK = 512;
const RES = 256;
const SCALE = CHUNK / RES;
/** Each picture reaches a pixel past its piece all round, so neighbours blend without a seam. */
const PAD = 1;
const SIZE_PX = RES + PAD * 2;
/** How long to collect marks before re-uploading a piece of ground to the GPU, s. */
const REFRESH = 0.12;

type RGB = [number, number, number];
const COLOURS: Record<string, RGB> = {
  deep: [24, 66, 112],
  shallow: [46, 128, 152],
  foam: [214, 236, 238],
  sand: [222, 204, 150],
  wetSand: [196, 176, 124],
  grass: [104, 150, 62],
  meadow: [124, 160, 70],
  forest: [62, 102, 44],
  hills: [126, 134, 86],
  rock: [128, 122, 114],
  snow: [238, 242, 246],
};

/** Something left on the ground: a scorch mark and crater, the tank's tracks, or something lying there (painted from the art). */
export type Mark =
  | { t: 'scorch'; x: number; y: number; r: number }
  | { t: 'tread'; x: number; y: number; a: number }
  | { t: 'stamp'; frame: string; x: number; y: number; a: number; s: number; alpha: number };

interface Piece {
  key: string;
  texture: Phaser.Textures.CanvasTexture;
  image: Phaser.GameObjects.Image;
  dirty: boolean;
}

/**
 * The island's ground, drawn piece by piece as the view comes near it (and
 * thrown away again once far behind): sea shading from deep blue to turquoise
 * with surf at the shore, sand, meadows and forest floor, hills, rock and
 * snow lit from the top left, the dirt tracks and village greens. Scorch
 * marks, craters, the tank's tracks and fallen debris are painted into it,
 * and kept, so they're still there when you come back.
 */
export class Terrain {
  private readonly pieces = new Map<number, Piece>();
  private readonly marks = new Map<number, Mark[]>();
  private readonly trackBoxes: { x0: number; y0: number; x1: number; y1: number }[];
  private readonly trailBoxes: { x0: number; y0: number; x1: number; y1: number }[];
  /** The railway in pieces (each with its two rails either side, and where it reaches), and the stations' platforms. */
  private readonly rails: { line: Vec2[]; left: Vec2[]; right: Vec2[]; box: { x0: number; y0: number; x1: number; y1: number } }[] = [];
  private readonly platforms: { line: Vec2[]; edge: Vec2[] }[] = [];
  private refreshDue = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly island: Island,
    private readonly depth: number,
  ) {
    const box = (t: Vec2[]) => {
      const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const p of t) {
        b.x0 = Math.min(b.x0, p.x - ROAD_WIDTH);
        b.y0 = Math.min(b.y0, p.y - ROAD_WIDTH);
        b.x1 = Math.max(b.x1, p.x + ROAD_WIDTH);
        b.y1 = Math.max(b.y1, p.y + ROAD_WIDTH);
      }
      return b;
    };
    this.trackBoxes = island.tracks.map(box);
    const r = island.railway;
    if (r) {
      const closed = [...r.line, r.line[0]];
      for (let k = 0; k < closed.length - 1; k += 40) {
        const line = closed.slice(k, Math.min(closed.length, k + 41));
        const side = (off: number) =>
          line.map((p, i) => {
            const a = line[Math.max(0, i - 1)];
            const b = line[Math.min(line.length - 1, i + 1)];
            const angle = Math.atan2(b.y - a.y, b.x - a.x);
            return { x: p.x - Math.sin(angle) * off, y: p.y + Math.cos(angle) * off };
          });
        this.rails.push({ line, left: side(-6), right: side(6), box: box(line) });
      }
      for (const st of r.stations) {
        const along = (off: number) => Array.from({ length: 23 }, (_, k) => {
          const pose = railPose(r, st.at - 110 + k * 10);
          return { x: pose.x - Math.sin(pose.angle) * off * st.side, y: pose.y + Math.cos(pose.angle) * off * st.side };
        });
        this.platforms.push({ line: along(27), edge: along(19) });
      }
    }
    this.trailBoxes = island.trails.map(box);
  }

  /** Makes the pieces in (and around) the view, at most `budget` new ones this frame; drops the far ones. */
  update(view: Phaser.Geom.Rectangle, dt: number, budget = 1): void {
    const x0 = Math.floor((view.left - CHUNK / 2) / CHUNK);
    const x1 = Math.floor((view.right + CHUNK / 2) / CHUNK);
    const y0 = Math.floor((view.top - CHUNK / 2) / CHUNK);
    const y1 = Math.floor((view.bottom + CHUNK / 2) / CHUNK);
    const n = SIZE / CHUNK;
    // Nearest the middle of the view first.
    const want: [number, number, number][] = [];
    for (let cy = Math.max(0, y0); cy <= Math.min(n - 1, y1); cy++) {
      for (let cx = Math.max(0, x0); cx <= Math.min(n - 1, x1); cx++) {
        if (!this.pieces.has(cy * n + cx)) want.push([cx, cy, Math.hypot((cx + 0.5) * CHUNK - view.centerX, (cy + 0.5) * CHUNK - view.centerY)]);
      }
    }
    want.sort((a, b) => a[2] - b[2]);
    for (const [cx, cy] of want.slice(0, budget)) this.build(cx, cy);
    for (const [id, piece] of this.pieces) {
      const cx = id % n;
      const cy = Math.floor(id / n);
      if (cx < x0 - 2 || cx > x1 + 2 || cy < y0 - 2 || cy > y1 + 2) {
        piece.image.destroy();
        this.scene.textures.remove(piece.key);
        this.pieces.delete(id);
      }
    }
    this.refreshDue -= dt;
    if (this.refreshDue <= 0) {
      this.refreshDue = REFRESH;
      for (const piece of this.pieces.values()) {
        if (!piece.dirty) continue;
        piece.texture.refresh();
        piece.dirty = false;
      }
    }
  }

  /** Leaves a mark on the ground, for good. */
  mark(m: Mark): void {
    const reach = (m.t === 'scorch' ? m.r : m.t === 'stamp' ? 40 * m.s : 20) + PAD * SCALE;
    const n = SIZE / CHUNK;
    for (let cy = Math.floor((m.y - reach) / CHUNK); cy <= Math.floor((m.y + reach) / CHUNK); cy++) {
      for (let cx = Math.floor((m.x - reach) / CHUNK); cx <= Math.floor((m.x + reach) / CHUNK); cx++) {
        if (cx < 0 || cy < 0 || cx >= n || cy >= n) continue;
        const id = cy * n + cx;
        const list = this.marks.get(id);
        if (list) list.push(m);
        else this.marks.set(id, [m]);
        const piece = this.pieces.get(id);
        if (piece) {
          this.drawMark(piece.texture.getContext(), cx, cy, m);
          piece.dirty = true;
        }
      }
    }
  }

  private build(cx: number, cy: number): void {
    const n = SIZE / CHUNK;
    const key = `ground-${this.island.seed}-${cx}-${cy}`;
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const texture = this.scene.textures.createCanvas(key, SIZE_PX, SIZE_PX)!;
    const ctx = texture.getContext();
    this.paintGround(ctx, cx, cy);
    this.paintTracks(ctx, cx, cy);
    for (const m of this.marks.get(cy * n + cx) ?? []) this.drawMark(ctx, cx, cy, m);
    texture.refresh();
    const image = this.scene.add
      .image(cx * CHUNK - PAD * SCALE, cy * CHUNK - PAD * SCALE, key)
      .setOrigin(0, 0)
      .setDisplaySize(SIZE_PX * SCALE, SIZE_PX * SCALE)
      .setDepth(this.depth);
    this.pieces.set(cy * n + cx, { key, texture, image, dirty: false });
  }

  /** The land itself, pixel by pixel. */
  private paintGround(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const { heights, moisture, seed } = this.island;
    const img = ctx.createImageData(SIZE_PX, SIZE_PX);
    const data = img.data;
    // Heights over the piece (and a border round it, for the slopes: measured across a whole cell, so they're smooth).
    const B = 4;
    const W = SIZE_PX + B * 2;
    const h = new Float32Array(W * W);
    const m = new Float32Array(W * W);
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const x = cx * CHUNK + (i - B - PAD + 0.5) * SCALE;
        const y = cy * CHUNK + (j - B - PAD + 0.5) * SCALE;
        h[j * W + i] = heightAt(heights, x, y);
        m[j * W + i] = heightAt(moisture, x, y);
      }
    }
    const out: RGB = [0, 0, 0];
    for (let j = 0; j < SIZE_PX; j++) {
      for (let i = 0; i < SIZE_PX; i++) {
        const k = (j + B) * W + (i + B);
        const wx = cx * CHUNK + (i - PAD) * SCALE;
        const wy = cy * CHUNK + (j - PAD) * SCALE;
        groundColour(h[k], m[k], (h[k + B] - h[k - B]) / B, (h[k + B * W] - h[k - B * W]) / B, wx, wy, seed, out);
        const p = (j * SIZE_PX + i) * 4;
        data[p] = out[0];
        data[p + 1] = out[1];
        data[p + 2] = out[2];
        data[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** The dirt tracks, with a paler hump down the middle, and the village greens. */
  private paintTracks(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.save();
    ctx.scale(1 / SCALE, 1 / SCALE);
    ctx.translate(-cx * CHUNK + PAD * SCALE, -cy * CHUNK + PAD * SCALE);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    for (const v of this.island.villages) {
      if (v.x + 140 < x0 || v.x - 140 > x0 + CHUNK || v.y + 140 < y0 || v.y - 140 > y0 + CHUNK) continue;
      ctx.fillStyle = 'rgba(160,132,88,0.55)';
      ctx.beginPath();
      ctx.arc(v.x, v.y, 90, 0, Math.PI * 2);
      ctx.fill();
    }
    const near = (k: number) => {
      const b = this.trackBoxes[k];
      return !(b.x1 < x0 || b.x0 > x0 + CHUNK || b.y1 < y0 || b.y0 > y0 + CHUNK);
    };
    const path = (track: Vec2[]) => {
      ctx.beginPath();
      track.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    };
    const { tracks, roadKinds, towns, trails, harbours } = this.island;
    // Footpaths: a worn line, paler down the middle.
    for (const [width, colour] of [[11, 'rgba(120,98,66,0.45)'], [5, 'rgba(178,158,120,0.55)']] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      trails.forEach((trail, k) => {
        const b = this.trailBoxes[k];
        if (b.x1 < x0 || b.x0 > x0 + CHUNK || b.y1 < y0 || b.y0 > y0 + CHUNK) return;
        path(trail);
        ctx.stroke();
      });
    }
    // The harbours' yards, paved in concrete slabs, with a stone edge to the quay and bollards along it.
    for (const h of harbours) {
      const reach = Math.hypot(YARD.half, YARD.depth) + 20;
      if (h.x + reach < x0 || h.x - reach > x0 + CHUNK || h.y + reach < y0 || h.y - reach > y0 + CHUNK) continue;
      const quad = (u0: number, v0: number, u1: number, v1: number, colour: string) => {
        ctx.fillStyle = colour;
        ctx.beginPath();
        [harbourPoint(h, u0, v0), harbourPoint(h, u1, v0), harbourPoint(h, u1, v1), harbourPoint(h, u0, v1)].forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
        ctx.fill();
      };
      quad(-YARD.half - 10, -6, YARD.half + 10, YARD.depth + 20, '#b3ada0');
      ctx.strokeStyle = 'rgba(110,104,94,0.4)';
      ctx.lineWidth = 1;
      const line = (a: Vec2, b: Vec2) => {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      };
      for (let u = -YARD.half; u <= YARD.half; u += 30) line(harbourPoint(h, u, 10), harbourPoint(h, u, YARD.depth + 20));
      for (let v = 40; v <= YARD.depth + 20; v += 30) line(harbourPoint(h, -YARD.half - 10, v), harbourPoint(h, YARD.half + 10, v));
      quad(-YARD.half - 10, -6, YARD.half + 10, 10, '#8d8a83');
      // Yellow lines marking the way down the middle.
      ctx.strokeStyle = 'rgba(224,179,58,0.8)';
      ctx.lineWidth = 2;
      for (const u of [-45, 45]) line(harbourPoint(h, u, 14), harbourPoint(h, u, YARD.depth));
      for (let u = -YARD.half + 10; u <= YARD.half; u += 46) {
        const p = harbourPoint(h, u, 3);
        ctx.fillStyle = '#2b2d31';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const stroke = (kinds: RoadKind[], width: (kind: RoadKind) => number, colour: string, dash: number[] = []) => {
      ctx.strokeStyle = colour;
      ctx.setLineDash(dash);
      tracks.forEach((track, k) => {
        if (!kinds.includes(roadKinds[k]) || !near(k)) return;
        ctx.lineWidth = width(roadKinds[k]);
        path(track);
        ctx.stroke();
      });
      ctx.setLineDash([]);
    };
    // Where roads meet, the one surface right across (no ruts or lines painted over the junction).
    const junctions = (kinds: RoadKind[], colour: string) => {
      ctx.fillStyle = colour;
      for (const j of this.island.junctions) {
        if (!kinds.includes(j.kind) || j.x < x0 - 60 || j.x > x0 + CHUNK + 60 || j.y < y0 - 60 || j.y > y0 + CHUNK + 60) continue;
        ctx.beginPath();
        ctx.arc(j.x, j.y, ROAD_WIDTHS[j.kind] / 2 - 1, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    // The verges first, all of them, so where a track meets a road the road's verge doesn't cross it.
    stroke(['track'], () => ROAD_WIDTH + 8, 'rgba(92,72,44,0.35)');
    stroke(['road'], (k) => ROAD_WIDTHS[k] + 8, 'rgba(70,74,60,0.45)');
    // Dirt tracks: the track, the ruts, and a paler hump down the middle.
    stroke(['track'], () => ROAD_WIDTH, '#a2825a');
    stroke(['track'], () => ROAD_WIDTH * 0.62, '#94754e');
    stroke(['track'], () => ROAD_WIDTH * 0.22, '#a98a62');
    junctions(['track'], '#a2825a');
    // The city's parks: lawns, with gravel paths across and round.
    for (const t of towns) {
      for (const park of t.parks ?? []) {
        const inset = ROAD_WIDTHS.street / 2 + 8;
        const corner = (u: number, v: number) => townPoint(t, park.i * BLOCK.w + u, park.j * BLOCK.h + v);
        const quad = [corner(inset, inset), corner(BLOCK.w - inset, inset), corner(BLOCK.w - inset, BLOCK.h - inset), corner(inset, BLOCK.h - inset)];
        if (quad.every((c) => c.x < x0 - 10) || quad.every((c) => c.x > x0 + CHUNK + 10) || quad.every((c) => c.y < y0 - 10) || quad.every((c) => c.y > y0 + CHUNK + 10)) continue;
        ctx.fillStyle = '#6fae4a';
        ctx.beginPath();
        quad.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
        ctx.fill();
        ctx.strokeStyle = '#d8c9a3';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(quad[0].x, quad[0].y);
        ctx.lineTo(quad[2].x, quad[2].y);
        ctx.moveTo(quad[1].x, quad[1].y);
        ctx.lineTo(quad[3].x, quad[3].y);
        ctx.stroke();
        const mid = corner(BLOCK.w / 2, BLOCK.h / 2);
        ctx.beginPath();
        ctx.arc(mid.x, mid.y, 42, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // The towns' squares, paved in slabs.
    for (const t of towns) {
      const corners = [townPoint(t, 0, 0), townPoint(t, BLOCK.w, 0), townPoint(t, BLOCK.w, BLOCK.h), townPoint(t, 0, BLOCK.h)];
      if (corners.every((c) => c.x < x0 - 10) || corners.every((c) => c.x > x0 + CHUNK + 10) || corners.every((c) => c.y < y0 - 10) || corners.every((c) => c.y > y0 + CHUNK + 10)) continue;
      ctx.fillStyle = '#c4bba8';
      ctx.beginPath();
      corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,110,95,0.45)';
      ctx.lineWidth = 1;
      for (let u = 12; u < BLOCK.w; u += 16) {
        const a = townPoint(t, u, 0);
        const b = townPoint(t, u, BLOCK.h);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (let v = 12; v < BLOCK.h; v += 16) {
        const a = townPoint(t, 0, v);
        const b = townPoint(t, BLOCK.w, v);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    // Paved roads and streets: verges and pavements, then the tarmac, then the lines down the middle.
    ctx.lineCap = 'butt';
    stroke(['street', 'avenue'], (k) => ROAD_WIDTHS[k] + 20, '#b5b0a5');
    stroke(['street', 'avenue'], (k) => ROAD_WIDTHS[k] + 4, '#8d8a83');
    stroke(['road', 'street', 'avenue'], (k) => ROAD_WIDTHS[k], '#55585d');
    stroke(['road'], () => 2, 'rgba(240,232,200,0.85)', [16, 14]);
    stroke(['street'], () => 1.6, 'rgba(240,240,240,0.7)', [10, 10]);
    // The avenues: two lanes each way, the lanes marked with dashes, and a double yellow line down the middle.
    stroke(['avenue'], () => 40, 'rgba(240,240,240,0.75)', [14, 12]);
    stroke(['avenue'], () => 36, '#55585d');
    stroke(['avenue'], () => 7, '#e0b33a');
    stroke(['avenue'], () => 3, '#55585d');
    junctions(['road', 'street', 'avenue'], '#55585d');
    // The railway over everything (level crossings over the roads): ballast, sleepers, the two rails; and the platforms.
    const pieces = this.rails.filter(({ box: b }) => !(b.x1 < x0 || b.x0 > x0 + CHUNK || b.y1 < y0 || b.y0 > y0 + CHUNK));
    const line = (points: Vec2[], width: number, colour: string, dash: number[] = []) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      path(points);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    ctx.lineCap = 'round';
    for (const p of pieces) line(p.line, 32, 'rgba(70,64,56,0.35)');
    for (const p of pieces) line(p.line, 26, '#8a8174');
    ctx.lineCap = 'butt';
    for (const p of pieces) line(p.line, 20, '#5e4630', [4, 7]);
    for (const p of pieces) {
      line(p.left, 2.4, '#c9ccd0');
      line(p.right, 2.4, '#c9ccd0');
    }
    for (const p of this.platforms) {
      const b = p.line[11];
      if (b.x < x0 - 200 || b.x > x0 + CHUNK + 200 || b.y < y0 - 200 || b.y > y0 + CHUNK + 200) continue;
      line(p.line, 18, '#b5b0a5');
      line(p.edge, 2, '#e0b33a');
    }
    ctx.restore();
  }

  private drawMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, m: Mark): void {
    ctx.save();
    ctx.scale(1 / SCALE, 1 / SCALE);
    ctx.translate(-cx * CHUNK + PAD * SCALE, -cy * CHUNK + PAD * SCALE);
    if (m.t === 'scorch') {
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
      g.addColorStop(0, 'rgba(18,14,10,0.85)');
      g.addColorStop(0.45, 'rgba(30,24,18,0.6)');
      g.addColorStop(1, 'rgba(30,24,18,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
      // The crater: a pit with a rim of thrown-up earth.
      ctx.strokeStyle = 'rgba(70,52,34,0.6)';
      ctx.lineWidth = m.r * 0.12;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 0.32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(10,8,6,0.5)';
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 0.25, 0, Math.PI * 2);
      ctx.fill();
    } else if (m.t === 'tread') {
      ctx.translate(m.x, m.y);
      ctx.rotate(m.a);
      ctx.fillStyle = 'rgba(40,30,20,0.16)';
      ctx.fillRect(-3, -21, 6, 9);
      ctx.fillRect(-3, 12, 6, 9);
    } else {
      const texture = this.scene.textures.get(TANK_TEXTURE);
      const f = texture.get(m.frame);
      ctx.translate(m.x, m.y);
      ctx.rotate(m.a);
      ctx.globalAlpha = m.alpha;
      ctx.drawImage(texture.getSourceImage() as CanvasImageSource, f.cutX, f.cutY, f.width, f.height, (-f.width * m.s) / 2, (-f.height * m.s) / 2, f.width * m.s, f.height * m.s);
    }
    ctx.restore();
  }

  /** The whole island, small: for the map in the corner. */
  static miniMap(island: Island, size: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const out: RGB = [0, 0, 0];
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = ((i + 0.5) / size) * SIZE;
        const y = ((j + 0.5) / size) * SIZE;
        const c = Math.min(COLS - 1, Math.floor(y / CELL)) * COLS + Math.min(COLS - 1, Math.floor(x / CELL));
        groundColour(island.heights[c], island.moisture[c], 0, 0, x, y, island.seed, out);
        const p = (j * size + i) * 4;
        data4(img.data, p, out);
      }
    }
    ctx.putImageData(img, 0, 0);
    // The railway, a dark line round.
    if (island.railway) {
      ctx.strokeStyle = 'rgba(40,36,34,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      island.railway.line.forEach((p, i) => (i === 0 ? ctx.moveTo((p.x / SIZE) * size, (p.y / SIZE) * size) : ctx.lineTo((p.x / SIZE) * size, (p.y / SIZE) * size)));
      ctx.closePath();
      ctx.stroke();
    }
    // The paved roads (and town streets) bolder than the dirt tracks; the island's big, so they're thin.
    island.tracks.forEach((track, k) => {
      const paved = island.roadKinds[k] !== 'track';
      ctx.strokeStyle = paved ? 'rgba(70,72,78,0.9)' : 'rgba(162,130,90,0.7)';
      ctx.lineWidth = paved ? 1.2 : 0.7;
      ctx.beginPath();
      track.forEach((p, i) => (i === 0 ? ctx.moveTo((p.x / SIZE) * size, (p.y / SIZE) * size) : ctx.lineTo((p.x / SIZE) * size, (p.y / SIZE) * size)));
      ctx.stroke();
    });
    return canvas;
  }
}

function data4(data: Uint8ClampedArray, p: number, c: RGB): void {
  data[p] = c[0];
  data[p + 1] = c[1];
  data[p + 2] = c[2];
  data[p + 3] = 255;
}

/** The colour of the ground at a point: from its height and wetness, lit by its slope, with a little grain. */
function groundColour(h: number, m: number, gx: number, gy: number, x: number, y: number, seed: number, out: RGB): void {
  const grain = (hash(Math.floor(x / 2), Math.floor(y / 2), seed) - 0.5) * 12;
  const patch = (noise(x / 40, y / 40, seed + 5) - 0.5) * 22;
  if (h < 0) {
    // Water: turquoise in the shallows to deep blue, with surf right at the shore.
    mix(COLOURS.shallow, COLOURS.deep, smooth(0, 0.12, -h), out);
    if (h > -0.012) mix(out, COLOURS.foam, (1 - -h / 0.012) * 0.55, out);
    add(out, grain * 0.4 + patch * 0.15, out);
    return;
  }
  if (h < 0.04) {
    mix(COLOURS.wetSand, COLOURS.sand, smooth(0, 0.01, h), out);
  } else {
    mix(COLOURS.meadow, COLOURS.grass, smooth(0.3, 0.45, m), out);
    mix(out, COLOURS.forest, smooth(0.46, 0.54, m) * (1 - smooth(0.43, 0.51, h)), out);
    mix(COLOURS.sand, out, smooth(0.035, 0.055, h), out);
    mix(out, COLOURS.hills, smooth(0.41, 0.49, h), out);
    mix(out, COLOURS.rock, smooth(0.56, 0.63, h), out);
    mix(out, COLOURS.snow, smooth(0.74, 0.78, h), out);
  }
  // Lit from the top left: slopes facing it brighter, those turned away darker.
  const light = Math.max(-0.35, Math.min(0.35, (-gx * 0.62 - gy * 0.78) * 55));
  for (let k = 0; k < 3; k++) out[k] = out[k] * (1 + light) + grain + patch;
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mix(a: RGB, b: RGB, t: number, out: RGB): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

function add(a: RGB, v: number, out: RGB): void {
  out[0] = a[0] + v;
  out[1] = a[1] + v;
  out[2] = a[2] + v;
}
