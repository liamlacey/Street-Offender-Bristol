import * as Phaser from 'phaser';
import type { Prop } from '../track/decoration';
import { type Track, type Vec2, locateOnTrack } from '../track/Track';
import { RUN_OFF, TYRE_RADIUS } from '../track/barriers';
import { type ChunkLayers, ChunkedGraphics } from '../scenes/ChunkLayers';
import { DECO_TEXTURE } from '../scenes/decorationArt';
import type { DecorationDepths } from '../scenes/Decorations';
import { TEX } from '../scenes/textures';
import { FIRE_FRAMES } from '../scenes/woodsArt';
import { DESERT_VARIANTS } from './art';
import { CACTI, WIND } from './style';

/** Light from the top left, as for the cars. */
const SHADOW_DIR = { x: 0.62, y: 0.78 };
const WIND_DIR = { x: Math.cos(WIND), y: Math.sin(WIND) };
/** How far a butte's top leans out from the middle of the view, for its height (as the city's towers do). */
const MESA_LEAN: [number, number] = [0.07, 0.15];
/** The bands of rock up a butte's side, bottom to top: [where each starts (0 base, 1 top), its colour in shade and in the sun]. */
const STRATA: [number, number, number][] = [
  [0, 0x5e2414, 0xa9472a],
  [0.22, 0x6f2c18, 0xc25b33],
  [0.4, 0x7d4a36, 0xd9997a],
  [0.52, 0x652816, 0xb44f2c],
  [0.74, 0x733019, 0xc8653b],
  [0.88, 0x6b5a45, 0xc9b08a],
];
const MESA_TOP = { shade: 0x9a5a36, lit: 0xc98a5a };
const SAND = { lit: 0xead5aa, body: 0xe2c89c, slip: 0xbf9566, crest: 0xf6e8c8, ripple: 0xcfb07f };
/** Tumbleweeds blowing across the open desert: how many at once, and how fast, px/s. */
const TUMBLEWEEDS = 4;
const TUMBLE_SPEED: [number, number] = [60, 120];
const DUST_DEVILS = 2;
const PUFFS = 12;
/** Seconds between UFO sightings. */
const UFO_GAP: [number, number] = [40, 90];
const UFO_SPEED = 520;

interface Mesa {
  base: Vec2[];
  /** The flat top, before leaning out. */
  top: Vec2[];
  centre: Vec2;
  lean: number;
  winding: number;
  box: { x0: number; y0: number; x1: number; y1: number };
}

interface Spinner {
  image: Phaser.GameObjects.Image;
  speed: number;
}

/** Something going round and round (a buggy over a dune, a land yacht up and down a lake bed, a walker round a camp). */
interface Rover {
  image: Phaser.GameObjects.Image;
  prop: Prop;
  /** Its path in the prop's frame, from 0 to 1 and round again. */
  path: (t: number) => Vec2;
  t: number;
  /** Laps per second. */
  rate: number;
  frames?: string[];
  /** Sand thrown up behind it. */
  dusty: boolean;
  /** Turned to face along its path (a land yacht's sail flips over when it changes tack). */
  flipOnReturn?: boolean;
}

interface Tumbleweed {
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  speed: number;
  phase: number;
  /** Seconds left caught against the rocks by the track (then it crumbles away); null while it rolls. */
  caught: number | null;
  /** Seconds until it next checks for the track. */
  check: number;
  /** Rolling down a ghost town's main street, round and round, rather than across the open desert. */
  street?: { prop: Prop; u: number; v: number; length: number };
}

interface DustDevil {
  x: number;
  y: number;
  life: number;
  age: number;
  turn: number;
  drift: Vec2;
  puffs: Phaser.GameObjects.Image[];
}

interface Vulture {
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  centre: Vec2;
  radius: number;
  a: number;
  rate: number;
}

interface Ufo {
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  beam: Phaser.GameObjects.Arc;
  from: Vec2;
  dir: Vec2;
  length: number;
  s: number;
  hover: number;
}

/**
 * The desert's scenery: buttes and mesas of banded red rock standing up out
 * of the sand (leaning out from the middle of the view as it moves), dunes
 * with buggies looping over them, dry lake beds with land yachts sailing
 * across, ghost towns of weathered wooden buildings with a water tower and
 * a windpump turning, desert camps round a campfire, rusting wrecks with
 * vultures circling, red rocks, cacti and Joshua trees. And blowing through
 * it all, tumbleweeds (which fetch up against the rocks by the track), dust
 * devils, and every so often a UFO.
 */
export class DesertScenery {
  private readonly mesas: Mesa[] = [];
  private readonly rock: Phaser.GameObjects.Graphics;
  private readonly ground: ChunkedGraphics;
  private readonly spinners: Spinner[] = [];
  private readonly rovers: Rover[] = [];
  private readonly fires: { image: Phaser.GameObjects.Image; phase: number }[] = [];
  private readonly smokeSources: Vec2[] = [];
  private readonly tumbleweeds: Tumbleweed[] = [];
  private readonly devils: DustDevil[] = [];
  private readonly vultures: Vulture[] = [];
  private readonly sand: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly rng: Phaser.Math.RandomDataGenerator;
  /** How far out from the middle of the road the tumbleweeds fetch up (against the barrier). */
  private readonly catchAt: number;
  private ufo: Ufo | null = null;
  private nextUfo: number;
  private nextDevil = 2;
  private dustDue = 0;
  private smokeDue = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly track: Track,
    private readonly depths: DecorationDepths,
    private readonly chunks: ChunkLayers,
  ) {
    this.rng = new Phaser.Math.RandomDataGenerator([`${track.length}`, 'desert']);
    this.nextUfo = this.rng.realInRange(12, 30);
    this.catchAt = track.kerbWidth + (track.runOff ?? RUN_OFF) - TYRE_RADIUS;
    this.rock = scene.add.graphics().setDepth(depths.overhead - 0.25);
    this.ground = new ChunkedGraphics(scene, chunks, depths.ground + 0.05);
    this.sand = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: { min: 600, max: 1300 },
        speed: { min: 10, max: 45 },
        scale: { start: 0.4, end: 1.6 },
        alpha: { start: 0.45, end: 0 },
        tint: [0xe0c79c, 0xd4b886],
        emitting: false,
      })
      .setDepth(depths.props + 0.04);
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
  }

  addProp(prop: Prop): void {
    switch (prop.kind) {
      case 'mesa':
        return this.addMesa(prop);
      case 'dune':
        return this.addDune(prop);
      case 'playa':
        return this.addPlaya(prop);
      case 'town':
        return this.addTown(prop);
      case 'campsite':
        return this.addCampsite(prop);
      case 'wreck':
        return this.addWreck(prop);
      case 'outcrop':
        return this.addOutcrop(prop);
      case 'cactus':
        return this.addCactus(prop);
      case 'windpump':
        return this.addWindpump(prop, prop.x, prop.y);
    }
  }

  update(time: number, dt: number, camera: Phaser.Cameras.Scene2D.Camera): void {
    const view = camera.worldView;
    const near = (x: number, y: number, margin: number) =>
      x > view.left - margin && x < view.right + margin && y > view.top - margin && y < view.bottom + margin;
    this.drawMesas(view);

    for (const s of this.spinners) if (near(s.image.x, s.image.y, 40)) s.image.rotation += s.speed * dt;

    this.dustDue -= dt;
    const dust = this.dustDue <= 0;
    if (dust) this.dustDue = 0.07;
    for (const r of this.rovers) {
      r.t = (r.t + r.rate * dt) % 1;
      const p = r.path(r.t);
      const q = r.path((r.t + 0.002) % 1);
      const at = this.local(r.prop, p.x, p.y);
      const show = near(at.x, at.y, 60);
      if (r.image.visible !== show) r.image.setVisible(show);
      if (!show) continue;
      const heading = r.prop.angle + Math.atan2(q.y - p.y, q.x - p.x);
      r.image.setPosition(at.x, at.y).setRotation(heading);
      if (r.flipOnReturn) r.image.setFlipY(q.x < p.x);
      if (r.frames) setFrame(r.image, r.frames[Math.floor(time / 220 + r.t * 50) % r.frames.length]);
      if (r.dusty && dust) this.sand.emitParticleAt(at.x - Math.cos(heading) * 14, at.y - Math.sin(heading) * 14, 1);
    }

    for (const f of this.fires) setFrame(f.image, `campfire-${Math.floor(time / 110 + f.phase) % FIRE_FRAMES}`);
    this.smokeDue -= dt;
    if (this.smokeDue <= 0) {
      this.smokeDue = 0.22;
      for (const s of this.smokeSources) if (near(s.x, s.y, 100)) this.smoke.emitParticleAt(s.x, s.y, 1);
    }

    this.updateTumbleweeds(dt, view, near);
    this.updateDustDevils(time, dt, view);
    for (const v of this.vultures) {
      v.a += v.rate * dt;
      const x = v.centre.x + Math.cos(v.a) * v.radius;
      const y = v.centre.y + Math.sin(v.a) * v.radius;
      const show = near(x, y, 160);
      if (v.image.visible !== show) {
        v.image.setVisible(show);
        v.shadow.setVisible(show);
      }
      if (!show) continue;
      const heading = v.a + Math.sign(v.rate) * (Math.PI / 2);
      v.image.setPosition(x, y).setRotation(heading);
      v.shadow.setPosition(x + SHADOW_DIR.x * 110, y + SHADOW_DIR.y * 110).setRotation(heading);
    }
    this.updateUfo(time, dt, view);
  }

  // --- Buttes and mesas ---------------------------------------------------------

  private addMesa(prop: Prop): void {
    const rand = new Phaser.Math.RandomDataGenerator([`${prop.variant}`]);
    const sides = rand.between(9, 13);
    const turn = rand.frac() * Math.PI * 2;
    const shrink = rand.realInRange(0.72, 0.88);
    const base: Vec2[] = [];
    const top: Vec2[] = [];
    for (let k = 0; k < sides; k++) {
      const a = turn + (k / sides) * Math.PI * 2;
      const f = rand.realInRange(0.8, 1);
      const u = Math.cos(a) * (prop.w / 2) * f;
      const v = Math.sin(a) * (prop.h / 2) * f;
      base.push(this.local(prop, u, v));
      const g = shrink * rand.realInRange(0.95, 1.05);
      top.push(this.local(prop, u * g, v * g));
    }
    let area = 0;
    base.forEach((a, k) => {
      const b = base[(k + 1) % base.length];
      area += a.x * b.y - b.x * a.y;
    });
    const xs = base.map((p) => p.x);
    const ys = base.map((p) => p.y);
    this.mesas.push({
      base,
      top,
      centre: { x: prop.x, y: prop.y },
      lean: rand.realInRange(...MESA_LEAN),
      winding: Math.sign(area),
      box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
    });
    // Its shadow on the sand, long, away from the light.
    const g = new ChunkedGraphics(this.scene, this.chunks, this.depths.shadows);
    g.fillStyle(0x5a3a20, 0.25);
    const reach = Math.min(prop.w, prop.h) * 0.35;
    const shifted = base.map((p) => ({ x: p.x + SHADOW_DIR.x * reach, y: p.y + SHADOW_DIR.y * reach }));
    for (const poly of [base, shifted]) for (let k = 1; k < poly.length - 1; k++) g.fillTriangle(poly[0].x, poly[0].y, poly[k].x, poly[k].y, poly[k + 1].x, poly[k + 1].y);
    base.forEach((a, k) => {
      const b = base[(k + 1) % base.length];
      const c = shifted[(k + 1) % base.length];
      const d = shifted[k];
      g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
      g.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
    });
    // Scree and fallen boulders round its foot.
    for (let k = rand.between(3, 7); k > 0; k--) {
      const p = base[rand.between(0, base.length - 1)];
      const out = { x: p.x + (p.x - prop.x) * rand.realInRange(0.04, 0.15), y: p.y + (p.y - prop.y) * rand.realInRange(0.04, 0.15) };
      const size = rand.realInRange(16, 34);
      const frame = `redrock-${rand.between(0, DESERT_VARIANTS.rock - 1)}`;
      this.chunks.add(this.scene.add.image(out.x, out.y, DECO_TEXTURE, frame).setDisplaySize(size, size).setRotation(rand.frac() * 6.3), this.depths.props);
    }
  }

  /**
   * Redraws the buttes near the view: each side face turned towards you, from
   * its foot up to the flat top (pushed out from the middle of the view by its
   * height), in bands of red and pale rock under a cap of harder stone, then
   * the top.
   */
  private drawMesas(view: Phaser.Geom.Rectangle): void {
    const g = this.rock;
    g.clear();
    const cx = view.centerX;
    const cy = view.centerY;
    for (const m of this.mesas) {
      const k1 = 1 + m.lean;
      const lift = (p: Vec2) => ({ x: cx + (p.x - cx) * k1, y: cy + (p.y - cy) * k1 });
      const shiftX = (m.centre.x - cx) * m.lean;
      const shiftY = (m.centre.y - cy) * m.lean;
      if (
        Math.max(m.box.x1, m.box.x1 + shiftX) < view.left ||
        Math.min(m.box.x0, m.box.x0 + shiftX) > view.right ||
        Math.max(m.box.y1, m.box.y1 + shiftY) < view.top ||
        Math.min(m.box.y0, m.box.y0 + shiftY) > view.bottom
      ) {
        continue;
      }
      const top = m.top.map(lift);
      const n = m.base.length;
      for (let k = 0; k < n; k++) {
        const a = m.base[k];
        const b = m.base[(k + 1) % n];
        const ta = top[k];
        const tb = top[(k + 1) % n];
        const mid = { x: (ta.x + tb.x) / 2, y: (ta.y + tb.y) / 2 };
        // Only the faces turned towards you.
        const side = (b.x - a.x) * (mid.y - a.y) - (b.y - a.y) * (mid.x - a.x);
        if (Math.sign(side) !== m.winding) continue;
        const nx = b.y - a.y;
        const ny = -(b.x - a.x);
        const len = Math.hypot(nx, ny) || 1;
        const facing = (-(nx / len) * SHADOW_DIR.x - (ny / len) * SHADOW_DIR.y) * m.winding;
        const light = Phaser.Math.Clamp(0.5 + facing * 0.55, 0, 1);
        STRATA.forEach(([from, shade, lit], s) => {
          const to = STRATA[s + 1]?.[0] ?? 1;
          const p0 = lerp(a, ta, from);
          const p1 = lerp(b, tb, from);
          const p2 = lerp(b, tb, to);
          const p3 = lerp(a, ta, to);
          g.fillStyle(mix(shade, lit, light));
          g.fillTriangle(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y);
          g.fillTriangle(p0.x, p0.y, p2.x, p2.y, p3.x, p3.y);
        });
        // A crack down the cliff.
        g.lineStyle(1.2, 0x3a160c, 0.35);
        const c0 = lerp(a, b, 0.4 + (k % 3) * 0.1);
        const c1 = lerp(ta, tb, 0.45 + (k % 2) * 0.1);
        g.lineBetween(c0.x, c0.y, c1.x, c1.y);
      }
      // The flat top, its rim catching the light.
      g.fillStyle(mix(MESA_TOP.shade, MESA_TOP.lit, 0.8));
      for (let k = 1; k < n - 1; k++) g.fillTriangle(top[0].x, top[0].y, top[k].x, top[k].y, top[k + 1].x, top[k + 1].y);
      g.lineStyle(2, 0xe0b48a, 0.7);
      top.forEach((p, k) => {
        const q = top[(k + 1) % n];
        g.lineBetween(p.x, p.y, q.x, q.y);
      });
      // Paler rock towards the middle, and scrub growing on it.
      const middle = lift(m.centre);
      const inner = top.map((p) => lerp(p, middle, 0.25));
      g.fillStyle(MESA_TOP.lit);
      for (let k = 1; k < n - 1; k++) g.fillTriangle(inner[0].x, inner[0].y, inner[k].x, inner[k].y, inner[k + 1].x, inner[k + 1].y);
      for (let k = 0; k < n; k++) {
        const p = lerp(top[k], middle, 0.2 + (k % 3) * 0.22);
        g.fillStyle(0x8f4f2c, 0.35).fillCircle(p.x + 9, p.y - 4, 10 + (k % 4) * 3);
        g.fillStyle(0x6f7a45, 0.8).fillCircle(p.x, p.y, 4 + (k % 2) * 2);
      }
    }
  }

  // --- Dunes ------------------------------------------------------------------

  /** A crescent dune, horns downwind: a long gentle slope up to the crest, rippled by the wind, and a steep slip face in shade beyond it. */
  private addDune(prop: Prop): void {
    const rx = prop.w / 2;
    const ry = prop.h / 2;
    const steps = 24;
    const across = (t: number) => t * ry;
    const windward = (t: number) => -rx * Math.sqrt(1 - t * t) + rx * 0.9 * t * t;
    const lee = (t: number) => rx * (0.15 + 0.85 * t * t);
    const crest = (t: number) => lee(t) - rx * 0.32 * (1 - t * t);
    const band = (inner: (t: number) => number, outer: (t: number) => number, color: number, alpha = 1, span = 1) => {
      this.ground.fillStyle(color, alpha);
      for (let k = 0; k < steps; k++) {
        const t0 = (k / steps) * 2 * span - span;
        const t1 = ((k + 1) / steps) * 2 * span - span;
        const a = this.local(prop, inner(t0), across(t0));
        const b = this.local(prop, inner(t1), across(t1));
        const c = this.local(prop, outer(t1), across(t1));
        const d = this.local(prop, outer(t0), across(t0));
        this.ground.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
        this.ground.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
      }
    };
    // A soft shadow of sand round it, then the windward slope, ripples, the slip face and the crest.
    band((t) => windward(t) - 14, (t) => lee(t) + 10, SAND.body, 0.6, 0.999);
    band(windward, crest, SAND.lit);
    for (let f = 0.12; f < 0.9; f += 0.11) {
      const at = (t: number) => windward(t) + (crest(t) - windward(t)) * f;
      band(at, (t) => at(t) + 2.2, SAND.ripple, 0.45, 0.85);
    }
    band(crest, lee, SAND.slip);
    band((t) => lee(t) - 6, lee, 0xa97e52, 0.4);
    band((t) => crest(t) - 2, (t) => crest(t) + 1.5, SAND.crest, 1, 0.95);
    // Every other dune has a buggy tearing round it.
    if (prop.variant % 2 === 0) {
      const image = this.scene.add.image(prop.x, prop.y, DECO_TEXTURE, 'buggy').setDepth(this.depths.props + 0.03);
      const lean = (prop.variant % 7) / 7;
      this.rovers.push({
        image,
        prop,
        path: (t) => {
          const a = t * Math.PI * 2;
          // A figure of eight over the crest.
          return { x: Math.sin(a) * rx * 0.75, y: Math.sin(a * 2) * ry * 0.45 };
        },
        t: lean,
        rate: 140 / (Math.PI * (rx + ry) * 1.6),
        dusty: true,
      });
    }
  }

  // --- Dry lake beds ----------------------------------------------------------------

  /** A dry lake bed: a flat of pale cracked clay, with land yachts sailing up and down it. */
  private addPlaya(prop: Prop): void {
    const rand = new Phaser.Math.RandomDataGenerator([`${prop.variant}`]);
    const wobble = Array.from({ length: 40 }, (_, k) => {
      const a = (k / 40) * Math.PI * 2;
      return 0.86 + 0.07 * Math.sin(3 * a + prop.variant) + 0.05 * Math.sin(5 * a + prop.variant * 2);
    });
    const inside = (u: number, v: number, scale: number) => {
      const a = Math.atan2(v / (prop.h / 2), u / (prop.w / 2));
      const k = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / 40)) % 40;
      return Math.hypot(u / (prop.w / 2), v / (prop.h / 2)) < wobble[k] * scale;
    };
    const blob = (scale: number, color: number) => {
      const pts = wobble.map((f, k) => {
        const a = (k / wobble.length) * Math.PI * 2;
        return this.local(prop, Math.cos(a) * (prop.w / 2) * f * scale, Math.sin(a) * (prop.h / 2) * f * scale);
      });
      this.ground.fillStyle(color);
      pts.forEach((p, k) => {
        const q = pts[(k + 1) % pts.length];
        this.ground.fillTriangle(prop.x, prop.y, p.x, p.y, q.x, q.y);
      });
    };
    blob(1, 0xd8c8a4);
    blob(0.95, 0xe9dec6);
    blob(0.6, 0xf0e7d4);
    // The clay cracked into plates: a jittered grid of lines.
    const cell = 34;
    const cols = Math.ceil(prop.w / cell);
    const rows = Math.ceil(prop.h / cell);
    const node = (i: number, j: number) => ({
      x: -prop.w / 2 + i * cell + (((i * 73 + j * 131 + prop.variant) % 17) / 17 - 0.5) * cell * 0.7,
      y: -prop.h / 2 + j * cell + (((i * 59 + j * 97 + prop.variant) % 13) / 13 - 0.5) * cell * 0.7,
    });
    this.ground.fillStyle(0xc2ae88, 0.75);
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const a = node(i, j);
        if (!inside(a.x, a.y, 0.93)) continue;
        for (const b of [node(i + 1, j), node(i, j + 1)]) {
          if (!inside(b.x, b.y, 0.93)) continue;
          const p = this.local(prop, a.x, a.y);
          const q = this.local(prop, b.x, b.y);
          const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
          const ox = ((q.y - p.y) / len) * 0.8;
          const oy = (-(q.x - p.x) / len) * 0.8;
          this.ground.fillTriangle(p.x + ox, p.y + oy, q.x + ox, q.y + oy, q.x - ox, q.y - oy);
          this.ground.fillTriangle(p.x + ox, p.y + oy, q.x - ox, q.y - oy, p.x - ox, p.y - oy);
        }
      }
    }
    // Land yachts reaching up and down it, turning at the ends.
    for (let k = rand.between(2, 3); k > 0; k--) {
      const lane = rand.realInRange(-0.3, 0.3) * prop.h;
      const reach = prop.w * rand.realInRange(0.28, 0.36);
      const swing = rand.realInRange(30, 60);
      const image = this.scene.add.image(prop.x, prop.y, DECO_TEXTURE, `landyacht-${rand.between(0, DESERT_VARIANTS.yacht - 1)}`).setScale(1.6).setDepth(this.depths.props + 0.03);
      this.rovers.push({
        image,
        prop,
        // A long oval: out along one side, round the end, and back along the other.
        path: (t) => {
          const a = t * Math.PI * 2;
          return { x: Math.cos(a) * reach, y: lane + Math.sin(a) * swing };
        },
        t: rand.frac(),
        rate: rand.realInRange(170, 230) / (Math.PI * 2 * reach),
        dusty: false,
        flipOnReturn: true,
      });
    }
  }

  // --- Ghost towns ----------------------------------------------------------------

  /**
   * A ghost town beside the road: a dusty main street running alongside it,
   * wooden buildings either side facing onto it (some fallen in), a water
   * tower at one end and a windpump at the other, a wagon left to rot,
   * outhouses out the back, and tumbleweeds rolling down the street.
   */
  private addTown(prop: Prop): void {
    const rand = new Phaser.Math.RandomDataGenerator([`${prop.variant}`]);
    const half = prop.w / 2;
    // The street, worn into the sand, with wheel ruts down it.
    const strip = (u0: number, u1: number, v0: number, v1: number, color: number, alpha = 1) => {
      const a = this.local(prop, u0, v0);
      const b = this.local(prop, u1, v0);
      const c = this.local(prop, u1, v1);
      const d = this.local(prop, u0, v1);
      this.ground.fillStyle(color, alpha);
      this.ground.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
      this.ground.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
    };
    strip(-half, half, -130, 125, 0xcfb185, 0.45);
    strip(-half + 30, half - 30, -40, 30, 0xc4a174);
    for (const v of [-18, -8, 8, 18]) strip(-half + 40, half - 40, v - 1.5, v + 1.5, 0x9c7a52, 0.4);
    // The buildings: a row on the far side facing the street (and the road), and one on the near side with its back to the road.
    const shadow = (img: Phaser.GameObjects.Image, length: number) => {
      const s = this.scene.add
        .image(img.x + SHADOW_DIR.x * length, img.y + SHADOW_DIR.y * length, DECO_TEXTURE, img.frame.name)
        .setRotation(img.rotation)
        .setTint(0x000000)
        .setAlpha(0.28);
      this.chunks.add(s, this.depths.shadows);
    };
    const place = (frame: string, u: number, v: number, turn: number, length = 6, depth = this.depths.props) => {
      const at = this.local(prop, u, v);
      const img = this.scene.add.image(at.x, at.y, DECO_TEXTURE, frame).setRotation(prop.angle + turn);
      this.chunks.add(img, depth);
      shadow(img, length);
      return img;
    };
    for (const row of [1, -1] as const) {
      let u = -half + 90 + rand.between(0, 30);
      while (u < half - 90) {
        const v = rand.between(0, DESERT_VARIANTS.shack - 1);
        const frame = this.scene.textures.getFrame(DECO_TEXTURE, `shack-${v}`);
        if (u + frame.width > half - 70) break;
        if (rand.frac() < 0.8) {
          // Its front (the frame's top edge) on the street.
          const depth = row === 1 ? 34 + frame.height / 2 : -44 - frame.height / 2;
          place(`shack-${v}`, u + frame.width / 2, depth, row === 1 ? 0 : Math.PI, 8);
        }
        u += frame.width + rand.between(8, 36);
      }
    }
    const end = rand.frac() < 0.5 ? 1 : -1;
    place('watertower', end * (half - 45), 70, 0, 14);
    this.addWindpump(prop, ...xy(this.local(prop, -end * (half - 40), 75)));
    place('wagon', end * (half - 35), -100, rand.realInRange(-0.4, 0.4), 4);
    place('wagonwheel', end * (half - 70), -140, rand.frac() * 6, 2);
    place('wagonwheel', -end * (half - 50), -135, rand.frac() * 6, 2);
    for (let k = rand.between(2, 3); k > 0; k--) place('outhouse', rand.realInRange(-0.7, 0.7) * half, 132, 0, 5);
    place('skull', rand.realInRange(-0.5, 0.5) * half, rand.realInRange(-30, 30), rand.frac() * 6, 1);
    // Tumbleweeds rolling down the street on the wind, and round again.
    for (let k = 0; k < 2; k++) {
      const image = this.scene.add.image(prop.x, prop.y, DECO_TEXTURE, `tumbleweed-${k % DESERT_VARIANTS.tumbleweed}`).setDepth(this.depths.props + 0.02);
      const shadowImg = this.scene.add.image(prop.x, prop.y, DECO_TEXTURE, image.frame.name).setTint(0x000000).setAlpha(0.22).setDepth(this.depths.shadows);
      this.tumbleweeds.push({
        image,
        shadow: shadowImg,
        speed: rand.realInRange(40, 70),
        phase: rand.frac() * 6,
        caught: null,
        check: 0,
        street: { prop, u: rand.frac() * prop.w, v: rand.realInRange(-25, 15), length: prop.w - 60 },
      });
    }
  }

  /** A windpump, its wheel turning in the wind, its vane streaming out behind, and a trough beside it. */
  private addWindpump(prop: Prop, x: number, y: number): void {
    const s = this.scene.add.image(x + SHADOW_DIR.x * 16, y + SHADOW_DIR.y * 16, DECO_TEXTURE, 'windmill-wheel').setTint(0x000000).setAlpha(0.2);
    this.chunks.add(s, this.depths.shadows);
    this.chunks.add(this.scene.add.image(x, y, DECO_TEXTURE, 'windmill-tower').setRotation(prop.angle), this.depths.props);
    this.chunks.add(this.scene.add.image(x + 26, y + 18, DECO_TEXTURE, 'trough').setRotation(WIND + 0.3), this.depths.props);
    const tail = this.scene.add.image(x + WIND_DIR.x * 16, y + WIND_DIR.y * 16, DECO_TEXTURE, 'windmill-tail').setRotation(WIND);
    this.chunks.add(tail, this.depths.overhead - 0.3);
    const wheel = this.scene.add.image(x, y, DECO_TEXTURE, 'windmill-wheel').setDepth(this.depths.overhead - 0.29);
    this.spinners.push({ image: wheel, speed: 2.2 + (prop.variant % 5) * 0.3 });
  }

  // --- Camps, wrecks, rocks and cacti -----------------------------------------------

  /** A desert camp: an RV with its awning out, a jeep, tents, and people sat round a campfire in folding chairs. */
  private addCampsite(prop: Prop): void {
    const rand = new Phaser.Math.RandomDataGenerator([`${prop.variant}`]);
    const place = (frame: string, u: number, v: number, turn = 0, length = 5, depth = this.depths.props) => {
      const at = this.local(prop, u, v);
      const img = this.scene.add.image(at.x, at.y, DECO_TEXTURE, frame).setRotation(prop.angle + turn);
      this.chunks.add(img, depth);
      if (length > 0) {
        const s = this.scene.add
          .image(at.x + SHADOW_DIR.x * length, at.y + SHADOW_DIR.y * length, DECO_TEXTURE, frame)
          .setRotation(prop.angle + turn)
          .setTint(0x000000)
          .setAlpha(0.28);
        this.chunks.add(s, this.depths.shadows);
      }
      return img;
    };
    const flip = rand.frac() < 0.5 ? 1 : -1;
    place('rv', -45 * flip, 18, 0, 7);
    place('awning', -50 * flip, -16, 0, 4, this.depths.props + 0.01);
    place('jeep', -55 * flip, 58, rand.realInRange(-0.3, 0.3), 5);
    place(`tent-${rand.between(0, 2)}`, 80 * flip, 40, rand.realInRange(-0.3, 0.3), 4);
    if (rand.frac() < 0.6) place(`tent-${rand.between(0, 2)}`, 30 * flip, 48, rand.realInRange(-0.3, 0.3), 4);
    // The fire, and chairs round it, most with someone in.
    const fire = { u: 48 * flip, v: -18 };
    const f = place('campfire-0', fire.u, fire.v, 0, 0);
    this.fires.push({ image: f, phase: rand.frac() * 3 });
    this.smokeSources.push({ x: f.x, y: f.y });
    const chairs = rand.between(3, 5);
    for (let k = 0; k < chairs; k++) {
      const a = (k / chairs) * Math.PI * 2 + rand.frac();
      const u = fire.u + Math.cos(a) * 24;
      const v = fire.v + Math.sin(a) * 24;
      // Facing the fire.
      const turn = a + Math.PI;
      place('chair', u, v, turn, 2);
      if (rand.frac() < 0.75) place(`sitter-${rand.between(0, DESERT_VARIANTS.people - 1)}`, u, v, turn, 2, this.depths.props + 0.01);
    }
    // Someone wandering between the RV and the fire.
    const look = rand.between(0, DESERT_VARIANTS.people - 1);
    const image = this.scene.add.image(prop.x, prop.y, DECO_TEXTURE, `walker-${look}-0`).setScale(1.2).setDepth(this.depths.props + 0.02);
    this.rovers.push({
      image,
      prop,
      path: (t) => {
        const a = t * Math.PI * 2;
        return { x: Math.cos(a) * 60 - 5 * flip, y: -30 + Math.sin(a) * 14 };
      },
      t: rand.frac(),
      rate: 1 / 18,
      frames: [`walker-${look}-0`, `walker-${look}-1`],
      dusty: false,
    });
  }

  /** A rusting wreck, sand drifted round it, with vultures circling over (as they will). */
  private addWreck(prop: Prop): void {
    const rand = new Phaser.Math.RandomDataGenerator([`${prop.variant}`]);
    const at = this.local(prop, 0, 0);
    this.ground.fillStyle(0xe2c89c, 0.8);
    this.ground.fillCircle(at.x + WIND_DIR.x * 10, at.y + WIND_DIR.y * 10, 34);
    const frame = `wreck-${rand.between(0, DESERT_VARIANTS.wreck - 1)}`;
    const turn = prop.angle + rand.realInRange(-0.6, 0.6);
    const s = this.scene.add.image(at.x + SHADOW_DIR.x * 5, at.y + SHADOW_DIR.y * 5, DECO_TEXTURE, frame).setRotation(turn).setTint(0x000000).setAlpha(0.28);
    this.chunks.add(s, this.depths.shadows);
    this.chunks.add(this.scene.add.image(at.x, at.y, DECO_TEXTURE, frame).setRotation(turn), this.depths.props);
    const skull = this.local(prop, rand.realInRange(-30, 30), rand.realInRange(10, 25));
    this.chunks.add(this.scene.add.image(skull.x, skull.y, DECO_TEXTURE, 'skull').setRotation(rand.frac() * 6), this.depths.props);
    this.addVultures(at, rand.between(2, 3), rand);
  }

  private addVultures(centre: Vec2, count: number, rand: Phaser.Math.RandomDataGenerator): void {
    const radius = rand.realInRange(70, 120);
    const rate = (rand.frac() < 0.5 ? 1 : -1) * rand.realInRange(0.35, 0.55);
    for (let k = 0; k < count; k++) {
      const image = this.scene.add.image(centre.x, centre.y, DECO_TEXTURE, 'vulture').setScale(1.3).setDepth(this.depths.sky);
      const shadow = this.scene.add.image(centre.x, centre.y, DECO_TEXTURE, 'vulture').setScale(1.3).setTint(0x000000).setAlpha(0.15).setDepth(this.depths.shadows);
      this.vultures.push({ image, shadow, centre, radius: radius * rand.realInRange(0.8, 1.2), a: (k / count) * Math.PI * 2 + rand.frac(), rate });
    }
  }

  /** A pile of red rocks. */
  private addOutcrop(prop: Prop): void {
    const rand = new Phaser.Math.RandomDataGenerator([`${prop.variant}`]);
    for (let k = rand.between(3, 6); k > 0; k--) {
      const size = rand.realInRange(0.25, 0.55) * prop.w;
      const a = rand.frac() * Math.PI * 2;
      const r = rand.frac() * (prop.w / 2 - size / 2);
      const x = prop.x + Math.cos(a) * r;
      const y = prop.y + Math.sin(a) * r;
      const frame = `redrock-${rand.between(0, DESERT_VARIANTS.rock - 1)}`;
      const angle = rand.frac() * Math.PI * 2;
      const s = this.scene.add.image(x + SHADOW_DIR.x * 7, y + SHADOW_DIR.y * 7, DECO_TEXTURE, frame).setDisplaySize(size, size).setRotation(angle).setTint(0x000000).setAlpha(0.25);
      this.chunks.add(s, this.depths.shadows);
      this.chunks.add(this.scene.add.image(x, y, DECO_TEXTURE, frame).setDisplaySize(size, size).setRotation(angle), this.depths.props);
    }
    // Now and then something's died out here.
    if (prop.variant % 9 === 0) this.addVultures({ x: prop.x, y: prop.y }, 2, rand);
  }

  /** A cactus, a Joshua tree or a clump of sagebrush, its shadow as long as it's tall. */
  private addCactus(prop: Prop): void {
    const kind = CACTI[prop.variant % CACTI.length];
    const variants = { joshua: DESERT_VARIANTS.joshua, saguaro: DESERT_VARIANTS.saguaro, pricklypear: DESERT_VARIANTS.pear, sage: DESERT_VARIANTS.sage, barrelcactus: 0 };
    const count = variants[kind];
    const frame = count > 0 ? `${kind}-${(prop.variant * 7 + Math.round(prop.x)) % count}` : kind;
    const length = kind === 'joshua' ? 14 : kind === 'saguaro' ? 16 : 3;
    const s = this.scene.add
      .image(prop.x + SHADOW_DIR.x * length, prop.y + SHADOW_DIR.y * length, DECO_TEXTURE, frame)
      .setDisplaySize(prop.w, prop.h)
      .setRotation(prop.angle)
      .setTint(0x000000)
      .setAlpha(0.25);
    this.chunks.add(s, this.depths.shadows);
    const tall = kind === 'joshua' || kind === 'saguaro';
    this.chunks.add(this.scene.add.image(prop.x, prop.y, DECO_TEXTURE, frame).setDisplaySize(prop.w, prop.h).setRotation(prop.angle), tall ? this.depths.overhead - 0.3 : this.depths.props);
  }

  // --- Things blowing about -------------------------------------------------------

  /**
   * Tumbleweeds bounding across the desert on the wind from beyond the view,
   * until they fetch up against the rocks along the track (where they sit a
   * while, then break up and blow away). Off the track only: anything on it
   * has to be something the cars can knock about.
   */
  private updateTumbleweeds(dt: number, view: Phaser.Geom.Rectangle, near: (x: number, y: number, m: number) => boolean): void {
    const free = this.tumbleweeds.filter((t) => !t.street).length;
    if (free < TUMBLEWEEDS && this.rng.frac() < dt * 0.6) this.spawnTumbleweed(view);
    for (let k = this.tumbleweeds.length - 1; k >= 0; k--) {
      const t = this.tumbleweeds[k];
      t.phase += dt * t.speed * 0.08;
      const bounce = Math.abs(Math.sin(t.phase * 1.3));
      if (t.street) {
        // Down the main street and round again.
        const st = t.street;
        st.u = (st.u + t.speed * dt) % st.length;
        const at = this.local(st.prop, st.u - st.length / 2, st.v + Math.sin(t.phase) * 6);
        if (!near(at.x, at.y, 40)) continue;
        t.image.setPosition(at.x, at.y).setRotation(t.image.rotation + t.speed * dt * 0.08).setScale(1 + bounce * 0.15);
        t.shadow.setPosition(at.x + SHADOW_DIR.x * (3 + bounce * 6), at.y + SHADOW_DIR.y * (3 + bounce * 6));
        t.image.setAlpha(Math.min(1, st.u / 40, (st.length - st.u) / 40));
        t.shadow.setAlpha(t.image.alpha * 0.22);
        continue;
      }
      if (t.caught !== null) {
        t.caught -= dt;
        t.image.setRotation(t.image.rotation + Math.sin(t.phase * 3) * 0.01);
        if (t.caught < 1) {
          t.image.setAlpha(Math.max(0, t.caught));
          t.shadow.setAlpha(Math.max(0, t.caught) * 0.22);
        }
        if (t.caught <= 0 || !near(t.image.x, t.image.y, 400)) this.removeTumbleweed(k);
        continue;
      }
      t.image.x += WIND_DIR.x * t.speed * dt;
      t.image.y += WIND_DIR.y * t.speed * dt + Math.sin(t.phase * 0.7) * 0.4;
      t.image.setRotation(t.image.rotation + t.speed * dt * 0.08).setScale(1.2 + bounce * 0.2);
      t.shadow.setPosition(t.image.x + SHADOW_DIR.x * (3 + bounce * 8), t.image.y + SHADOW_DIR.y * (3 + bounce * 8));
      if (!near(t.image.x, t.image.y, 300)) {
        this.removeTumbleweed(k);
        continue;
      }
      t.check -= dt;
      if (t.check > 0) continue;
      t.check = 0.2;
      const pos = locateOnTrack(this.track, t.image.x, t.image.y);
      if (pos.distance - pos.halfWidth < this.catchAt) {
        t.caught = this.rng.realInRange(4, 9);
      }
    }
  }

  private spawnTumbleweed(view: Phaser.Geom.Rectangle): void {
    // From just upwind of the view, anywhere across it.
    const reach = Math.hypot(view.width, view.height) / 2 + 60;
    const side = this.rng.realInRange(-1, 1) * reach;
    const x = view.centerX - WIND_DIR.x * reach - WIND_DIR.y * side;
    const y = view.centerY - WIND_DIR.y * reach + WIND_DIR.x * side;
    const pos = locateOnTrack(this.track, x, y);
    if (pos.distance - pos.halfWidth < this.catchAt + 20) return;
    const frame = `tumbleweed-${this.rng.between(0, DESERT_VARIANTS.tumbleweed - 1)}`;
    const image = this.scene.add.image(x, y, DECO_TEXTURE, frame).setScale(1.2).setDepth(this.depths.props + 0.02);
    const shadow = this.scene.add.image(x, y, DECO_TEXTURE, frame).setScale(1.2).setTint(0x000000).setAlpha(0.22).setDepth(this.depths.shadows);
    this.tumbleweeds.push({ image, shadow, speed: this.rng.realInRange(...TUMBLE_SPEED), phase: this.rng.frac() * 6, caught: null, check: 0 });
  }

  private removeTumbleweed(k: number): void {
    const t = this.tumbleweeds[k];
    t.image.destroy();
    t.shadow.destroy();
    this.tumbleweeds.splice(k, 1);
  }

  /** Dust devils: spinning columns of dust wandering across the desert on the wind, then dying away. */
  private updateDustDevils(time: number, dt: number, view: Phaser.Geom.Rectangle): void {
    this.nextDevil -= dt;
    if (this.nextDevil <= 0 && this.devils.length < DUST_DEVILS) {
      this.nextDevil = this.rng.realInRange(6, 14);
      const puffs = Array.from({ length: PUFFS }, () =>
        this.scene.add.image(0, 0, TEX.puff).setTint(0xa98a5f).setDepth(this.depths.overhead - 0.1),
      );
      this.devils.push({
        x: view.x + this.rng.frac() * view.width,
        y: view.y + this.rng.frac() * view.height,
        life: this.rng.realInRange(10, 20),
        age: 0,
        turn: this.rng.frac() * 6,
        drift: { x: WIND_DIR.x * 35 + this.rng.realInRange(-15, 15), y: WIND_DIR.y * 35 + this.rng.realInRange(-15, 15) },
        puffs,
      });
    }
    for (let k = this.devils.length - 1; k >= 0; k--) {
      const d = this.devils[k];
      d.age += dt;
      d.x += d.drift.x * dt + Math.sin(time / 900 + d.turn) * 0.5;
      d.y += d.drift.y * dt + Math.cos(time / 1100 + d.turn) * 0.5;
      d.turn += dt * 7;
      // Builds up, then fades away.
      const strength = Math.min(1, d.age / 2, (d.life - d.age) / 2);
      if (strength <= 0) {
        for (const p of d.puffs) p.destroy();
        this.devils.splice(k, 1);
        continue;
      }
      d.puffs.forEach((p, i) => {
        // A spiral, wider and fainter at the top, leaning downwind.
        const f = i / PUFFS;
        const a = d.turn * (1.4 - f * 0.6) + i * 0.9;
        const r = 4 + f * 26;
        const lean = f * 30;
        p.setPosition(d.x + Math.cos(a) * r + WIND_DIR.x * lean, d.y + Math.sin(a) * r + WIND_DIR.y * lean);
        p.setScale(0.6 + f * 1.8).setAlpha((0.55 - f * 0.3) * strength);
      });
      if (this.rng.frac() < dt * 8) this.sand.emitParticleAt(d.x, d.y, 1);
    }
  }

  /** Every so often a UFO streaks over (this is Nevada), stops to hover with its beam on the sand, and is gone. */
  private updateUfo(time: number, dt: number, view: Phaser.Geom.Rectangle): void {
    if (!this.ufo) {
      this.nextUfo -= dt;
      if (this.nextUfo > 0) return;
      const dirA = this.rng.frac() * Math.PI * 2;
      const dir = { x: Math.cos(dirA), y: Math.sin(dirA) };
      const reach = Math.hypot(view.width, view.height) / 2 + 120;
      const side = this.rng.realInRange(-0.4, 0.4) * reach;
      const from = { x: view.centerX - dir.x * reach - dir.y * side, y: view.centerY - dir.y * reach + dir.x * side };
      const image = this.scene.add.image(from.x, from.y, DECO_TEXTURE, 'ufo-0').setDepth(this.depths.sky + 0.1);
      const shadow = this.scene.add.image(from.x, from.y, DECO_TEXTURE, 'ufo-0').setTint(0x000000).setAlpha(0.2).setDepth(this.depths.shadows);
      const beam = this.scene.add.circle(from.x, from.y, 38, 0xb8ffb0, 0).setDepth(this.depths.shadows + 0.01);
      this.ufo = { image, shadow, beam, from, dir, length: reach * 2, s: 0, hover: this.rng.realInRange(1.5, 3) };
      return;
    }
    const u = this.ufo;
    // Fast in, a pause halfway, then off again.
    const halfway = u.length * 0.45;
    if (u.s < halfway || u.hover <= 0) u.s += UFO_SPEED * dt;
    else u.hover -= dt;
    const hovering = u.s >= halfway && u.hover > 0;
    const x = u.from.x + u.dir.x * u.s + (hovering ? Math.sin(time / 200) * 3 : 0);
    const y = u.from.y + u.dir.y * u.s + (hovering ? Math.cos(time / 260) * 3 : 0);
    u.image.setPosition(x, y).setRotation(time / 400);
    setFrame(u.image, `ufo-${Math.floor(time / 150) % 2}`);
    u.shadow.setPosition(x + SHADOW_DIR.x * 160, y + SHADOW_DIR.y * 160).setRotation(u.image.rotation);
    u.beam.setPosition(x + SHADOW_DIR.x * 160, y + SHADOW_DIR.y * 160).setFillStyle(0xb8ffb0, hovering ? 0.5 + Math.sin(time / 90) * 0.12 : 0);
    if (u.s > u.length) {
      u.image.destroy();
      u.shadow.destroy();
      u.beam.destroy();
      this.ufo = null;
      this.nextUfo = this.rng.realInRange(...UFO_GAP);
    }
  }

  /** A point on a prop, `u` px along it and `v` px back from its centre. */
  private local(prop: Prop, u: number, v: number): Vec2 {
    const c = Math.cos(prop.angle);
    const s = Math.sin(prop.angle);
    return { x: prop.x + c * u - s * v, y: prop.y + s * u + c * v };
  }
}

function xy(p: Vec2): [number, number] {
  return [p.x, p.y];
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** A colour part way from one to another. */
function mix(from: number, to: number, t: number): number {
  const a = Phaser.Display.Color.IntegerToColor(from);
  const b = Phaser.Display.Color.IntegerToColor(to);
  return Phaser.Display.Color.GetColor(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t);
}

function setFrame(image: Phaser.GameObjects.Image, frame: string): void {
  if (image.frame.name !== frame) image.setFrame(frame, false, false);
}
