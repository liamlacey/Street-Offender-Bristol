import * as Phaser from 'phaser';
import type { Location } from '../locations/locations';
import type { Mover, Prop } from '../track/decoration';
import type { Track, Vec2 } from '../track/Track';
import { type ChunkLayers, ChunkedGraphics } from '../scenes/ChunkLayers';
import { DECO_TEXTURE } from '../scenes/decorationArt';
import type { DecorationDepths } from '../scenes/Decorations';
import { CIRCUIT_VARIANTS, CROWD_HEIGHT, STAND_ROWS } from './art';
import { type CircuitPlan, gravelAcross } from './plan';
import { CARPARK, type CircuitStyle } from './style';

/** Light from the top left, as for the cars. */
const SHADOW_DIR = { x: 0.62, y: 0.78 };
/** How tall each kind of prop is, as how far its shadow falls (px). */
const SHADOW_LENGTH: Partial<Record<Prop['kind'], number>> = {
  grandstand: 9,
  pits: 7,
  truck: 4,
  marshal: 3,
  board: 2,
  tyres: 2,
  marquee: 6,
  gazebo: 5,
  stall: 4,
  screen: 6,
};
const FAN_SCALE = 1.3;
/** How often a big screen changes picture, ms. */
const SCREEN_PERIOD = 2600;
const HELI = { speed: 300, hover: 140, height: 70, retarget: 18 };
const BLIMP = { speed: 22, height: 150 };
/** Which way the wind blows the flags. */
const WIND = 0.5;
/** Spectators cheer when a car comes this close (px), and keep it up for a while after. */
const CHEER_RANGE = 450;
const CHEER_FADE = 2.5;
/** A grandstand's rows or a crowd behind a fence: spectators that cheer as cars go by. */
interface Crowd {
  x: number;
  y: number;
  rows: { image: Phaser.GameObjects.Image; frame: string }[];
  phase: number;
  excitement: number;
}

/** Something that flaps or waves all the time: flags and marshals. */
interface Waver {
  image: Phaser.GameObjects.Image;
  frame: string;
  period: number;
  phase: number;
}

/** Fans stood about (in a group, or queueing), who cheer when the cars come by. */
interface Fan {
  image: Phaser.GameObjects.Image;
  frame: string;
  heading: number;
  phase: number;
  excitement: number;
}

/** A fan walking back and forth along a path. */
interface Walker {
  image: Phaser.GameObjects.Image;
  frame: string;
  from: Vec2;
  to: Vec2;
  length: number;
  t: number;
  dir: 1 | -1;
  speed: number;
  pause: number;
}

/** Something flying over, and its shadow on the ground far below. */
interface Flier {
  body: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  x: number;
  y: number;
  heading: number;
}

/**
 * Draws a race circuit's things and brings them to life: grandstands and
 * crowds that cheer as cars pass, marshals waving flags, flags flapping, the
 * gravel traps, the gantry (or banner) over the start line, and race day all
 * around: fans walking about and cheering, queues at the stalls, big screens
 * changing picture, the TV helicopter following the race and a blimp
 * drifting over.
 */
export class CircuitScenery {
  private readonly crowds: Crowd[] = [];
  private readonly wavers: Waver[] = [];
  private readonly fans: Fan[] = [];
  private readonly walkers: Walker[] = [];
  private readonly screens: { image: Phaser.GameObjects.Image; phase: number }[] = [];
  private heli: (Flier & { rotor: Phaser.GameObjects.Image; target: number; retarget: number }) | null = null;
  private blimp: (Flier & { from: Vec2; to: Vec2; t: number; length: number }) | null = null;
  private readonly rng: Phaser.Math.RandomDataGenerator;
  private readonly style: CircuitStyle;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly track: Track,
    private readonly plan: CircuitPlan,
    location: Location,
    private readonly depths: DecorationDepths,
    private readonly chunks: ChunkLayers,
    movers: Mover[] = [],
  ) {
    this.style = location.circuit!;
    this.rng = new Phaser.Math.RandomDataGenerator([`${track.length}`, 'circuit']);
    if (this.style.gravel) this.drawGravel(this.style.gravel);
    if (this.style.start === 'arch') this.drawArch();
    else if (this.style.start === 'gantry') this.drawGantry();
    for (const m of movers) if (m.kind === 'fan') this.addWalker(m);
    if (this.style.sky) this.addFliers();
  }

  /** Call once a frame with where the cars are. */
  update(time: number, dt: number, cars: Vec2[]): void {
    this.updateFans(time, dt, cars);
    for (const w of this.walkers) this.updateWalker(w, time, dt);
    for (const sc of this.screens) setFrame(sc.image, `screen-${Math.floor(time / SCREEN_PERIOD + sc.phase) % CIRCUIT_VARIANTS.screen}`);
    this.updateHeli(dt, cars);
    this.updateBlimp(dt);
    for (const crowd of this.crowds) {
      const near = cars.some((c) => Math.abs(c.x - crowd.x) < CHEER_RANGE && Math.abs(c.y - crowd.y) < CHEER_RANGE);
      crowd.excitement = near ? 1 : Math.max(0, crowd.excitement - dt / CHEER_FADE);
      crowd.rows.forEach((row, r) => {
        // Cheering: jumping up and down. Otherwise the odd row stands up now and then.
        const up =
          crowd.excitement > 0
            ? Math.floor(time / 160 + r * 0.45 + crowd.phase) % 2 === 0
            : Math.sin(time / 900 + r * 1.7 + crowd.phase * 3) > 0.94;
        setFrame(row.image, `${row.frame}-${up ? 1 : 0}`);
      });
    }
    for (const w of this.wavers) {
      const frame = `${w.frame}-${Math.floor(time / w.period + w.phase) % 2}`;
      if (w.image.frame.name !== frame) w.image.setFrame(frame, false, false);
    }
  }

  /** A circuit prop: a grandstand, crowd, marshal, flag, tyre stack, board or the pits. */
  addProp(prop: Prop): void {
    const { kind, variant } = prop;
    const shadow = SHADOW_LENGTH[kind];
    const image = (frame: string, u = 0, v = 0, w?: number, h?: number) => {
      const at = this.local(prop, u, v);
      const img = this.scene.add.image(at.x, at.y, DECO_TEXTURE, frame).setRotation(prop.angle);
      if (w !== undefined && h !== undefined) img.setDisplaySize(w, h);
      return this.chunks.add(img, this.depths.props);
    };
    const castShadow = (img: Phaser.GameObjects.Image) => {
      if (!shadow) return;
      const s = this.scene.add
        .image(img.x + SHADOW_DIR.x * shadow, img.y + SHADOW_DIR.y * shadow, DECO_TEXTURE, img.frame.name)
        .setDisplaySize(img.displayWidth, img.displayHeight)
        .setRotation(img.rotation)
        .setOrigin(img.originX, img.originY)
        .setTint(0x000000)
        .setAlpha(0.28);
      this.chunks.add(s, this.depths.shadows);
    };
    const top = -prop.h / 2;

    switch (kind) {
        case 'grandstand': {
          const stand = image(`stand-${variant}`);
          castShadow(stand);
          const rows = [];
          for (let r = 0; r < STAND_ROWS.count; r++) {
            const frame = `crowd-${(variant + r) % 4}`;
            const v = top + STAND_ROWS.first + r * STAND_ROWS.depth + STAND_ROWS.depth / 2 - 1;
            rows.push({ image: image(`${frame}-0`, 0, v).setFlipX(r % 2 === 1), frame });
          }
          this.addCrowd(prop, rows);
          break;
        }
        case 'crowd': {
          // Two rows of standing spectators behind a fence: the back row first so the front one overlaps it.
          const back = `bank-${(variant + 1) % 4}`;
          const front = `bank-${variant}`;
          const rows = [
            { image: image(`${back}-0`, 0, top + 4 + CROWD_HEIGHT / 2 + 7), frame: back },
            { image: image(`${front}-0`, 0, top + 4 + CROWD_HEIGHT / 2), frame: front },
          ];
          image(this.style.cornerCrowds === 'tape' ? 'tape' : 'fence', 0, top + 2);
          this.addCrowd(prop, rows);
          break;
        }
        case 'marshal': {
          castShadow(image('marshal', 0, prop.h / 2 - 8, 22, 16));
          const person = image('marshal-0', 0, top + 7);
          this.wavers.push({ image: person, frame: 'marshal', period: 380, phase: this.rng.frac() * 2 });
          break;
        }
        case 'flag': {
          const flag = this.scene.add
            .image(prop.x, prop.y, DECO_TEXTURE, `flag-${variant}-0`)
            .setOrigin(4 / 34, 8 / 16)
            .setRotation(WIND + this.rng.realInRange(-0.25, 0.25));
          this.chunks.add(flag, this.depths.overhead);
          this.wavers.push({ image: flag, frame: `flag-${variant}`, period: 170, phase: this.rng.frac() * 2 });
          break;
        }
        case 'tyres':
          castShadow(image(`tyres-${variant}`).setRotation(this.rng.angle()));
          break;
        case 'pits':
          castShadow(image('pits', 0, 0, prop.w, prop.h));
          break;
        case 'carpark':
          this.addCarPark(prop);
          break;
        case 'stall': {
          // The stall at the back, and its queue reaching forward to the front.
          castShadow(image(`stall-${variant}`, 0, prop.h / 2 - 18));
          const queue = 1 + this.rng.between(1, 4);
          for (let k = 0; k < queue; k++) this.addFan(prop, this.rng.realInRange(-3, 3), prop.h / 2 - 44 - k * 11, Math.PI / 2);
          break;
        }
        case 'screen': {
          castShadow(image('screen'));
          const picture = image('screen-0', 0, -2);
          this.screens.push({ image: picture, phase: this.rng.between(0, CIRCUIT_VARIANTS.screen - 1) });
          break;
        }
        case 'fans': {
          // Two to four stood chatting, turned towards each other.
          const count = this.rng.between(2, 4);
          for (let k = 0; k < count; k++) {
            const a = (k / count) * Math.PI * 2 + this.rng.realInRange(-0.3, 0.3);
            this.addFan(prop, Math.cos(a) * 9, Math.sin(a) * 9, a + Math.PI);
          }
          break;
        }
      default:
        castShadow(image(`${kind}-${variant}`, 0, 0, prop.w, prop.h));
        break;
    }
  }

  /** Rows of parked cars either side of each aisle, nosed in, with gaps where people have left. */
  private addCarPark(prop: Prop): void {
    const rng = new Phaser.Math.RandomDataGenerator([`${prop.variant}`, 'carpark']);
    const cols = Math.round(prop.w / CARPARK.bay);
    const pairs = Math.round((prop.h - CARPARK.aisle) / (2 * CARPARK.row + CARPARK.aisle));
    const full = rng.realInRange(0.7, 0.95);
    for (let p = 0; p < pairs; p++) {
      for (const r of [0, 1]) {
        const v = -prop.h / 2 + CARPARK.aisle + p * (2 * CARPARK.row + CARPARK.aisle) + r * CARPARK.row + CARPARK.row / 2;
        for (let c = 0; c < cols; c++) {
          if (rng.frac() > full) continue;
          const u = (c - (cols - 1) / 2) * CARPARK.bay;
          const at = this.local(prop, u, v);
          // Nose in, away from the aisle each row is parked off.
          const rotation = prop.angle + (r === 0 ? Math.PI / 2 : -Math.PI / 2) + rng.realInRange(-0.07, 0.07);
          const frame = `parked-${rng.between(0, CIRCUIT_VARIANTS.parked - 1)}`;
          const s = this.scene.add
            .image(at.x + SHADOW_DIR.x * 2.5, at.y + SHADOW_DIR.y * 2.5, DECO_TEXTURE, frame)
            .setRotation(rotation)
            .setTint(0x000000)
            .setAlpha(0.28);
          this.chunks.add(s, this.depths.shadows);
          this.chunks.add(this.scene.add.image(at.x, at.y, DECO_TEXTURE, frame).setRotation(rotation), this.depths.props);
        }
      }
    }
  }

  /** A fan standing at a spot on a prop, facing `facing` (relative to the prop). */
  private addFan(prop: Prop, u: number, v: number, facing: number): void {
    const at = this.local(prop, u, v);
    const frame = `fan-${this.rng.between(0, CIRCUIT_VARIANTS.fan - 1)}`;
    const heading = prop.angle + facing;
    const image = this.scene.add.image(at.x, at.y, DECO_TEXTURE, `${frame}-s`).setScale(FAN_SCALE).setRotation(heading);
    this.chunks.add(image, this.depths.props + 0.02);
    this.fans.push({ image, frame, heading, phase: this.rng.frac() * 10, excitement: 0 });
  }

  private updateFans(time: number, dt: number, cars: Vec2[]): void {
    for (const f of this.fans) {
      const { image } = f;
      const near = cars.some((c) => Math.abs(c.x - image.x) < CHEER_RANGE && Math.abs(c.y - image.y) < CHEER_RANGE);
      f.excitement = near ? 1 : Math.max(0, f.excitement - dt / CHEER_FADE);
      if (f.excitement > 0) {
        // Arms up and turned to watch.
        setFrame(image, Math.floor(time / 200 + f.phase) % 2 === 0 ? `${f.frame}-c` : `${f.frame}-s`);
      } else {
        setFrame(image, `${f.frame}-s`);
        image.setRotation(f.heading + Math.sin(time / 1700 + f.phase) * 0.35);
      }
    }
  }

  private addWalker(m: Mover): void {
    const frame = `fan-${this.rng.between(0, CIRCUIT_VARIANTS.fan - 1)}`;
    const image = this.scene.add.image(m.from.x, m.from.y, DECO_TEXTURE, `${frame}-s`).setScale(FAN_SCALE).setDepth(this.depths.props + 0.03);
    const length = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
    this.walkers.push({
      image,
      frame,
      from: m.from,
      to: m.to,
      length,
      t: this.rng.frac(),
      dir: this.rng.frac() < 0.5 ? 1 : -1,
      speed: this.rng.realInRange(24, 40),
      pause: 0,
    });
  }

  private updateWalker(w: Walker, time: number, dt: number): void {
    if (w.pause > 0) {
      w.pause -= dt;
      setFrame(w.image, `${w.frame}-s`);
      return;
    }
    w.t += (w.dir * w.speed * dt) / w.length;
    if (w.t >= 1 || w.t <= 0) {
      w.t = Phaser.Math.Clamp(w.t, 0, 1);
      w.dir = w.dir === 1 ? -1 : 1;
      w.pause = this.rng.realInRange(1, 6);
    }
    const heading = Math.atan2(w.to.y - w.from.y, w.to.x - w.from.x) + (w.dir === 1 ? 0 : Math.PI);
    w.image.setPosition(w.from.x + (w.to.x - w.from.x) * w.t, w.from.y + (w.to.y - w.from.y) * w.t).setRotation(heading);
    setFrame(w.image, `${w.frame}-${Math.floor(time / 240 + w.speed) % 2}`);
  }

  // --- In the sky ---------------------------------------------------------

  private addFliers(): void {
    const { points } = this.track;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const box = { minX: Math.min(...xs) - 500, maxX: Math.max(...xs) + 500, minY: Math.min(...ys) - 500, maxY: Math.max(...ys) + 500 };
    const flier = (frame: string, x: number, y: number, height: number, alpha: number): Flier => ({
      body: this.scene.add.image(x, y, DECO_TEXTURE, frame).setDepth(this.depths.sky),
      shadow: this.scene.add
        .image(x + SHADOW_DIR.x * height, y + SHADOW_DIR.y * height, DECO_TEXTURE, frame)
        .setTint(0x000000)
        .setAlpha(alpha)
        .setDepth(this.depths.shadows + 0.1),
      x,
      y,
      heading: 0,
    });
    const start = points[0];
    const heli = flier('heli', start.x, start.y - HELI.hover, HELI.height, 0.22);
    const rotor = this.scene.add.image(heli.x, heli.y, DECO_TEXTURE, 'rotor').setDepth(this.depths.sky + 0.01);
    this.heli = { ...heli, rotor, target: 1, retarget: HELI.retarget };
    // The blimp crosses the circuit corner to corner, back and forth.
    const from = { x: box.minX, y: box.minY + this.rng.frac() * (box.maxY - box.minY) };
    const to = { x: box.maxX, y: box.minY + this.rng.frac() * (box.maxY - box.minY) };
    const blimp = flier('blimp', from.x, from.y, BLIMP.height, 0.16);
    blimp.shadow.setScale(1.1);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    this.blimp = { ...blimp, from, to, t: this.rng.frac(), length };
  }

  /** The TV helicopter hangs back above a car, keeping up with it, and moves on to another now and then. */
  private updateHeli(dt: number, cars: Vec2[]): void {
    const h = this.heli;
    if (!h || cars.length === 0) return;
    h.retarget -= dt;
    if (h.retarget <= 0) {
      h.retarget = HELI.retarget;
      h.target = this.rng.between(0, cars.length - 1);
    }
    const car = cars[Math.min(h.target, cars.length - 1)];
    const goal = { x: car.x - HELI.hover * 0.6, y: car.y - HELI.hover };
    const dx = goal.x - h.x;
    const dy = goal.y - h.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 4) {
      const step = Math.min(dist, Math.max(40, Math.min(HELI.speed, dist * 1.5)) * dt);
      h.x += (dx / dist) * step;
      h.y += (dy / dist) * step;
      const want = Math.atan2(dy, dx);
      h.heading = Phaser.Math.Angle.RotateTo(h.heading, want, dt * 2);
    }
    // Nose down into the camera's way, rotor spinning.
    h.body.setPosition(h.x, h.y).setRotation(h.heading);
    h.rotor.setPosition(h.x + Math.cos(h.heading) * 8, h.y + Math.sin(h.heading) * 8).setRotation(h.rotor.rotation + dt * 28);
    h.shadow.setPosition(h.x + SHADOW_DIR.x * HELI.height, h.y + SHADOW_DIR.y * HELI.height).setRotation(h.heading);
  }

  private updateBlimp(dt: number): void {
    const b = this.blimp;
    if (!b) return;
    b.t += (BLIMP.speed * dt) / b.length;
    if (b.t > 1) {
      // Round again from the other side.
      [b.from, b.to] = [b.to, b.from];
      b.t = 0;
    }
    b.x = b.from.x + (b.to.x - b.from.x) * b.t;
    b.y = b.from.y + (b.to.y - b.from.y) * b.t;
    const heading = Math.atan2(b.to.y - b.from.y, b.to.x - b.from.x);
    b.body.setPosition(b.x, b.y).setRotation(heading);
    b.shadow.setPosition(b.x + SHADOW_DIR.x * BLIMP.height, b.y + SHADOW_DIR.y * BLIMP.height).setRotation(heading);
  }

  private addCrowd(prop: Prop, rows: Crowd['rows']): void {
    this.crowds.push({ x: prop.x, y: prop.y, rows, phase: this.rng.frac() * 2, excitement: 0 });
  }


  /** A point on a prop, `u` px along it and `v` px back from its centre. */
  private local(prop: Prop, u: number, v: number): Vec2 {
    const c = Math.cos(prop.angle);
    const s = Math.sin(prop.angle);
    return { x: prop.x + c * u - s * v, y: prop.y + s * u + c * v };
  }

  /** Gravel traps: sandy fill with grit scattered over it. */
  private drawGravel(colors: { base: number; light: number; dark: number }): void {
    const { points, normals } = this.track;
    const n = points.length;
    const g = new ChunkedGraphics(this.scene, this.chunks, this.depths.ground);
    const grit: [Vec2, Vec2, Vec2, Vec2][] = [];
    for (const [side, band] of [
      [1, this.plan.gravel.right],
      [-1, this.plan.gravel.left],
    ] as const) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (band.outer[i] === 0 && band.outer[j] === 0) continue;
        const [innerI, outerI] = gravelAcross(band, i, j, 0);
        const [innerJ, outerJ] = gravelAcross(band, i, j, 1);
        const at = (k: number, d: number) => ({
          x: points[k].x + normals[k].x * d * side,
          y: points[k].y + normals[k].y * d * side,
        });
        const quad: [Vec2, Vec2, Vec2, Vec2] = [at(i, innerI), at(j, innerJ), at(j, outerJ), at(i, outerI)];
        g.fillStyle(colors.base);
        g.fillTriangle(quad[0].x, quad[0].y, quad[1].x, quad[1].y, quad[2].x, quad[2].y);
        g.fillTriangle(quad[0].x, quad[0].y, quad[2].x, quad[2].y, quad[3].x, quad[3].y);
        grit.push(quad);
      }
    }
    // Grit on top, once all the fill is down.
    for (const [a, b, c, d] of grit) {
      const area = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(d.x - a.x, d.y - a.y);
      for (let k = Math.round(area / 450); k > 0; k--) {
        const u = this.rng.frac();
        const v = this.rng.frac();
        const x = (a.x * (1 - u) + b.x * u) * (1 - v) + (d.x * (1 - u) + c.x * u) * v;
        const y = (a.y * (1 - u) + b.y * u) * (1 - v) + (d.y * (1 - u) + c.y * u) * v;
        g.fillStyle(k % 2 === 0 ? colors.light : colors.dark);
        g.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }
  }


  /** Fills a rectangle `w` across the track and `h` along it, centred on (cx, cy). */
  private box(g: Phaser.GameObjects.Graphics, heading: number, cx: number, cy: number, w: number, h: number): void {
    const across = { x: -Math.sin(heading), y: Math.cos(heading) };
    const along = { x: Math.cos(heading), y: Math.sin(heading) };
    const [p, q, r, t] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, b]) => ({
      x: cx + (across.x * a * w + along.x * b * h) / 2,
      y: cy + (across.y * a * w + along.y * b * h) / 2,
    }));
    g.fillTriangle(p.x, p.y, q.x, q.y, r.x, r.y);
    g.fillTriangle(p.x, p.y, r.x, r.y, t.x, t.y);
  }


  /** The gantry over the start/finish line: posts either side, a beam with start lights, and its shadow on the road. */
  private drawGantry(): void {
    const { x, y, heading, span, posts } = this.plan.gantry;
    const across = { x: -Math.sin(heading), y: Math.cos(heading) };
    const along = { x: Math.cos(heading), y: Math.sin(heading) };
    const box = (g: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number) => this.box(g, heading, cx, cy, w, h);
    const beam = 16;
    const shadow = this.scene.add.graphics().setDepth(this.depths.roadShadow);
    shadow.fillStyle(0x000000, 0.22);
    box(shadow, x + SHADOW_DIR.x * 16, y + SHADOW_DIR.y * 16, span + 14, beam);

    const g = this.scene.add.graphics().setDepth(this.depths.overhead);
    g.fillStyle(0x2b2d42);
    box(g, x, y, span + 14, beam);
    // Chequered stripe along the beam.
    const squares = Math.floor(span / 8);
    for (let k = 0; k < squares; k++) {
      for (const row of [0, 1]) {
        g.fillStyle((k + row) % 2 === 0 ? 0xffffff : 0x111111);
        const a = (k + 0.5) * 8 - span / 2;
        const b = row === 0 ? -beam / 2 + 2 : beam / 2 - 2;
        box(g, x + across.x * a + along.x * b, y + across.y * a + along.y * b, 8, 4);
      }
    }
    // Start lights in the middle.
    g.fillStyle(0x111111);
    box(g, x, y, 70, 10);
    for (let k = -2; k <= 2; k++) {
      g.fillStyle(0x7a0d14);
      g.fillCircle(x + across.x * k * 13, y + across.y * k * 13, 4);
    }
    for (const p of posts) {
      g.fillStyle(0x5f646c);
      box(g, p.x, p.y, 16, 16);
      g.fillStyle(0x8a8f98);
      box(g, p.x, p.y, 10, 10);
    }
  }


  /** A rally stage's start: a banner strung between two log posts, over the line. */
  private drawArch(): void {
    const { x, y, heading, span, posts } = this.plan.gantry;
    const shadow = this.scene.add.graphics().setDepth(this.depths.roadShadow);
    shadow.fillStyle(0x000000, 0.2);
    this.box(shadow, heading, x + SHADOW_DIR.x * 14, y + SHADOW_DIR.y * 14, span, 12);
    // The banner runs across the road, turned whichever way keeps its words upright on screen.
    const angle = Phaser.Math.Angle.Wrap(heading + Math.PI / 2);
    this.scene.add
      .image(x, y, DECO_TEXTURE, 'banner')
      .setRotation(Math.abs(angle) > Math.PI / 2 ? angle + Math.PI : angle)
      .setDisplaySize(span, 16)
      .setDepth(this.depths.overhead);
    const g = this.scene.add.graphics().setDepth(this.depths.overhead);
    for (const p of posts) {
      g.fillStyle(0x4e341d);
      g.fillCircle(p.x, p.y, 9);
      g.fillStyle(0xc9a26a);
      g.fillCircle(p.x, p.y, 6);
      g.fillStyle(0xa57c45);
      g.fillCircle(p.x, p.y, 2.5);
    }
  }
}

function setFrame(image: Phaser.GameObjects.Image, frame: string): void {
  if (image.frame.name !== frame) image.setFrame(frame, false, false);
}
