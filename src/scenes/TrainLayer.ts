import type * as Phaser from 'phaser';
import type { Perspective } from '../world/perspective';
import { type Carriage, type Trains, UNITS, type UnitKind } from '../world/trains';
import { ART_SCALE, canvasTexture } from './art';

type Ctx = CanvasRenderingContext2D;
const M = 8;

/**
 * Each company's livery, from above: its sides, its roof, the band of its
 * windows along the sides, its cab ends (Network Rail yellow, by law), and
 * what's on its roof.
 */
const LIVERY: Record<UnitKind, { side: string; roof: string; band: string; kit: string }> = {
  // GWR: dark green all over, a grey roof.
  iet: { side: '#0b4a3e', roof: '#596164', band: '#0d1a1c', kit: '#3f4649' },
  sprinter: { side: '#0b4a3e', roof: '#6b7174', band: '#0d1a1c', kit: '#2e3436' },
  turbo: { side: '#0b4a3e', roof: '#7a8083', band: '#0d1a1c', kit: '#2e3436' },
  // CrossCountry: silver, with the maroon swoosh at its ends; a silver-grey roof.
  voyager: { side: '#b7bbbf', roof: '#8c9195', band: '#1a1d22', kit: '#5b1530' },
};

/** A carriage from above, facing along x: its body, its roof and the kit on it, its windows' band; a cab end yellow, with its windscreen. */
function drawCarriage(ctx: Ctx, kind: UnitKind, cab: Carriage['cab'], dark: boolean): void {
  const u = UNITS[kind];
  const [L, W] = [u.length, u.width];
  const l = LIVERY[kind];
  const rr = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  };
  // A cab's nose, rounded off; the other end square, its gangway to the next carriage.
  const front = cab === 'front';
  const back = cab === 'back';
  rr(0, 0, L, W, 2.5, l.side);
  // Its windows, down each side.
  ctx.fillStyle = dark ? '#050505' : l.band;
  ctx.fillRect(front || back ? 0 : 2, 1.1, L - (front || back ? 0 : 4), 1.3);
  ctx.fillRect(front || back ? 0 : 2, W - 2.4, L - (front || back ? 0 : 4), 1.3);
  // The roof, and its kit: the air-conditioning, the engines' exhausts (a diesel's), a pantograph (a Class 800's, on one carriage).
  rr(3, 2.6, L - 6, W - 5.2, 2, l.roof);
  ctx.fillStyle = l.kit;
  for (let x = L * 0.2; x < L * 0.85; x += L * 0.3) ctx.fillRect(x, W / 2 - 2.2, 3.5 * M * 0.8, 4.4);
  if (kind !== 'iet') {
    ctx.fillStyle = '#121212';
    ctx.beginPath();
    ctx.arc(L * 0.5, W / 2, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  if (kind === 'voyager') {
    // Its maroon swoosh.
    ctx.fillStyle = '#6d1530';
    ctx.fillRect(front ? L - 3 * M : 0, 0, 3 * M, 1.1);
    ctx.fillRect(front ? L - 3 * M : 0, W - 1.1, 3 * M, 1.1);
  }
  // Its doors: two pairs a side (a light edge).
  ctx.fillStyle = kind === 'voyager' ? '#e9ecef' : '#e2c534';
  for (const x of [L / 3, (2 * L) / 3]) {
    ctx.fillRect(x - 0.8 * M, 0, 1.6 * M, 0.7);
    ctx.fillRect(x - 0.8 * M, W - 0.7, 1.6 * M, 0.7);
  }
  for (const [end, at] of [[front, L], [back, 0]] as const) {
    if (!end) continue;
    // The cab: its yellow nose and its windscreen.
    const dir = at ? -1 : 1;
    ctx.fillStyle = '#f2c40c';
    ctx.beginPath();
    ctx.moveTo(at, W * 0.18);
    ctx.quadraticCurveTo(at, 0.4, at + dir * 1.8 * M, 0.3);
    ctx.lineTo(at + dir * 1.8 * M, W - 0.3);
    ctx.quadraticCurveTo(at, W - 0.4, at, W * 0.82);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#10161a';
    ctx.fillRect(at + dir * 1.1 * M - (dir < 0 ? 0 : 0.7 * M), W * 0.2, 0.7 * M, W * 0.6);
  }
  if (!front) {
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(L - 0.5, W / 2 - 3, 0.5, 6);
  }
  if (!back) {
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, W / 2 - 3, 0.5, 6);
  }
}

/** A carriage's picture: by its kind and which it is (a cab at the front or back, or between). */
export function carriageTexture(scene: Phaser.Scene, kind: UnitKind, cab: Carriage['cab']): string {
  const key = `carriage-${kind}-${cab ?? 'mid'}`;
  const u = UNITS[kind];
  canvasTexture(scene, key, u.length, u.width, (ctx) => drawCarriage(ctx, kind, cab, false));
  return key;
}

/** A mark where a carriage's been hit: dented, scraped, the paint gone. */
function dentTexture(scene: Phaser.Scene): string {
  canvasTexture(scene, 'carriage-dent', 10, 6, (ctx) => {
    const g = ctx.createRadialGradient(5, 3, 0, 5, 3, 4.5);
    g.addColorStop(0, 'rgba(25,22,20,0.85)');
    g.addColorStop(0.6, 'rgba(70,64,58,0.5)');
    g.addColorStop(1, 'rgba(70,64,58,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 10, 6);
  });
  return 'carriage-dent';
}

/**
 * Draws the trains near the view: each carriage at its height (on a bridge's
 * deck, down in a tunnel: only while you're down there too), with the marks
 * where it's been hit.
 */
export class TrainLayer {
  private readonly sprites = new Map<Carriage, { body: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; marks: Phaser.GameObjects.Image[] }>();

  constructor(
    private readonly scene: Phaser.Scene,
    private trains: Trains,
    /** The height of what's underfoot at a point on a level, px. */
    private readonly base: (x: number, y: number, level: number) => number,
    /** How deep each level's drawn, and whether you're down in a tunnel (the tunnels' trains only seen then). */
    private readonly depthOf: (level: number) => number | null,
  ) {}

  /** The next region's trains: those carried over keep their pictures. */
  use(trains: Trains): void {
    this.trains = trains;
  }

  update(view: Phaser.Geom.Rectangle, perspective: Perspective): void {
    const pad = 30 * M;
    const seen = new Set<Carriage>();
    for (const c of this.trains.carriages()) {
      if (c.x < view.left - pad || c.x > view.right + pad || c.y < view.top - pad || c.y > view.bottom + pad) continue;
      const depth = this.depthOf(c.level);
      if (depth === null) continue;
      seen.add(c);
      let s = this.sprites.get(c);
      if (!s) {
        const key = carriageTexture(this.scene, c.train.kind, c.cab);
        s = {
          body: this.scene.add.image(0, 0, key).setScale(1 / ART_SCALE),
          shadow: this.scene.add.image(0, 0, key).setScale(1 / ART_SCALE).setTint(0x000000).setAlpha(0.35),
          marks: [],
        };
        this.sprites.set(c, s);
      }
      // Its roof, up off the rails (a carriage is nearly 4 m high).
      const lift = perspective.lift(this.base(c.x, c.y, c.level) + 3.8 * M);
      const ground = perspective.lift(this.base(c.x, c.y, c.level));
      const [x, y] = [perspective.x(c.x, lift), perspective.y(c.y, lift)];
      s.body.setPosition(x, y).setRotation(c.angle).setDepth(depth);
      s.shadow.setPosition(perspective.x(c.x, ground) + 4, perspective.y(c.y, ground) + 5).setRotation(c.angle).setDepth(depth - 0.02);
      // Its marks, where it's been hit.
      while (s.marks.length < Math.min(12, c.hits.length)) s.marks.push(this.scene.add.image(0, 0, dentTexture(this.scene)).setScale(1.4 / ART_SCALE));
      const [ux, uy] = [Math.cos(c.angle), Math.sin(c.angle)];
      s.marks.forEach((m, i) => {
        const [a, b] = c.hits[c.hits.length - 1 - i];
        m.setPosition(x + ux * a - uy * b, y + uy * a + ux * b).setRotation(c.angle).setDepth(depth + 0.001);
      });
      // Wrecked: its windows black, its paint scorched.
      if (c.damage >= 1 && !s.body.isTinted) s.body.setTint(0x6a625a);
    }
    for (const [c, s] of this.sprites) {
      if (seen.has(c)) continue;
      s.body.destroy();
      s.shadow.destroy();
      for (const m of s.marks) m.destroy();
      this.sprites.delete(c);
    }
  }
}
