import * as Phaser from 'phaser';
import { CAR_LENGTH, type CarState } from '../car/CarPhysics';
import type { CarAudio } from '../audio/CarAudio';
import { type CircleGrid, type SegmentGrid, nearestOnSegment } from '../physics/collisions';
import {
  BENCH_SMASH,
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
  gapFor,
  giveWay,
  impactSpeed,
  treeToughness,
} from '../world/damage';
import type { Perspective } from '../world/perspective';
import type { LooseProp, Post, Wall } from '../world/world';
import { ART_SCALE, TEX } from './art';
import type { CarEffects } from './CarEffects';

/** How long a broken light's wires go on sparking, seconds. */
const SPARKING = 5;

export interface WreckageHooks {
  /** The height of the ground under a point, px. */
  groundAt(x: number, y: number): number;
  /** Puts a piece of something broken into the world, loose, on a level. */
  addDebris(d: Debris, level: number): void;
  /** Takes away what showed a post (a tree's crown, a lamp, a traffic light's head) once it's down. */
  knockedDown(post: Post): void;
  /** Moves a fallen tree's crown to where it fell, lying on the ground. */
  treeFell(index: number, x: number, y: number, angle: number): void;
  /** The height of a tree, px. */
  treeHeight(index: number): number;
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
  private nextSpark = 0;
  private readonly rand = Phaser.Math.RND;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly walls: [SegmentGrid, SegmentGrid],
    private readonly posts: [CircleGrid, CircleGrid],
    private readonly effects: CarEffects,
    private readonly hooks: WreckageHooks,
    private readonly depth: number,
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
      if (!wall.kind) continue;
      const [px, py] = nearestOnSegment(car.x, car.y, wall);
      const speed = impactSpeed(car, px, py, wall.r + 1);
      const tough = WALLS[wall.kind];
      if (speed > 0 && breaks(tough, speed, weight)) this.breakWall(wall, px, py, car, speed, level);
    }
  }

  /** Whether a bench the car's going into this fast smashes (and if so, smashes it). */
  smash(body: LooseProp, car: CarState, speed: number): boolean {
    if (body.kind !== 'bench' || speed * this.hooks.weight() < BENCH_SMASH) return false;
    body.gone = true;
    for (const d of debris('plank', 5, body.x, body.y, car.vx, car.vy, this.rand.frac.bind(this.rand), 10)) this.hooks.addDebris(d, body.level);
    this.effects.burst('timber', body.x, body.y, 10);
    this.hooks.audio()?.shatter('timber', speed);
    giveWay(car, { material: 'timber', strength: BENCH_SMASH, absorb: 0.12 });
    return true;
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
      // It splits at the foot and goes over the way it was hit: a stump, and the trunk lying in the way.
      const height = this.hooks.treeHeight(post.index);
      const fall = fallenTree(post.x, post.y, height, car.vx, car.vy, car.x, car.y);
      this.walls[0].add({ ...fall.trunk, level: 0 } as Wall);
      // The stump's low enough to drive over: it's just drawn.
      this.addWreck(TEX.stump, post.x, post.y, z, 0, 1);
      const length = Math.hypot(fall.trunk.bx - fall.trunk.ax, fall.trunk.by - fall.trunk.ay);
      const image = this.addWreck(TEX.trunk, (fall.trunk.ax + fall.trunk.bx) / 2, (fall.trunk.ay + fall.trunk.by) / 2, z, fall.angle, 1);
      image.setDisplaySize(length, 7);
      this.hooks.treeFell(post.index, fall.crownX, fall.crownY, fall.angle);
      // Its crown hits the ground: leaves flying, and clumps of them and broken branches strewn about it, more the bigger it is.
      const metres = height / 8;
      const spread = Math.min(length * 1.2, 90);
      const [vx, vy] = [car.vx * 0.3, car.vy * 0.3];
      for (const d of debris('foliage', Math.round(Math.min(16, 4 + metres)), fall.crownX, fall.crownY, vx, vy, rand, spread)) this.hooks.addDebris(d, 0);
      for (const d of debris('twig', Math.round(Math.min(8, 2 + metres / 2)), fall.crownX, fall.crownY, vx, vy, rand, spread)) this.hooks.addDebris(d, 0);
      this.effects.burst('plant', fall.crownX, fall.crownY, 30);
    } else if (post.thing !== 'fountain' && post.thing !== 'stump') {
      for (const d of fallen(post.thing, post.x, post.y, car.vx, car.vy, rand)) this.hooks.addDebris(d, level);
      for (const d of shards(post.thing, post.x, post.y, car.vx, car.vy, rand)) this.hooks.addDebris(d, level);
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
    // What it breaks into: a stone wall into rubble and bricks, a hedge into clumps of leaves and twigs, a fence into planks, a railing into bent bars.
    const pieces: [Parameters<typeof debris>[0], number][] =
      kind === 'wall'
        ? [['rubble', Math.round(gap / 5)], ['brick', Math.round(gap / 8)]]
        : kind === 'hedge'
          ? [['foliage', Math.round(gap / 4)], ['twig', Math.round(gap / 8)]]
          : kind === 'fence'
            ? [['plank', Math.round(gap / 7)]]
            : [['rail', Math.max(1, Math.round(gap / 16))]];
    for (const [piece, count] of pieces) for (const d of debris(piece, Math.min(count, 10), mx, my, car.vx, car.vy, rand, gap / 2)) this.hooks.addDebris(d, level);
    this.effects.burst(material, mx, my, kind === 'hedge' ? 30 : 18);
    this.hooks.audio()?.shatter(material, speed);
    giveWay(car, WALLS[kind]);
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
