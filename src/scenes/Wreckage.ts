import * as Phaser from 'phaser';
import { CAR_LENGTH, type CarState } from '../car/CarPhysics';
import type { CarAudio } from '../audio/CarAudio';
import { type CircleGrid, type SegmentGrid, nearestOnSegment } from '../physics/collisions';
import {
  BREAKUP,
  CROWN_BREAK,
  type Debris,
  type Material,
  THINGS,
  type Toughness,
  WALLS,
  breaks,
  crumble,
  debris,
  fallen,
  fallenTree,
  shards,
  TOPPLE,
  toppleTime,
  gapFor,
  giveWay,
  impactSpeed,
  logs,
  lyingTrunk,
  treeToughness,
} from '../world/damage';
import type { Perspective } from '../world/perspective';
import type { LooseProp, Post, Wall } from '../world/world';
import { ART_SCALE, TEX } from './art';
import type { CarEffects } from './CarEffects';

/** How long what's just broken off can't be broken again, seconds. */
const FRESH = 0.5;
/** What's got glass in it, to smash as it lands. */
const GLASSY = new Set(['lamp', 'signal', 'beacon', 'phone', 'meter', 'pump', 'clock']);
/** How long a broken light's wires go on sparking, seconds. */
const SPARKING = 5;
/** How high a fallen tree's crown lies, px (as its treetop: the crown's drawn a little below), and the top of anything else. */
const LYING = 2 * 8;
const LYING_LOW = 0.5 * 8;

/** Something going over: it leans slowly at first, then faster and faster till it hits the ground. */
interface Toppling {
  x: number;
  y: number;
  z: number;
  /** Its height standing, and its top's lying, px. */
  height: number;
  lying: number;
  /** Which way it falls, and how far from its foot its top ends up, px. */
  angle: number;
  reach: number;
  /** Its trunk or pole, if it has one, and how thick it's drawn, px; and its top (a lamp, a light's head), drawn up where it is. */
  pole?: { image: Phaser.GameObjects.Image; width: number; at: number };
  top?: Phaser.GameObjects.Image;
  /** Told where its top is each frame (a tree's crown is drawn by the scene). */
  move?: (x: number, y: number, h: number) => void;
  /** When it started going over, and how long it takes to come down, seconds. */
  start: number;
  time: number;
  /** What happens when it hits the ground. */
  land: () => void;
}

export interface WreckageHooks {
  /** The height of the ground under a point, px. */
  groundAt(x: number, y: number): number;
  /** Puts a piece of something broken into the world, loose, on a level. */
  addDebris(d: Debris, level: number): void;
  /** Takes away what showed a post (a tree's crown, a lamp, a traffic light's head) once it's down. */
  knockedDown(post: Post): void;
  /** Moves a falling tree's crown: over (x, y), its treetop `h` px up (the crown's a little below it); and, once it's down, lying at `angle`. */
  treeFell(index: number, x: number, y: number, h: number, angle?: number): void;
  /** The height of a tree, px, and its crown's radius. */
  treeHeight(index: number): number;
  treeRadius(index: number): number;
  /** Takes away a fallen tree's crown, torn apart. */
  crownGone(index: number): void;
  audio(): CarAudio | null;
  /** The vehicle's weight (a car's is 1). */
  weight(): number;
}

/**
 * Breaking things: what the car hits and whether it gives way, by what it's
 * made of and how hard it's hit. What's broken stays broken, where it fell:
 * stumps and trunks of trees, rubble, planks, bent poles. All of it is in the
 * world's walls, posts and loose things, so it's in the way of whatever comes
 * along next.
 */
export class Wreckage {
  /** Stumps and fallen trunks, drawn on the ground. */
  private readonly wrecks: { x: number; y: number; z: number; image: Phaser.GameObjects.Image }[] = [];
  /** Where broken lights are still sparking, and till when (seconds). */
  private readonly sparking: { x: number; y: number; until: number }[] = [];
  /** Fallen trees' trunks, lying in the way: how hard they are to break up, and how they're drawn. */
  private readonly trunks = new Map<Wall, { tough: Toughness; image: Phaser.GameObjects.Image }>();
  /** Fallen trees' crowns, lying on the ground, till they're driven through. */
  private readonly crowns: { index: number; x: number; y: number; r: number; height: number }[] = [];
  /** Things on their way down. */
  private readonly falling: Toppling[] = [];
  private nextSpark = 0;
  private readonly rand = Phaser.Math.RND;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly walls: [SegmentGrid, SegmentGrid],
    private readonly posts: [CircleGrid, CircleGrid],
    private readonly effects: CarEffects,
    private readonly hooks: WreckageHooks,
    private readonly depth: number,
    /** What's drawn up high (a falling lamp, a light's head). */
    private readonly aboveDepth: number,
  ) {}

  /**
   * Call each physics step, after the car's moved and before it's bounced
   * off what it's hit: whatever the car's going into hard enough gives way
   * (and so isn't there to bounce off).
   */
  hit(car: CarState, level: number): void {
    const weight = this.hooks.weight();
    for (const post of this.posts[level].near(car.x, car.y, CAR_LENGTH) as Post[]) {
      const tough = this.toughness(post);
      const speed = impactSpeed(car, post.x, post.y, post.r + 1);
      if (speed > 0 && breaks(tough, speed, weight)) this.knockDown(post, car, tough, speed, level);
    }
    // A copy: knocking a wall down changes what the grid holds.
    for (const wall of [...(this.walls[level].near(car.x, car.y, CAR_LENGTH) as Wall[])]) {
      const trunk = this.trunks.get(wall);
      if (!wall.kind && !trunk) continue;
      const [px, py] = nearestOnSegment(car.x, car.y, wall);
      const speed = impactSpeed(car, px, py, wall.r + 1);
      if (trunk) {
        if (speed > 0 && breaks(trunk.tough, speed, weight)) this.splitTrunk(wall, trunk, car, speed);
        continue;
      }
      if (!wall.kind) continue;
      const tough = WALLS[wall.kind];
      if (speed > 0 && breaks(tough, speed, weight)) this.breakWall(wall, px, py, car, speed, level);
    }
    if (level !== 0) return;
    // Driving through a fallen tree's crown tears it apart.
    const fast = Math.hypot(car.vx, car.vy) * weight > CROWN_BREAK;
    for (let i = this.crowns.length - 1; i >= 0 && fast; i--) {
      const c = this.crowns[i];
      if (Math.hypot(car.x - c.x, car.y - c.y) > c.r * 0.7) continue;
      this.crowns.splice(i, 1);
      this.tearCrown(c, car);
    }
  }

  /**
   * Whether a loose thing the car's going into this fast breaks up (and if so,
   * breaks it up): a bench, or a piece of something already broken, into
   * smaller pieces.
   */
  smash(body: LooseProp, car: CarState, speed: number): boolean {
    const b = BREAKUP[body.kind as keyof typeof BREAKUP];
    if (!b || !breaks(b, speed, this.hooks.weight())) return false;
    // Not what's only just broken off, in front of the car that broke it: it'd break up again at once.
    if (body.born !== undefined && this.scene.time.now / 1000 - body.born < FRESH) return false;
    body.gone = true;
    const rand = this.rand.frac.bind(this.rand);
    const size = body.r + (body.length ?? 0) / 2;
    for (const [kind, count] of b.into) for (const d of debris(kind, count, body.x, body.y, car.vx, car.vy, rand, size)) this.hooks.addDebris(d, body.level);
    this.effects.burst(b.material, body.x, body.y, Math.round(4 + size));
    this.hooks.audio()?.shatter(b.material, speed);
    giveWay(car, b);
    return true;
  }

  /** A fallen trunk hit hard enough: split into logs where it lay. */
  private splitTrunk(wall: Wall, trunk: { tough: Toughness; image: Phaser.GameObjects.Image }, car: CarState, speed: number): void {
    wall.gone = true;
    this.trunks.delete(wall);
    const at = this.wrecks.findIndex((w) => w.image === trunk.image);
    if (at >= 0) this.wrecks.splice(at, 1);
    trunk.image.destroy();
    const rand = this.rand.frac.bind(this.rand);
    for (const d of logs(wall, car.vx, car.vy, rand)) this.hooks.addDebris(d, 0);
    const [mx, my] = nearestOnSegment(car.x, car.y, wall);
    this.effects.burst('wood', mx, my, 16);
    this.hooks.audio()?.shatter('wood', speed);
    giveWay(car, trunk.tough);
  }

  /** A fallen crown driven through: torn apart into clumps of leaves and branches, strewn the way the car went. */
  private tearCrown(c: { index: number; x: number; y: number; r: number; height: number }, car: CarState): void {
    this.hooks.crownGone(c.index);
    const rand = this.rand.frac.bind(this.rand);
    const metres = c.height / 8;
    for (const d of debris('foliage', Math.round(Math.min(18, 6 + metres)), c.x, c.y, car.vx * 0.6, car.vy * 0.6, rand, c.r * 1.4)) this.hooks.addDebris(d, 0);
    for (const d of debris('twig', Math.round(Math.min(10, 3 + metres / 2)), c.x, c.y, car.vx * 0.6, car.vy * 0.6, rand, c.r * 1.4)) this.hooks.addDebris(d, 0);
    this.effects.burst('plant', car.x, car.y, 36);
    this.hooks.audio()?.shatter('plant', Math.hypot(car.vx, car.vy));
    giveWay(car, { material: 'plant', strength: CROWN_BREAK, absorb: 0.15 });
  }

  private toughness(post: Post): Toughness {
    if (post.thing === 'tree') return treeToughness(this.hooks.treeHeight(post.index) / 8);
    return THINGS[post.thing];
  }

  private knockDown(post: Post, car: CarState, tough: Toughness, speed: number, level: number): void {
    post.gone = true;
    this.hooks.knockedDown(post);
    const rand = this.rand.frac.bind(this.rand);
    const z = this.hooks.groundAt(post.x, post.y);
    if (post.thing === 'tree') {
      // It splits at the foot and goes over the way it was hit, leaving a stump; the rest comes down over a second or so.
      const height = this.hooks.treeHeight(post.index);
      const radius = this.hooks.treeRadius(post.index);
      const fall = fallenTree(post.x, post.y, height, car.vx, car.vy, car.x, car.y);
      // The stump's low enough to drive over: it's just drawn.
      this.addWreck(TEX.stump, post.x, post.y, z, 0, 1);
      const [vx, vy] = [car.vx, car.vy];
      this.topple({
        x: post.x,
        y: post.y,
        z,
        height,
        lying: LYING,
        angle: fall.angle,
        reach: Math.hypot(fall.crownX - post.x, fall.crownY - post.y),
        pole: { image: this.scene.add.image(post.x, post.y, TEX.trunk).setDepth(this.depth), width: 7, at: 0.85 },
        move: (x, y, h) => this.hooks.treeFell(post.index, x, y, h),
        land: () => this.treeLanded(post.index, fall, z, height, radius, tough, vx, vy),
      });
    } else if (post.thing !== 'fountain' && post.thing !== 'stump' && post.thing !== 'statue' && post.thing !== 'crane') {
      // It snaps or bends at its foot and goes over the way it was hit; its pieces and glass land where it does.
      const thing = post.thing;
      const look = TOPPLE[thing];
      const [x, y, vx, vy] = [post.x, post.y, car.vx, car.vy];
      const angle = Math.atan2(vy, vx);
      const texture = thing === 'signal' ? TEX.light('off') : thing === 'beacon' ? TEX.beacon(false) : TEX.prop(thing);
      const top = this.scene.add.image(x, y, texture).setScale(thing === 'signal' || thing === 'beacon' ? 1.3 / ART_SCALE : 1 / ART_SCALE).setRotation(angle).setDepth(this.aboveDepth);
      this.topple({
        x,
        y,
        z,
        height: look.height,
        lying: LYING_LOW,
        angle,
        reach: look.reach,
        pole: look.pole ? { image: this.scene.add.image(x, y, TEX.pole).setDepth(this.depth), width: 1.6, at: 1 } : undefined,
        top,
        land: () => {
          for (const d of fallen(thing, x, y, vx, vy, rand)) this.hooks.addDebris(d, level);
          for (const d of shards(thing, x, y, vx, vy, rand)) this.hooks.addDebris(d, level);
          const [ex, ey] = [x + Math.cos(angle) * look.reach, y + Math.sin(angle) * look.reach];
          this.effects.burst(GLASSY.has(thing) ? 'glass' : 'stone', ex, ey, 8);
          this.hooks.audio()?.shatter(GLASSY.has(thing) ? 'glass' : 'metal', 80 + look.height * 3);
        },
      });
      if (tough.material === 'electric') this.sparking.push({ x: post.x, y: post.y, until: this.scene.time.now / 1000 + SPARKING });
    }
    this.effects.burst(tough.material, post.x, post.y, tough.material === 'wood' ? 24 : 14);
    this.hooks.audio()?.shatter(tough.material, speed);
    giveWay(car, tough);
  }

  private breakWall(wall: Wall, x: number, y: number, car: CarState, speed: number, level: number): void {
    const kind = wall.kind!;
    const { left, from, to } = crumble(wall, x, y, gapFor(kind, speed, this.hooks.weight()));
    wall.gone = true;
    for (const piece of left) this.walls[level].add(piece as Wall);
    const rand = this.rand.frac.bind(this.rand);
    const [mx, my] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    const gap = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const material: Material = WALLS[kind].material;
    // What it breaks into: a stone wall into rubble and bricks, a hedge into clumps of leaves and twigs, a fence into planks,
    // a railing or a gate into bent bars, a car park's barrier into bits of its arm.
    const pieces: [Parameters<typeof debris>[0], number][] =
      kind === 'wall'
        ? [['rubble', Math.round(gap / 5)], ['brick', Math.round(gap / 8)]]
        : kind === 'hedge'
          ? [['foliage', Math.round(gap / 4)], ['twig', Math.round(gap / 8)]]
          : kind === 'fence'
            ? [['plank', Math.round(gap / 7)]]
            : kind === 'liftgate'
              ? [['arm', Math.max(1, Math.round(gap / 20))]]
              : kind === 'shelter'
                ? [['glass', 14], ['rail', 3]]
              : [['rail', Math.max(1, Math.round(gap / 16))]];
    for (const [piece, count] of pieces) for (const d of debris(piece, Math.min(count, 10), mx, my, car.vx, car.vy, rand, gap / 2)) this.hooks.addDebris(d, level);
    this.effects.burst(material, mx, my, kind === 'hedge' ? 30 : 18);
    this.hooks.audio()?.shatter(material, speed);
    giveWay(car, WALLS[kind]);
  }

  /** Starts something toppling over. */
  private topple(t: Omit<Toppling, 'start' | 'time'>): void {
    this.falling.push({ ...t, start: this.scene.time.now / 1000, time: toppleTime(t.height / 8) });
  }

  /** Moves the things coming down; when one hits the ground, what happens then. */
  private updateFalling(perspective: Perspective, now: number): void {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      const t = Math.min(1, (now - f.start) / f.time);
      // Toppling: slow to start, faster and faster (as near enough a falling pole does).
      const lean = (Math.PI / 2) * t * t;
      const out = f.reach * Math.sin(lean);
      const h = f.lying + (f.height - f.lying) * Math.cos(lean);
      const [cx, cy] = [f.x + Math.cos(f.angle) * out, f.y + Math.sin(f.angle) * out];
      f.move?.(cx, cy, h);
      const s1 = perspective.lift(f.z + h);
      const [tx, ty] = [perspective.x(cx, s1), perspective.y(cy, s1)];
      f.top?.setPosition(tx, ty);
      if (f.pole) {
        // From its foot up to its top, as it is now, in perspective.
        const s0 = perspective.lift(f.z);
        const sp = perspective.lift(f.z + h * f.pole.at);
        const [ax, ay] = [perspective.x(f.x, s0), perspective.y(f.y, s0)];
        const [bx, by] = [perspective.x(cx, sp), perspective.y(cy, sp)];
        f.pole.image
          .setPosition((ax + bx) / 2, (ay + by) / 2)
          .setRotation(Math.atan2(by - ay, bx - ax))
          .setDisplaySize(Math.max(1, Math.hypot(bx - ax, by - ay)), f.pole.width);
      }
      if (t < 1) continue;
      // Down.
      this.falling.splice(i, 1);
      f.pole?.image.destroy();
      f.top?.destroy();
      f.land();
    }
  }

  /** A tree's down: its trunk's in the way, and its leaves and branches fly. */
  private treeLanded(index: number, fall: ReturnType<typeof fallenTree>, z: number, height: number, radius: number, standing: Toughness, vx: number, vy: number): void {
    const wall = { ...fall.trunk, level: 0 } as Wall;
    this.walls[0].add(wall);
    const length = Math.hypot(fall.trunk.bx - fall.trunk.ax, fall.trunk.by - fall.trunk.ay);
    const image = this.addWreck(TEX.trunk, (fall.trunk.ax + fall.trunk.bx) / 2, (fall.trunk.ay + fall.trunk.by) / 2, z, fall.angle, 1);
    image.setDisplaySize(length, 7);
    // Lying there, it'll break up far more easily than it came down.
    this.trunks.set(wall, { tough: lyingTrunk(standing), image });
    this.crowns.push({ index, x: fall.crownX, y: fall.crownY, r: radius, height });
    this.hooks.treeFell(index, fall.crownX, fall.crownY, LYING, fall.angle);
    // Its crown hits the ground: leaves flying, and clumps of them and broken branches strewn about it, more the bigger it is.
    const metres = height / 8;
    const spread = Math.min(length * 1.2, 90);
    const rand = this.rand.frac.bind(this.rand);
    for (const d of debris('foliage', Math.round(Math.min(16, 4 + metres)), fall.crownX, fall.crownY, vx * 0.3, vy * 0.3, rand, spread)) this.hooks.addDebris(d, 0);
    for (const d of debris('twig', Math.round(Math.min(8, 2 + metres / 2)), fall.crownX, fall.crownY, vx * 0.3, vy * 0.3, rand, spread)) this.hooks.addDebris(d, 0);
    this.effects.burst('plant', fall.crownX, fall.crownY, 30);
    this.effects.burst('wood', (fall.trunk.ax + fall.trunk.bx) / 2, (fall.trunk.ay + fall.trunk.by) / 2, 10);
    this.hooks.audio()?.shatter('plant', 120 + metres * 20);
  }

  private addWreck(texture: string, x: number, y: number, z: number, angle: number, scale: number): Phaser.GameObjects.Image {
    const image = this.scene.add.image(x, y, texture).setScale(scale / ART_SCALE).setRotation(angle).setDepth(this.depth);
    this.wrecks.push({ x, y, z, image });
    return image;
  }

  /** Call once a frame: the wrecks on the hills, and the broken lights sparking. */
  update(view: Phaser.Geom.Rectangle, perspective: Perspective): void {
    const pad = 120;
    for (const w of this.wrecks) {
      const show = w.x > view.left - pad && w.x < view.right + pad && w.y > view.top - pad && w.y < view.bottom + pad;
      if (w.image.visible !== show) w.image.setVisible(show);
      if (!show) continue;
      const s = perspective.lift(w.z);
      w.image.setPosition(perspective.x(w.x, s), perspective.y(w.y, s));
    }
    const now = this.scene.time.now / 1000;
    this.updateFalling(perspective, now);
    if (now < this.nextSpark) return;
    this.nextSpark = now + 0.15;
    for (let i = this.sparking.length - 1; i >= 0; i--) {
      const s = this.sparking[i];
      if (now > s.until) {
        this.sparking.splice(i, 1);
        continue;
      }
      if (Math.random() < 0.5) continue;
      this.effects.sparksAt(s.x, s.y, 60 + Math.random() * 80);
      if (Math.abs(s.x - view.centerX) < view.width && Math.abs(s.y - view.centerY) < view.height) this.hooks.audio()?.fizz();
    }
  }
}
