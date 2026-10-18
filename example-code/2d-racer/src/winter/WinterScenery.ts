import * as Phaser from 'phaser';
import type { Prop } from '../track/decoration';
import type { Vec2 } from '../track/Track';
import { type ChunkLayers, ChunkedGraphics } from '../scenes/ChunkLayers';
import { DECO_TEXTURE } from '../scenes/decorationArt';
import type { DecorationDepths } from '../scenes/Decorations';
import { TEX } from '../scenes/textures';
import { WINTER_VARIANTS } from './art';
import { LIFT_INSET } from './style';

/** Light from the top left, as for the cars. */
const SHADOW_DIR = { x: 0.62, y: 0.78 };
/** How far a mountain's summit leans out from the middle of the view, for its height (as the city's towers do). */
const PEAK_LEAN: [number, number] = [0.14, 0.24];
/** Rock and snow, from in deep shade to full in the light. */
const ROCK = { shade: 0x45433f, lit: 0x938d80 };
const SNOWCAP = { shade: 0x8ea6ba, lit: 0xffffff };
/** The chairlift: how far apart the chairs are, and how fast they go, px and px/s. */
const CHAIR_GAP = 70;
const LIFT_SPEED = 55;
const SKIER_SCALE = 1.3;

/** A mountain: its base outline, its summit, and where the snow starts on each face. */
interface Peak {
  base: Vec2[];
  summit: Vec2;
  lean: number;
  snowline: number[];
  /** Its outline's winding (to tell the faces you can see from the ones turned away). */
  winding: number;
  box: { x0: number; y0: number; x1: number; y1: number };
}

/** Someone skiing or snowboarding down a piste in long turns, then riding the lift back up. */
interface Skier {
  piste: Piste;
  image: Phaser.GameObjects.Image;
  look: string;
  /** Distance down the run from the top, px. */
  d: number;
  speed: number;
  /** Where they are in their turns, and how wide they swing. */
  phase: number;
  swing: number;
  /** Seconds left on the lift before they start down again. */
  riding: number;
}

/** A piste: its frame (u across, v away from the road: the bottom is by the road, the top far up). */
interface Piste {
  prop: Prop;
  /** Half-width of the run itself, and the middle of it, across. */
  run: number;
  middle: number;
  /** Where the lift's cable runs, across. */
  lift: number;
  length: number;
  chairs: { image: Phaser.GameObjects.Image; s: number }[];
}

/** A skater going round a lake. */
interface Skater {
  image: Phaser.GameObjects.Image;
  prop: Prop;
  rx: number;
  ry: number;
  t: number;
  speed: number;
  dir: 1 | -1;
  look: number;
}

/**
 * Winter's big things: mountains standing up out of the snow (leaning out
 * from the middle of the view as it moves, like the city's towers, rock below
 * and snow above), frozen lakes with skaters going round and an ice-fishing
 * hut, ski runs up through the trees with a chairlift carrying people up and
 * skiers and snowboarders carving their way down, and snowmen.
 */
export class WinterScenery {
  private readonly peaks: Peak[] = [];
  private readonly mountains: Phaser.GameObjects.Graphics;
  private readonly pistes: Piste[] = [];
  private readonly skiers: Skier[] = [];
  private readonly skaters: Skater[] = [];
  private readonly spray: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly ground: ChunkedGraphics;
  private readonly marks: ChunkedGraphics;
  private sprayDue = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depths: DecorationDepths,
    private readonly chunks: ChunkLayers,
  ) {
    this.mountains = scene.add.graphics().setDepth(depths.overhead - 0.25);
    this.ground = new ChunkedGraphics(scene, chunks, depths.ground + 0.05);
    this.marks = new ChunkedGraphics(scene, chunks, depths.ground + 0.06);
    this.spray = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: 700,
        speed: { min: 10, max: 40 },
        scale: { start: 0.25, end: 0.9 },
        alpha: { start: 0.7, end: 0 },
        tint: 0xffffff,
        emitting: false,
      })
      .setDepth(depths.props + 0.04);
  }

  addProp(prop: Prop): void {
    if (prop.kind === 'peak') this.addPeak(prop);
    else if (prop.kind === 'lake') this.addLake(prop);
    else if (prop.kind === 'piste') this.addPiste(prop);
    else if (prop.kind === 'snowmen') this.addSnowmen(prop);
    else if (prop.kind === 'boulders') this.addBoulders(prop);
  }

  update(time: number, dt: number, camera: Phaser.Cameras.Scene2D.Camera): void {
    const view = camera.worldView;
    const near = (x: number, y: number, margin: number) =>
      x > view.left - margin && x < view.right + margin && y > view.top - margin && y < view.bottom + margin;
    this.drawPeaks(view);
    this.sprayDue -= dt;
    const spray = this.sprayDue <= 0;
    if (spray) this.sprayDue = 0.08;

    for (const p of this.pistes) {
      // The chairs go round: up one side, down the other.
      const loop = p.length * 2;
      for (const chair of p.chairs) {
        chair.s = (chair.s + LIFT_SPEED * dt) % loop;
        const up = chair.s < p.length;
        // From the bottom station (by the road) to the top, and back down.
        const k = (p.length - 80) / p.length;
        const v = up ? -p.length / 2 + 40 + chair.s * k : p.length / 2 - 40 - (chair.s - p.length) * k;
        const at = this.local(p.prop, p.lift + (up ? 8 : -8), v);
        chair.image.setPosition(at.x, at.y);
        setFrame(chair.image, up ? 'liftchair-1' : 'liftchair-0');
      }
    }

    for (const s of this.skiers) this.updateSkier(s, dt, spray, near);

    for (const k of this.skaters) {
      k.t += (k.dir * k.speed * dt) / Math.max(k.rx, k.ry);
      const u = Math.cos(k.t) * k.rx;
      const v = Math.sin(k.t) * k.ry;
      const at = this.local(k.prop, u, v);
      // Facing along the loop.
      const du = -Math.sin(k.t) * k.rx * k.dir;
      const dv = Math.cos(k.t) * k.ry * k.dir;
      const heading = k.prop.angle + Math.atan2(dv, du);
      if (!near(at.x, at.y, 40)) continue;
      k.image.setPosition(at.x, at.y).setRotation(heading);
      setFrame(k.image, `skater-${k.look}-${Math.floor(time / 300 + k.look) % 2}`);
    }
  }

  // --- Mountains ------------------------------------------------------------

  private addPeak(prop: Prop): void {
    const rand = new Phaser.Math.RandomDataGenerator([`${prop.variant}`]);
    const r = prop.w / 2;
    const sides = rand.between(10, 14);
    const turn = rand.frac() * Math.PI * 2;
    const base = Array.from({ length: sides }, (_, k) => {
      const a = turn + (k / sides) * Math.PI * 2;
      const rr = r * rand.realInRange(0.68, 1);
      return { x: prop.x + Math.cos(a) * rr, y: prop.y + Math.sin(a) * rr };
    });
    const summit = { x: prop.x + rand.realInRange(-0.15, 0.15) * r, y: prop.y + rand.realInRange(-0.15, 0.15) * r };
    let area = 0;
    base.forEach((a, k) => {
      const b = base[(k + 1) % base.length];
      area += a.x * b.y - b.x * a.y;
    });
    const lean = rand.realInRange(...PEAK_LEAN);
    const snowline = base.map(() => rand.realInRange(0.12, 0.42));
    const xs = base.map((p) => p.x);
    const ys = base.map((p) => p.y);
    this.peaks.push({
      base,
      summit,
      lean,
      snowline,
      winding: Math.sign(area),
      box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
    });
    // Its shadow on the snow, long, away from the light.
    const g = new ChunkedGraphics(this.scene, this.chunks, this.depths.shadows);
    g.fillStyle(0x3a5068, 0.22);
    const reach = r * 0.9;
    const shifted = base.map((p) => ({ x: p.x + SHADOW_DIR.x * reach, y: p.y + SHADOW_DIR.y * reach }));
    for (const poly of [base, shifted]) for (let k = 1; k < poly.length - 1; k++) g.fillTriangle(poly[0].x, poly[0].y, poly[k].x, poly[k].y, poly[k + 1].x, poly[k + 1].y);
    base.forEach((a, k) => {
      const b = base[(k + 1) % base.length];
      const c = shifted[(k + 1) % base.length];
      const d = shifted[k];
      g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
      g.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
    });
  }

  /**
   * Redraws the mountains near the view: each face from the base up to the
   * summit (pushed out from the middle of the view by its height), rock below
   * the snow line and snow above, lit or in shade by which way it faces.
   */
  private drawPeaks(view: Phaser.Geom.Rectangle): void {
    const g = this.mountains;
    g.clear();
    const cx = view.centerX;
    const cy = view.centerY;
    for (const p of this.peaks) {
      const top = { x: cx + (p.summit.x - cx) * (1 + p.lean), y: cy + (p.summit.y - cy) * (1 + p.lean) };
      const x0 = Math.min(p.box.x0, top.x);
      const x1 = Math.max(p.box.x1, top.x);
      const y0 = Math.min(p.box.y0, top.y);
      const y1 = Math.max(p.box.y1, top.y);
      if (x1 < view.left || x0 > view.right || y1 < view.top || y0 > view.bottom) continue;
      const { base } = p;
      base.forEach((a, k) => {
        const b = base[(k + 1) % base.length];
        // Only the faces turned towards you.
        const side = (b.x - a.x) * (top.y - a.y) - (b.y - a.y) * (top.x - a.x);
        if (Math.sign(side) !== p.winding) return;
        // Lit if it faces up and left, towards the light.
        const nx = b.y - a.y;
        const ny = -(b.x - a.x);
        const len = Math.hypot(nx, ny) || 1;
        const facing = (-(nx / len) * SHADOW_DIR.x - (ny / len) * SHADOW_DIR.y) * p.winding;
        // How much light it catches: 0 turned away, 1 facing the light.
        const light = Phaser.Math.Clamp(0.5 + facing * 0.55 + (k % 2) * 0.05, 0, 1);
        g.fillStyle(mix(ROCK.shade, ROCK.lit, light));
        g.fillTriangle(a.x, a.y, b.x, b.y, top.x, top.y);
        // The snow from the snow line up.
        const sa = p.snowline[k];
        const sb = p.snowline[(k + 1) % base.length];
        const pa = { x: a.x + (top.x - a.x) * sa, y: a.y + (top.y - a.y) * sa };
        const pb = { x: b.x + (top.x - b.x) * sb, y: b.y + (top.y - b.y) * sb };
        g.fillStyle(mix(SNOWCAP.shade, SNOWCAP.lit, light));
        g.fillTriangle(pa.x, pa.y, pb.x, pb.y, top.x, top.y);
        // A gully of rock running up through the snow.
        g.fillStyle(mix(ROCK.shade, ROCK.lit, light * 0.8), 0.55);
        const m = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
        const mid = { x: m.x + (top.x - m.x) * 0.45, y: m.y + (top.y - m.y) * 0.45 };
        g.fillTriangle(m.x - (pb.x - pa.x) * 0.06, m.y - (pb.y - pa.y) * 0.06, m.x + (pb.x - pa.x) * 0.06, m.y + (pb.y - pa.y) * 0.06, mid.x, mid.y);
        // The ridge between this face and the next, up to the summit.
        g.lineStyle(1.5, 0x2e2c29, 0.45);
        g.lineBetween(b.x, b.y, top.x, top.y);
      });
    }
  }

  // --- Lakes ------------------------------------------------------------------

  /** A frozen lake: snow drifted round its shore, ice with cracks and skate marks, skaters, and an ice-fishing hut. */
  private addLake(prop: Prop): void {
    const rand = new Phaser.Math.RandomDataGenerator([`${prop.variant}`]);
    const wobble = Array.from({ length: 40 }, (_, k) => {
      const a = (k / 40) * Math.PI * 2;
      return 0.86 + 0.07 * Math.sin(3 * a + prop.variant) + 0.05 * Math.sin(5 * a + prop.variant * 2);
    });
    const blob = (scale: number, color: number, alpha = 1) => {
      const pts = wobble.map((f, k) => {
        const a = (k / wobble.length) * Math.PI * 2;
        return this.local(prop, Math.cos(a) * (prop.w / 2) * f * scale, Math.sin(a) * (prop.h / 2) * f * scale);
      });
      this.ground.fillStyle(color, alpha);
      pts.forEach((p, k) => {
        const q = pts[(k + 1) % pts.length];
        this.ground.fillTriangle(prop.x, prop.y, p.x, p.y, q.x, q.y);
      });
    };
    blob(1, 0xd5e1e9);
    blob(0.93, 0x93bfd6);
    blob(0.75, 0xa9cfe2);
    blob(0.45, 0xc3e0ee, 0.8);
    // Skate marks: loops scratched white on the ice.
    this.marks.fillStyle(0xffffff, 0.35);
    for (let loop = 0; loop < 3; loop++) {
      const rx = (prop.w / 2) * rand.realInRange(0.35, 0.65);
      const ry = (prop.h / 2) * rand.realInRange(0.35, 0.65);
      for (let a = 0; a < Math.PI * 2; a += 0.08) {
        const p = this.local(prop, Math.cos(a) * rx, Math.sin(a) * ry);
        this.marks.fillRect(p.x - 0.7, p.y - 0.7, 1.4, 1.4);
      }
    }
    // An ice-fishing hut near the edge, with someone sat by their hole.
    const hu = rand.realInRange(0.3, 0.5) * (prop.w / 2) * (rand.frac() < 0.5 ? 1 : -1);
    const hut = this.local(prop, hu, rand.realInRange(-0.2, 0.2) * prop.h);
    this.chunks.add(this.scene.add.image(hut.x, hut.y, DECO_TEXTURE, 'icehut').setRotation(prop.angle), this.depths.props);
    this.marks.fillStyle(0x3d6f8a).fillCircle(hut.x + 24, hut.y + 4, 5);
    // Skaters going round.
    for (let k = rand.between(2, 5); k > 0; k--) {
      const look = rand.between(0, WINTER_VARIANTS.people - 1);
      const image = this.scene.add.image(prop.x, prop.y, DECO_TEXTURE, `skater-${look}-0`).setScale(1.4).setDepth(this.depths.props + 0.02);
      this.skaters.push({
        image,
        prop,
        rx: (prop.w / 2) * rand.realInRange(0.3, 0.62),
        ry: (prop.h / 2) * rand.realInRange(0.3, 0.6),
        t: rand.frac() * Math.PI * 2,
        speed: rand.realInRange(45, 80),
        dir: rand.frac() < 0.5 ? 1 : -1,
        look,
      });
    }
  }

  // --- Ski runs ---------------------------------------------------------------

  /** A ski run up the hill from by the road: groomed snow with marker poles, a chairlift, and people coming down. */
  private addPiste(prop: Prop): void {
    const rand = new Phaser.Math.RandomDataGenerator([`${prop.variant}`]);
    const length = prop.h;
    const runWidth = prop.w - LIFT_INSET * 2;
    const p: Piste = { prop, run: runWidth / 2, middle: -prop.w / 2 + runWidth / 2, lift: prop.w / 2 - LIFT_INSET, length, chairs: [] };
    // Groomed snow, combed into lines down the slope.
    const strip = (u0: number, u1: number, v0: number, v1: number, color: number, alpha = 1) => {
      const a = this.local(prop, u0, v0);
      const b = this.local(prop, u1, v0);
      const c = this.local(prop, u1, v1);
      const d = this.local(prop, u0, v1);
      this.ground.fillStyle(color, alpha);
      this.ground.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
      this.ground.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
    };
    strip(-prop.w / 2, prop.w / 2 - LIFT_INSET * 2 + 6, -length / 2, length / 2, 0xf6f9fb);
    for (let u = -prop.w / 2 + 6; u < prop.w / 2 - LIFT_INSET * 2; u += 9) strip(u, u + 3, -length / 2 + 10, length / 2 - 10, 0xdfe8ee, 0.8);
    // The lift's track up the side.
    strip(p.lift - 16, p.lift + 16, -length / 2, length / 2, 0xe4ebf0);
    // Orange marker poles down both edges of the run.
    for (let v = -length / 2 + 30; v < length / 2; v += 60) {
      for (const u of [-prop.w / 2 + 3, prop.w / 2 - LIFT_INSET * 2 + 3]) {
        const at = this.local(prop, u, v);
        this.chunks.add(this.scene.add.rectangle(at.x, at.y, 4, 4, 0xf26b1d), this.depths.props);
      }
    }
    // Stations at the bottom and the top, towers between, and the cable.
    for (const v of [-length / 2 + 30, length / 2 - 30]) {
      const at = this.local(prop, p.lift - 10, v);
      this.chunks.add(this.scene.add.image(at.x, at.y, DECO_TEXTURE, 'lift-station').setRotation(prop.angle + Math.PI / 2).setScale(0.8), this.depths.props);
    }
    const cable = new ChunkedGraphics(this.scene, this.chunks, this.depths.overhead - 0.3);
    for (const side of [8, -8]) {
      cable.fillStyle(0x2b2d31, 0.8);
      for (let v = -length / 2 + 40; v < length / 2 - 40; v += 4) {
        const at = this.local(prop, p.lift + side, v);
        cable.fillRect(at.x - 0.8, at.y - 0.8, 1.6, 1.6);
      }
    }
    for (let v = -length / 2 + 140; v < length / 2 - 100; v += 170) {
      const at = this.local(prop, p.lift, v);
      this.chunks.add(this.scene.add.image(at.x, at.y, DECO_TEXTURE, 'lift-tower').setRotation(prop.angle), this.depths.overhead - 0.28);
    }
    for (let s = rand.frac() * CHAIR_GAP; s < length * 2; s += CHAIR_GAP) {
      const image = this.scene.add.image(0, 0, DECO_TEXTURE, 'liftchair-0').setRotation(prop.angle).setDepth(this.depths.overhead - 0.27);
      p.chairs.push({ image, s });
    }
    this.pistes.push(p);
    // People coming down.
    for (let k = rand.between(4, 7); k > 0; k--) {
      const boarder = rand.frac() < 0.4;
      const look = `${boarder ? 'boarder' : 'skier'}-${rand.between(0, WINTER_VARIANTS.people - 1)}`;
      const image = this.scene.add.image(0, 0, DECO_TEXTURE, `${look}-l`).setScale(SKIER_SCALE).setDepth(this.depths.props + 0.03);
      this.skiers.push({
        piste: p,
        image,
        look,
        d: rand.frac() * length,
        speed: rand.realInRange(70, 130),
        phase: rand.frac() * Math.PI * 2,
        swing: rand.realInRange(0.4, 0.85),
        riding: 0,
      });
    }
  }

  private updateSkier(s: Skier, dt: number, spray: boolean, near: (x: number, y: number, m: number) => boolean): void {
    const p = s.piste;
    if (s.riding > 0) {
      // Up on the lift: out of sight until they reach the top.
      s.riding -= dt;
      s.image.setVisible(false);
      if (s.riding <= 0) s.d = 0;
      return;
    }
    s.d += s.speed * dt;
    const bottom = p.length - 60;
    if (s.d >= bottom) {
      s.riding = (p.length / LIFT_SPEED) * Phaser.Math.Clamp(0.5 + Math.random() * 0.3, 0, 1);
      return;
    }
    // Long turns from one side of the run to the other.
    s.phase += (s.speed / 90) * dt;
    const u = p.middle + Math.sin(s.phase) * p.run * s.swing;
    const v = p.length / 2 - 40 - s.d;
    const at = this.local(p.prop, u, v);
    const show = near(at.x, at.y, 40);
    if (s.image.visible !== show) s.image.setVisible(show);
    if (!show) return;
    // Facing down the slope (towards the road), turned into each turn.
    const du = Math.cos(s.phase) * p.run * s.swing * (s.speed / 90);
    const heading = p.prop.angle + Math.atan2(-s.speed, du);
    s.image.setPosition(at.x, at.y).setRotation(heading);
    setFrame(s.image, `${s.look}-${du > 0 ? 'r' : 'l'}`);
    if (spray && Math.abs(Math.cos(s.phase)) < 0.35) this.spray.emitParticleAt(at.x, at.y, 1);
  }

  /** A cluster of snow-capped rocks. */
  private addBoulders(prop: Prop): void {
    const rand = new Phaser.Math.RandomDataGenerator([`${prop.variant}`]);
    for (let k = rand.between(2, 5); k > 0; k--) {
      const size = rand.realInRange(0.3, 0.55) * prop.w;
      const a = rand.frac() * Math.PI * 2;
      const r = rand.frac() * (prop.w / 2 - size / 2);
      const x = prop.x + Math.cos(a) * r;
      const y = prop.y + Math.sin(a) * r;
      const frame = `snowrock-${rand.between(0, WINTER_VARIANTS.rock - 1)}`;
      const angle = rand.frac() * Math.PI * 2;
      const s = this.scene.add.image(x + SHADOW_DIR.x * 6, y + SHADOW_DIR.y * 6, DECO_TEXTURE, frame).setDisplaySize(size, size).setRotation(angle).setTint(0x3a5068).setAlpha(0.3);
      this.chunks.add(s, this.depths.shadows);
      this.chunks.add(this.scene.add.image(x, y, DECO_TEXTURE, frame).setDisplaySize(size, size).setRotation(angle), this.depths.props);
    }
  }

  // --- Snowmen ---------------------------------------------------------------

  private addSnowmen(prop: Prop): void {
    const rand = new Phaser.Math.RandomDataGenerator([`${prop.variant}`]);
    for (let k = rand.between(2, 3); k > 0; k--) {
      const at = this.local(prop, rand.realInRange(-0.35, 0.35) * prop.w, rand.realInRange(-0.3, 0.3) * prop.h);
      const s = this.scene.add.image(at.x + SHADOW_DIR.x * 4, at.y + SHADOW_DIR.y * 4, DECO_TEXTURE, 'snowman').setScale(1.6).setTint(0x000000).setAlpha(0.2);
      this.chunks.add(s, this.depths.shadows);
      this.chunks.add(this.scene.add.image(at.x, at.y, DECO_TEXTURE, 'snowman').setScale(1.6).setRotation(rand.angle() * (Math.PI / 180)), this.depths.props);
    }
  }

  /** A point on a prop, `u` px along it and `v` px back from its centre. */
  private local(prop: Prop, u: number, v: number): Vec2 {
    const c = Math.cos(prop.angle);
    const s = Math.sin(prop.angle);
    return { x: prop.x + c * u - s * v, y: prop.y + s * u + c * v };
  }
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
