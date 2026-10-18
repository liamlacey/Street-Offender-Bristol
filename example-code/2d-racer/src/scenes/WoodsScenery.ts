import * as Phaser from 'phaser';
import type { Decoration, Patch } from '../track/decoration';
import { type Track, type Vec2, poseAt } from '../track/Track';
import { BRIDGE_OVERHANG, WATER_STEP, type Water } from '../track/water';
import { type ChunkLayers, ChunkedGraphics } from './ChunkLayers';
import { DECO_TEXTURE } from './decorationArt';
import type { DecorationDepths } from './Decorations';
import { TEX } from './textures';
import { WOODS_VARIANTS } from './woodsArt';

const WATER_COLOURS = { bank: 0x4a3a24, deep: 0x2b5668, middle: 0x3b6f85, reeds: 0x2f5a2a };
const MUD_COLOURS = { rim: 0x5c4229, body: 0x47321f, sheen: 0x6e5236, rut: 0x35251a };
const PUDDLE_COLOURS = { rim: 0x5e4a33, water: 0x55727e, sky: 0x87a4ae };
/** Frozen: ice on the streams and rivers (snow on their banks), drifts for mud, and puddles iced over. */
const ICE = { bank: 0xdbe6ed, deep: 0x9fc8dd, middle: 0xc4e1ee, reeds: 0xf4f8fb };
const DRIFT = { rim: 0xc3d3de, body: 0xedf3f7, sheen: 0xffffff, rut: 0xb2c4d1 };
const ICE_PATCH = { rim: 0xb2d2e3, water: 0xcbe6f3, sky: 0xedf8fd };
/** In the desert: sand blown across the road, rippled by the wind. */
const SAND = { rim: 0xcfae7c, body: 0xe2c89c, sheen: 0xecd8b2, rut: 0xc49f6c };
/** Snowflakes falling per second, per million px² of view. */
const SNOW_RATE = 70;
/** How fast the water carries ripples along, px/s. */
const FLOW_SPEED = { stream: 60, river: 38 };
/** Light from the top left, as for the cars. */
const SHADOW_DIR = { x: 0.62, y: 0.78 };
/** Leaves falling per second, per million px² of view. */
const LEAF_RATE = 5;
/** Seconds between flocks of birds flying over. */
const BIRD_GAP: [number, number] = [9, 20];
const BIRD_SPEED = 150;

/** A water course, ready for animating ripples along it. */
interface Course {
  water: Water;
  length: number;
  /** Distance along the path where it crosses the road. */
  crossing: number;
  /** Half the bridge deck's width across the water (0 for a ford): ripples hide under it. */
  deck: number;
}

interface Ripple {
  course: Course;
  s: number;
  lateral: number;
  speed: number;
  image: Phaser.GameObjects.Image;
}

interface Bird {
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  phase: number;
}

/**
 * The living parts of the woods: streams and rivers (with fords and bridges
 * where they cross the road) and ripples flowing along them, mud and puddles
 * on the road with light glinting off the water, smoke from campfires,
 * leaves drifting down and birds flying over. Or, frozen in winter: ice on
 * the water, drifts and ice on the road, and snow falling. Or in the desert,
 * sand blown across the road.
 */
export class WoodsScenery {
  private readonly ripples: Ripple[] = [];
  private readonly glints: { image: Phaser.GameObjects.Image; phase: number }[] = [];
  private readonly smokeSources: Vec2[] = [];
  private readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly leaves: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private readonly birds: Bird[] = [];
  private readonly rng: Phaser.Math.RandomDataGenerator;
  private leafDue = 0;
  private smokeDue = 0;
  private nextFlock: number;
  private flock: { dir: number; travelled: number; limit: number } | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly track: Track,
    deco: Decoration,
    private readonly wildlife: boolean,
    private readonly depths: DecorationDepths,
    private readonly chunks: ChunkLayers,
    /** Winter: the water frozen, mud piled into drifts, puddles iced over, and snow falling instead of leaves. */
    private readonly frozen = false,
    /** The desert: the mud is soft sand, rippled by the wind. */
    private readonly arid = false,
  ) {
    this.rng = new Phaser.Math.RandomDataGenerator([`${track.length}`, 'woods']);
    this.nextFlock = this.rng.realInRange(4, 10);
    this.drawWater(deco.water);
    this.drawPatches(deco.patches);
    this.smoke = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: 2600,
        speedX: { min: 8, max: 22 },
        speedY: { min: -12, max: 4 },
        scale: { start: 0.35, end: 1.6 },
        alpha: { start: 0.35, end: 0 },
        tint: 0xc8c8c8,
        emitting: false,
      })
      .setDepth(depths.overhead);
    if (wildlife && frozen) {
      this.leaves = scene.add
        .particles(0, 0, DECO_TEXTURE, {
          frame: ['flake-0', 'flake-0', 'flake-1', 'flake-2'],
          lifespan: 7000,
          speedX: { min: 15, max: 45 },
          speedY: { min: 25, max: 55 },
          // Shrinking as they fall towards the ground, and melting into it.
          scale: { start: 1.4, end: 0.7 },
          alpha: { start: 1, end: 0 },
          emitting: false,
        })
        .setDepth(depths.sky);
    } else if (wildlife) {
      this.leaves = scene.add
        .particles(0, 0, DECO_TEXTURE, {
          frame: Array.from({ length: WOODS_VARIANTS.leaf }, (_, v) => `leaf-${v}`),
          lifespan: 8000,
          speedX: { min: 12, max: 40 },
          speedY: { min: 4, max: 26 },
          rotate: { start: 0, end: 420 },
          // Shrinking as they fall towards the ground.
          scale: { start: 1.5, end: 0.8 },
          alpha: { start: 1, end: 0 },
          emitting: false,
        })
        .setDepth(depths.sky);
    }
  }

  addSmoke(x: number, y: number): void {
    this.smokeSources.push({ x, y });
  }

  update(time: number, dt: number, camera: Phaser.Cameras.Scene2D.Camera): void {
    const view = camera.worldView;
    const near = (x: number, y: number, margin: number) =>
      x > view.left - margin && x < view.right + margin && y > view.top - margin && y < view.bottom + margin;

    for (const r of this.ripples) {
      const { course } = r;
      r.s = (((r.s + course.water.flow * r.speed * dt) % course.length) + course.length) % course.length;
      const under = course.deck > 0 && Math.abs(r.s - course.crossing) < course.deck;
      const p = this.along(course, r.s, r.lateral);
      const show = !under && near(p.x, p.y, 40);
      if (r.image.visible !== show) r.image.setVisible(show);
      if (!show) continue;
      r.image.setPosition(p.x, p.y).setRotation(p.angle);
      // Fade in and out at the ends of the course.
      r.image.setAlpha(Math.min(0.7, r.s / 60, (course.length - r.s) / 60));
    }

    for (const g of this.glints) {
      if (!near(g.image.x, g.image.y, 20)) continue;
      g.image.setAlpha(0.25 + 0.55 * Math.max(0, Math.sin(time / 600 + g.phase)));
    }

    this.smokeDue -= dt;
    if (this.smokeDue <= 0) {
      this.smokeDue = 0.22;
      for (const s of this.smokeSources) if (near(s.x, s.y, 100)) this.smoke.emitParticleAt(s.x, s.y, 1);
    }

    if (!this.wildlife) return;
    this.leafDue -= dt * (this.frozen ? SNOW_RATE : LEAF_RATE) * ((view.width * view.height) / 1e6);
    while (this.leafDue <= 0) {
      this.leafDue += 1;
      this.leaves?.emitParticleAt(view.x + Math.random() * view.width, view.y + Math.random() * view.height, 1);
    }
    this.updateBirds(time, dt, camera);
  }

  /** Every so often a flock flies over, high up, its shadow crossing the ground below. */
  private updateBirds(time: number, dt: number, camera: Phaser.Cameras.Scene2D.Camera): void {
    if (!this.flock) {
      this.nextFlock -= dt;
      if (this.nextFlock > 0) return;
      const view = camera.worldView;
      const dir = this.rng.angle() * (Math.PI / 180);
      const reach = Math.hypot(view.width, view.height) / 2 + 80;
      const start = {
        x: view.centerX - Math.cos(dir) * reach + Math.sin(dir) * this.rng.realInRange(-150, 150),
        y: view.centerY - Math.sin(dir) * reach - Math.cos(dir) * this.rng.realInRange(-150, 150),
      };
      const count = this.rng.between(3, 7);
      for (let k = 0; k < count; k++) {
        // A loose V.
        const back = Math.ceil(k / 2) * 26;
        const side = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 22;
        const x = start.x - Math.cos(dir) * back - Math.sin(dir) * side + this.rng.realInRange(-6, 6);
        const y = start.y - Math.sin(dir) * back + Math.cos(dir) * side + this.rng.realInRange(-6, 6);
        const image = this.scene.add.image(x, y, DECO_TEXTURE, 'bird-0').setRotation(dir).setScale(1.3).setDepth(this.depths.sky);
        const shadow = this.scene.add
          .image(x + SHADOW_DIR.x * 120, y + SHADOW_DIR.y * 120, DECO_TEXTURE, 'bird-0')
          .setRotation(dir)
          .setTint(0x000000)
          .setAlpha(0.18)
          .setDepth(this.depths.shadows);
        this.birds.push({ image, shadow, phase: this.rng.frac() * 2 });
      }
      this.flock = { dir, travelled: 0, limit: reach * 2 + 300 };
      return;
    }
    const step = BIRD_SPEED * dt;
    const { dir } = this.flock;
    for (const b of this.birds) {
      b.image.x += Math.cos(dir) * step;
      b.image.y += Math.sin(dir) * step;
      b.shadow.setPosition(b.image.x + SHADOW_DIR.x * 120, b.image.y + SHADOW_DIR.y * 120);
      const frame = Math.floor(time / 140 + b.phase) % 2 === 0 ? 'bird-0' : 'bird-1';
      if (b.image.frame.name !== frame) {
        b.image.setFrame(frame, false, false);
        b.shadow.setFrame(frame, false, false);
      }
    }
    this.flock.travelled += step;
    if (this.flock.travelled > this.flock.limit) {
      for (const b of this.birds) {
        b.image.destroy();
        b.shadow.destroy();
      }
      this.birds.length = 0;
      this.flock = null;
      this.nextFlock = this.rng.realInRange(...BIRD_GAP);
    }
  }

  /** A point `s` px along a water course and `lateral` px to one side, with the direction of the water there. */
  private along(course: Course, s: number, lateral: number): { x: number; y: number; angle: number } {
    const { path } = course.water;
    const f = s / WATER_STEP;
    const i = Math.min(path.length - 2, Math.floor(f));
    const t = f - i;
    const a = path[i];
    const b = path[i + 1];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    return {
      x: a.x + (b.x - a.x) * t - Math.sin(angle) * lateral,
      y: a.y + (b.y - a.y) * t + Math.cos(angle) * lateral,
      angle: course.water.flow === 1 ? angle : angle + Math.PI,
    };
  }

  // --- Water ----------------------------------------------------------------

  private drawWater(waters: Water[]): void {
    if (waters.length === 0) return;
    const WATER = this.frozen ? ICE : WATER_COLOURS;
    const under = new ChunkedGraphics(this.scene, this.chunks, this.depths.ground);
    const over = new ChunkedGraphics(this.scene, this.chunks, this.depths.overRoad);
    for (const water of waters) {
      const { path, width, crossing } = water;
      const length = (path.length - 1) * WATER_STEP;
      const crossingS = crossing.pathIndex * WATER_STEP;
      const i = Math.round(crossing.along / this.track.spacing) % this.track.points.length;
      const halfOuter = this.track.halfWidths[i] + this.track.kerbWidth;

      // The whole course under the road, then a pond at each dead end.
      this.strip(under, path, width / 2 + 6, WATER.bank, 0, path.length - 1);
      this.strip(under, path, width / 2, WATER.deep, 0, path.length - 1);
      this.strip(under, path, width * 0.26, WATER.middle, 0, path.length - 1);
      for (const pond of water.ponds) this.pond(under, pond);

      const pose = poseAt(this.track, crossing.along);
      if (crossing.bridge) {
        this.bridge(under, over, pose, width, halfOuter);
      } else {
        // The ford: the water runs over the road, which is dark and wet either side.
        const from = Math.max(0, crossing.pathIndex - Math.ceil((halfOuter + 10) / WATER_STEP));
        const to = Math.min(path.length - 1, crossing.pathIndex + Math.ceil((halfOuter + 10) / WATER_STEP));
        over.fillStyle(0x000000, 0.18);
        this.boxAt(over, pose, 0, (halfOuter + 4) * 2, width + 40);
        this.strip(over, path, width / 2 + 3, WATER.bank, from, to);
        this.strip(over, path, width / 2, WATER.deep, from, to);
        this.strip(over, path, width * 0.26, WATER.middle, from, to);
        // Pebbles where the ford's edges meet the road.
        for (let k = 0; k < 14; k++) {
          const across = this.rng.realInRange(-halfOuter, halfOuter);
          const edge = (this.rng.frac() < 0.5 ? -1 : 1) * (width / 2 + this.rng.realInRange(-2, 5));
          over.fillStyle(this.rng.frac() < 0.5 ? 0x9a978f : 0x77746c);
          over.fillCircle(
            pose.x - Math.sin(pose.heading) * across + Math.cos(pose.heading) * edge,
            pose.y + Math.cos(pose.heading) * across + Math.sin(pose.heading) * edge,
            this.rng.realInRange(2, 4),
          );
        }
      }

      if (this.frozen) {
        this.cracks(over, path, width, crossing.pathIndex, Math.ceil((halfOuter + 10) / WATER_STEP));
        this.cracks(under, path, width, 0, path.length);
        continue;
      }
      const course: Course = { water, length, crossing: crossingS, deck: crossing.bridge ? halfOuter + 8 : 0 };
      const count = Math.round(length / (water.kind === 'river' ? 30 : 45));
      for (let k = 0; k < count; k++) {
        const image = this.scene.add
          .image(0, 0, DECO_TEXTURE, 'ripple')
          .setDepth(this.depths.ripples)
          .setScale(water.kind === 'river' ? 1.2 : 0.9)
          .setVisible(false);
        this.ripples.push({
          course,
          s: this.rng.frac() * length,
          lateral: this.rng.realInRange(-0.32, 0.32) * width,
          speed: FLOW_SPEED[water.kind] * this.rng.realInRange(0.8, 1.2),
          image,
        });
      }
    }
  }

  /** Cracks and skate scratches in the ice along a stretch of frozen water, around point `at` (within `reach` points of it). */
  private cracks(g: ChunkedGraphics, path: Vec2[], width: number, at: number, reach: number): void {
    const from = Math.max(1, at - reach);
    const to = Math.min(path.length - 2, at + reach);
    g.fillStyle(0xffffff, 0.55);
    for (let k = from; k < to; k += 3) {
      if (this.rng.frac() < 0.5) continue;
      const a = path[k];
      const b = path[k + 1];
      const angle = Math.atan2(b.y - a.y, b.x - a.x) + this.rng.realInRange(-1.2, 1.2);
      const lateral = this.rng.realInRange(-0.35, 0.35) * width;
      const x = a.x - Math.sin(angle) * lateral;
      const y = a.y + Math.cos(angle) * lateral;
      const len = this.rng.realInRange(8, 22);
      for (let d = 0; d < len; d += 2) g.fillRect(x + Math.cos(angle) * d - 0.6, y + Math.sin(angle) * d - 0.6, 1.2, 1.2);
    }
  }

  /** Fills a band `half` px either side of a path, from point `from` to `to`, with round ends. */
  private strip(g: ChunkedGraphics, path: Vec2[], half: number, color: number, from: number, to: number): void {
    g.fillStyle(color);
    const step = 2;
    const edge = (k: number, side: number) => {
      const a = path[Math.max(0, k - 1)];
      const b = path[Math.min(path.length - 1, k + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: path[k].x - ((b.y - a.y) / len) * half * side, y: path[k].y + ((b.x - a.x) / len) * half * side };
    };
    let prev = from;
    for (let k = Math.min(from + step, to); prev < to; k = Math.min(k + step, to)) {
      const a = edge(prev, 1);
      const b = edge(k, 1);
      const c = edge(k, -1);
      const d = edge(prev, -1);
      g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
      g.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
      prev = k;
    }
    if (from === 0) g.fillCircle(path[0].x, path[0].y, half);
    if (to === path.length - 1) g.fillCircle(path[to].x, path[to].y, half);
  }

  private pond(g: ChunkedGraphics, pond: { x: number; y: number; r: number }): void {
    const WATER = this.frozen ? ICE : WATER_COLOURS;
    g.fillStyle(WATER.bank);
    g.fillCircle(pond.x, pond.y, pond.r + 7);
    g.fillStyle(WATER.deep);
    g.fillCircle(pond.x, pond.y, pond.r);
    g.fillStyle(WATER.middle);
    g.fillCircle(pond.x - pond.r * 0.15, pond.y - pond.r * 0.15, pond.r * 0.6);
    // Reeds round the edge.
    g.fillStyle(WATER.reeds);
    for (let k = 0; k < 18; k++) {
      const a = this.rng.angle() * (Math.PI / 180);
      const r = pond.r + this.rng.realInRange(-6, 4);
      g.fillCircle(pond.x + Math.cos(a) * r, pond.y + Math.sin(a) * r, this.rng.realInRange(2, 4.5));
    }
  }

  /** A wooden bridge carrying the road over a river, with its shadow on the water. */
  private bridge(
    under: ChunkedGraphics,
    over: ChunkedGraphics,
    pose: { x: number; y: number; heading: number },
    width: number,
    halfOuter: number,
  ): void {
    const deck = width + BRIDGE_OVERHANG * 2;
    const span = (halfOuter + 8) * 2;
    under.fillStyle(0x000000, 0.3);
    this.boxAt(under, { ...pose, x: pose.x + SHADOW_DIR.x * 12, y: pose.y + SHADOW_DIR.y * 12 }, 0, span, deck);
    over.fillStyle(0x86663f);
    this.boxAt(over, pose, 0, span, deck);
    // Planks laid across the road.
    over.fillStyle(0x5e4528);
    for (let d = -deck / 2 + 5; d < deck / 2; d += 7) this.boxAt(over, pose, d, span - 12, 1.5);
    // Heavy beams down each side (the railings), with posts.
    for (const side of [1, -1]) {
      const at = { ...pose, x: pose.x - Math.sin(pose.heading) * side * (span / 2 - 3), y: pose.y + Math.cos(pose.heading) * side * (span / 2 - 3) };
      over.fillStyle(0x4e3820);
      this.boxAt(over, at, 0, 7, deck + 6);
      over.fillStyle(0x3b2a18);
      for (const d of [-deck / 2, 0, deck / 2]) this.boxAt(over, at, d, 9, 9);
    }
  }

  /** Fills a rectangle on the road: `across` wide, `alongLength` long, `shift` px along from `pose`. */
  private boxAt(g: ChunkedGraphics, pose: { x: number; y: number; heading: number }, shift: number, across: number, alongLength: number): void {
    const c = Math.cos(pose.heading);
    const s = Math.sin(pose.heading);
    const cx = pose.x + c * shift;
    const cy = pose.y + s * shift;
    const pts = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, b]) => ({ x: cx - s * a * (across / 2) + c * b * (alongLength / 2), y: cy + c * a * (across / 2) + s * b * (alongLength / 2) }));
    g.fillTriangle(pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y);
    g.fillTriangle(pts[0].x, pts[0].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y);
  }

  // --- Mud and puddles ------------------------------------------------------

  private drawPatches(patches: Patch[]): void {
    if (patches.length === 0) return;
    const MUD = this.arid ? SAND : this.frozen ? DRIFT : MUD_COLOURS;
    const PUDDLE = this.frozen ? ICE_PATCH : PUDDLE_COLOURS;
    const g = new ChunkedGraphics(this.scene, this.chunks, this.depths.overRoad);
    for (const patch of patches) {
      // A smooth, lumpy outline (no two alike), inside the ellipse the physics uses.
      const [p1, p2] = [this.rng.frac() * 6, this.rng.frac() * 6];
      const wobble = Array.from({ length: 28 }, (_, k) => {
        const a = (k / 28) * Math.PI * 2;
        return 0.9 + 0.06 * Math.sin(3 * a + p1) + 0.04 * Math.sin(5 * a + p2);
      });
      const at = (u: number, v: number) => {
        const p = poseAt(this.track, (((patch.along + u) % this.track.length) + this.track.length) % this.track.length);
        return { x: p.x - Math.sin(p.heading) * (patch.offset + v), y: p.y + Math.cos(p.heading) * (patch.offset + v) };
      };
      const blob = (scale: number, color: number, du = 0, dv = 0) => {
        const pts = wobble.map((f, k) => {
          const a = (k / wobble.length) * Math.PI * 2;
          return at(du + Math.cos(a) * (patch.length / 2) * f * scale, dv + Math.sin(a) * (patch.width / 2) * f * scale);
        });
        const c = at(du, dv);
        g.fillStyle(color);
        pts.forEach((p, k) => {
          const q = pts[(k + 1) % pts.length];
          g.fillTriangle(c.x, c.y, p.x, p.y, q.x, q.y);
        });
      };
      if (patch.kind === 'mud') {
        blob(1, MUD.rim);
        blob(0.82, MUD.body);
        for (let k = 0; k < 4; k++) {
          blob(0.18, MUD.sheen, this.rng.realInRange(-0.3, 0.3) * patch.length, this.rng.realInRange(-0.25, 0.25) * patch.width);
        }
        if (this.arid) {
          // Ripples across it, combed by the wind.
          g.fillStyle(MUD.rut, 0.55);
          for (let u = -patch.length * 0.4; u < patch.length * 0.4; u += 9) {
            for (let v = -0.36; v <= 0.36; v += 0.04) {
              const p = at(u + Math.sin(v * 9 + u * 0.05) * 3, v * patch.width);
              g.fillCircle(p.x, p.y, 1.3);
            }
          }
          continue;
        }
        // Ruts churned by earlier cars.
        g.fillStyle(MUD.rut);
        for (const v of [-0.22, 0.22]) {
          for (let u = -patch.length * 0.38; u < patch.length * 0.38; u += 6) {
            const p = at(u, v * patch.width);
            g.fillCircle(p.x, p.y, 2.6);
          }
        }
      } else {
        blob(1, PUDDLE.rim);
        blob(0.84, PUDDLE.water);
        blob(0.5, PUDDLE.sky, -patch.length * 0.12, -patch.width * 0.1);
        for (let k = 0; k < 2; k++) {
          const p = at(this.rng.realInRange(-0.25, 0.25) * patch.length, this.rng.realInRange(-0.2, 0.2) * patch.width);
          const image = this.scene.add
            .image(p.x, p.y, DECO_TEXTURE, 'glint')
            .setRotation(this.rng.angle() * (Math.PI / 180))
            .setDepth(this.depths.ripples);
          this.glints.push({ image, phase: this.rng.frac() * 6 });
        }
      }
    }
  }
}
