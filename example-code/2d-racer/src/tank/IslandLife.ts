import * as Phaser from 'phaser';
import { TEX } from '../scenes/textures';
import { LIFE_VARIANTS, TANK_TEXTURE } from './art';
import { BIOME, type Island, type Lift, biomeAt, heightAt } from './island';
import { type Agent, type AgentKind, type Ground, groundFor, populate, settle, stepAgent } from './life';
import type { Thing, World } from './world';

/** Which way the wind blows (waves, smoke and leaves go with it), and its strength, px/s. */
export const WIND = { x: 14, y: 6 };
/** Waves on the water at once, and how long each lasts, s. */
const WAVES = 34;
/** Only those this close to the view are moved (the rest wait where they are), px. */
const AWAKE = 700;
const SHADOW = { x: 0.62, y: 0.78 };

interface Wave {
  image: Phaser.GameObjects.Image;
  age: number;
  life: number;
  vx: number;
  vy: number;
  peak: number;
}

/** A ski lift: its chairs going round, and the skiers riding up and skiing down. */
interface SkiLift {
  lift: Lift;
  dir: number;
  length: number;
  /** Across the lift, towards its piste. */
  nx: number;
  ny: number;
  /** Its pylons and stations: if one's brought down, the lift's stopped for good. */
  holds: Thing[];
  running: boolean;
  cable: Phaser.GameObjects.Graphics;
  chairs: { s: number; image: Phaser.GameObjects.Image; riders: Skier[] }[];
  skiers: Skier[];
}

interface Skier {
  image: Phaser.GameObjects.Image;
  /** Skiing down (`p` from 0 at the top to 1 at the bottom), waiting at the bottom for a chair, or riding one up. */
  state: 'down' | 'wait' | 'ride';
  p: number;
  /** How wide, and where in, their turns. */
  swing: number;
  phase: number;
  speed: number;
}

/** Chairlift speed, px/s, and the gap between chairs, px. */
const LIFT = { speed: 45, gap: 70 };

interface Bird {
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  phase: number;
}

/**
 * The island's life: people and animals going about (see life.ts), waves
 * rolling over the sea and breaking on the beaches, flocks of birds flying
 * over (and bursting out of the trees when something goes off), smoke from
 * the chimneys, and leaves blown off the trees.
 */
export class IslandLife {
  private readonly agents: Agent[];
  private readonly sprites = new Map<Agent, Phaser.GameObjects.Image>();
  private readonly grounds: Record<AgentKind, Ground>;
  private readonly waves: Wave[] = [];
  private readonly birds: Bird[] = [];
  private readonly chimneys: Thing[];
  private readonly campfires: Thing[];
  /** The harbour cranes, each with its jib and the container it's moving (made once it's first in view). */
  private readonly cranes: { crane: Thing; jib: Phaser.GameObjects.Image | null; cargo: Phaser.GameObjects.Image | null; phase: number; side: number }[];
  private readonly lifts: SkiLift[];
  /** Kayakers paddling down the rivers (each starts again upstream once it's reached the sea). */
  private readonly kayaks: { river: number; at: number; across: number; look: number; image: Phaser.GameObjects.Image | null }[] = [];
  private readonly flames: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly leaves: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly rand: () => number;
  private nextFlock = 4;
  private smokeDue = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly island: Island,
    private readonly world: World,
    private readonly depths: { life: number; water: number; sky: number; shadows: number; smoke: number; fire: number; lift: number },
    rand: () => number,
  ) {
    this.rand = rand;
    const kinds: AgentKind[] = ['person', 'hiker', 'swimmer', 'sheep', 'cow', 'deer', 'hen'];
    this.grounds = Object.fromEntries(kinds.map((k) => [k, groundFor(island, world, k)])) as Record<AgentKind, Ground>;
    this.agents = settle(populate(island, rand), (k) => this.grounds[k], rand);
    // Some of the houses have a fire lit.
    this.chimneys = world.things.filter((t) => t.kind === 'house' && t.variant % 3 !== 0);
    this.smoke = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: 2400,
        speedX: { min: WIND.x * 0.6, max: WIND.x * 1.6 },
        speedY: { min: WIND.y * 0.4 - 8, max: WIND.y * 1.4 },
        scale: { start: 0.25, end: 1.3 },
        alpha: { start: 0.35, end: 0 },
        tint: 0xd8d8d8,
        emitting: false,
      })
      .setDepth(depths.smoke);
    this.leaves = scene.add
      .particles(0, 0, TANK_TEXTURE, {
        frame: 'leaf',
        lifespan: 3500,
        speedX: { min: WIND.x * 1.5, max: WIND.x * 4 },
        speedY: { min: -6, max: WIND.y * 3 },
        rotate: { start: 0, end: 540 },
        alpha: { start: 1, end: 0 },
        emitting: false,
      })
      .setDepth(depths.sky - 0.1);
    this.campfires = world.things.filter((t) => t.kind === 'campfire');
    this.cranes = world.things
      .filter((t) => t.kind === 'crane')
      .map((crane, k) => ({ crane, jib: null, cargo: null, phase: (crane.variant % 100) / 100, side: k % 2 ? 1 : -1 }));
    this.flames = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: { min: 250, max: 500 },
        speedX: { min: -6, max: 6 },
        speedY: { min: -22, max: -6 },
        scale: { start: 0.3, end: 0.05 },
        alpha: { start: 0.9, end: 0 },
        tint: [0xffe066, 0xffa21a, 0xff5a1a],
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(depths.fire);
    this.lifts = island.lifts.map((lift) => this.makeLift(lift));
    island.rivers.forEach((river, k) => {
      if (river.path.length < 40) return;
      for (let n = 0, count = 1 + Math.floor(rand() * 2); n < count; n++) {
        this.kayaks.push({ river: k, at: 0, across: 0, look: Math.floor(rand() * 1000), image: null });
        this.launch(this.kayaks[this.kayaks.length - 1]);
      }
    });
  }

  /** `blasts`: explosions (and the tank firing) this frame, which scare everyone near. */
  update(time: number, dt: number, view: Phaser.Geom.Rectangle, tank: { x: number; y: number }, blasts: { x: number; y: number }[]): void {
    const awake = (x: number, y: number, m: number) => x > view.left - m && x < view.right + m && y > view.top - m && y < view.bottom + m;
    for (const a of this.agents) {
      let sprite = this.sprites.get(a);
      if (!awake(a.x, a.y, AWAKE)) {
        if (sprite?.visible) sprite.setVisible(false);
        continue;
      }
      // (Only made once they're first near the view: there are thousands of them.)
      if (!sprite) {
        sprite = this.makeSprite(a);
        this.sprites.set(a, sprite);
      }
      stepAgent(a, dt, this.grounds[a.kind], tank, blasts, this.rand);
      const show = awake(a.x, a.y, 30);
      if (sprite.visible !== show) sprite.setVisible(show);
      if (show) this.draw(a, sprite, time);
    }
    this.updateWaves(dt, view);
    this.updateBirds(time, dt, view);
    this.smokeDue -= dt;
    if (this.smokeDue <= 0) {
      this.smokeDue = 0.35;
      for (const c of this.chimneys) if (c.phase === 'intact' && awake(c.x, c.y, 100)) this.smoke.emitParticleAt(c.x + 10, c.y - 6, 1);
      for (const c of this.campfires) if (c.phase === 'intact' && awake(c.x, c.y, 100)) this.smoke.emitParticleAt(c.x, c.y - 4, 1);
    }
    // The campfires' flames.
    for (const c of this.campfires) {
      if (c.phase === 'intact' && awake(c.x, c.y, 40) && this.rand() < dt * 20) this.flames.emitParticleAt(c.x + (this.rand() - 0.5) * 6, c.y + (this.rand() - 0.5) * 6, 1);
    }
    for (const lift of this.lifts) this.updateLift(lift, dt, view);
    for (const k of this.kayaks) this.updateKayak(k, time, dt, (x, y) => awake(x, y, 150), tank);
    for (const c of this.cranes) this.updateCrane(c, time, awake(c.crane.x, c.crane.y, 200));
    for (const b of blasts) this.startle(b);
  }

  /** Leaves blown off a tree. */
  leaf(x: number, y: number): void {
    this.leaves.emitParticleAt(x, y, 1);
  }

  /** Someone jumping out of a vehicle that's been hit, and running for it. */
  bailOut(x: number, y: number): void {
    const home = this.island.villages.reduce((best, v) => (Math.hypot(v.x - x, v.y - y) < Math.hypot(best.x - x, best.y - y) ? v : best), { x, y, r: 200 });
    const a: Agent = {
      kind: 'person',
      x,
      y,
      heading: 0,
      speed: 0,
      home: { x: home.x, y: home.y, r: 'r' in home ? home.r : 200 },
      target: null,
      wait: 0,
      scared: 5,
      from: { x: x - 1, y },
      look: Math.floor(this.rand() * 1000),
    };
    this.agents.push(a);
    this.sprites.set(a, this.makeSprite(a));
  }

  private makeSprite(a: Agent): Phaser.GameObjects.Image {
    const scale = a.kind === 'person' || a.kind === 'hiker' || a.kind === 'swimmer' ? 1.7 : a.kind === 'deer' ? 1.3 : 1.25;
    return this.scene.add.image(a.x, a.y, TANK_TEXTURE, this.frameFor(a, 0)).setDepth(this.depths.life).setScale(scale).setVisible(false);
  }

  private frameFor(a: Agent, time: number): string {
    const moving = a.speed > 0;
    // Faster legs when running.
    const step = Math.floor(time / (a.scared > 0 ? 90 : 220) + a.look) % 2;
    switch (a.kind) {
      case 'person':
        if (this.settled(a)) return `${a.role === 'sunbather' ? 'sunbather' : 'sitter'}-${a.look % LIFE_VARIANTS.person}`;
        if (a.role === 'worker' || a.role === 'farmer') return `${a.role}-${moving ? 1 + step : 0}`;
        return `person-${a.look % LIFE_VARIANTS.person}-${moving ? 1 + step : 0}`;
      case 'hiker':
        return `hiker-${a.look % 2}-${moving ? 1 + step : 0}`;
      case 'swimmer':
        return `swimmer-${Math.floor(time / 450 + a.look) % 2}`;
      case 'sheep':
        return `sheep-${moving ? 0 : 1}`;
      case 'cow':
        return `cow-${a.look % LIFE_VARIANTS.cow}-${moving ? 0 : 1}`;
      case 'deer':
        return moving ? `deer-run-${step}` : 'deer-graze';
      case 'hen':
        return `hen-${a.look % 2}-${moving ? step : Math.floor(time / 600 + a.look) % 2}`;
    }
  }

  /** Lying on their towel, or sat by the fire. */
  private settled(a: Agent): boolean {
    return (a.role === 'sunbather' || a.role === 'camper') && a.speed === 0 && a.scared <= 0 && Math.abs(a.x - a.home.x) < 5 && Math.abs(a.y - a.home.y) < 5;
  }

  private draw(a: Agent, sprite: Phaser.GameObjects.Image, time: number): void {
    let heading = a.heading;
    if (this.settled(a)) heading = a.face ?? heading;
    // People standing about turn to talk to whoever's next to them.
    else if (a.kind === 'person' && a.speed === 0) {
      for (const b of this.agents) {
        if (b !== a && b.kind === 'person' && b.speed === 0 && Math.abs(b.x - a.x) < 30 && Math.abs(b.y - a.y) < 30) {
          heading = Math.atan2(b.y - a.y, b.x - a.x);
          break;
        }
      }
    }
    const frame = this.frameFor(a, time);
    if (sprite.frame.name !== frame) sprite.setFrame(frame);
    sprite.setPosition(a.x, a.y).setRotation(heading);
  }

  // --- Kayaks ---------------------------------------------------------------------

  /** Puts a kayak in somewhere up a river (where it's wide enough), to the left or right of the middle. */
  private launch(k: (typeof this.kayaks)[number]): void {
    const { path, widths } = this.island.rivers[k.river];
    for (let tries = 0; tries < 20; tries++) {
      const at = Math.floor(path.length * (0.1 + this.rand() * 0.6));
      if (widths[at] < 18) continue;
      k.at = at;
      break;
    }
    k.across = (this.rand() - 0.5) * 0.5;
  }

  /** Paddles on downstream (quicker if the tank's close), the paddle going side to side. */
  private updateKayak(k: (typeof this.kayaks)[number], time: number, dt: number, near: (x: number, y: number) => boolean, tank: { x: number; y: number }): void {
    const { path, widths } = this.island.rivers[k.river];
    const i = Math.min(path.length - 2, Math.floor(k.at));
    const f = k.at - i;
    const a = path[i];
    const b = path[i + 1];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const width = widths[i];
    const x = a.x + (b.x - a.x) * f - Math.sin(angle) * width * k.across;
    const y = a.y + (b.y - a.y) * f + Math.cos(angle) * width * k.across;
    if (!near(x, y)) {
      k.image?.setVisible(false);
      return;
    }
    const hurry = Math.hypot(tank.x - x, tank.y - y) < 160 ? 2.2 : 1;
    k.at += (30 * hurry * dt) / Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    if (k.at >= path.length - 3) this.launch(k);
    // (Under the bridges.)
    if (!k.image) k.image = this.scene.add.image(x, y, TANK_TEXTURE, 'kayak-0-0').setDepth(this.depths.water + 0.1);
    const frame = `kayak-${k.look % 3}-${Math.floor(time / (hurry > 1 ? 220 : 450) + k.look) % 2}`;
    if (k.image.frame.name !== frame) k.image.setFrame(frame);
    // (Smoothly round the bends.)
    const turn = Math.atan2(Math.sin(angle - k.image.rotation), Math.cos(angle - k.image.rotation));
    k.image.setVisible(true).setPosition(x, y).setRotation(k.image.rotation + turn * Math.min(1, dt * 3));
  }

  // --- Harbour cranes --------------------------------------------------------------

  /**
   * A crane at work: it lifts a container off the boats out over the water,
   * swings it round over the yard and sets it down, then swings back empty
   * for the next. (Stopped for good once it's wrecked.)
   */
  private updateCrane(c: (typeof this.cranes)[number], time: number, near: boolean): void {
    const standing = c.crane.phase === 'intact' || c.crane.phase === 'damaged';
    if (!near || !standing) {
      c.jib?.setVisible(false);
      c.cargo?.setVisible(false);
      return;
    }
    if (!c.jib || !c.cargo) {
      c.jib = this.scene.add.image(c.crane.x, c.crane.y, TANK_TEXTURE, 'crane-jib').setOrigin(11 / 130, 0.5).setDepth(this.depths.lift);
      c.cargo = this.scene.add.image(c.crane.x, c.crane.y, TANK_TEXTURE, 'cargo').setDepth(this.depths.lift - 0.005);
    }
    const cycle = 16;
    const t = ((time / 1000 / cycle + c.phase) % 1) * cycle;
    const ease = (f: number) => 0.5 - Math.cos(Math.PI * Math.max(0, Math.min(1, f))) / 2;
    // Held out over the water, swung round to the yard, held, and back.
    const turn = t < 3 ? 0 : t < 8 ? ease((t - 3) / 5) : t < 11 ? 1 : 1 - ease((t - 11) / 5);
    const angle = c.crane.angle + c.side * Math.PI * turn;
    c.jib.setVisible(true).setRotation(angle);
    const loaded = t > 2 && t < 9.5;
    c.cargo.setVisible(loaded);
    if (loaded) c.cargo.setPosition(c.crane.x + Math.cos(angle) * 112, c.crane.y + Math.sin(angle) * 112).setRotation(angle + Math.PI / 2);
  }

  // --- Ski lifts ------------------------------------------------------------------

  private makeLift(lift: Lift): SkiLift {
    const { bottom, top, side } = lift;
    const dir = Math.atan2(top.y - bottom.y, top.x - bottom.x);
    const length = Math.hypot(top.x - bottom.x, top.y - bottom.y);
    const nx = -Math.sin(dir) * side;
    const ny = Math.cos(dir) * side;
    const holds = this.world.things.filter((t) => {
      if (t.kind !== 'lifttower' && t.kind !== 'liftstation') return false;
      const dx = t.x - bottom.x;
      const dy = t.y - bottom.y;
      const along = dx * Math.cos(dir) + dy * Math.sin(dir);
      return along > -40 && along < length + 40 && Math.abs(-dx * Math.sin(dir) + dy * Math.cos(dir)) < 20;
    });
    const cable = this.scene.add.graphics().setDepth(this.depths.lift - 0.01);
    cable.lineStyle(1.5, 0x2b2d31, 0.8);
    for (const off of [-7, 7]) {
      const ox = -Math.sin(dir) * off;
      const oy = Math.cos(dir) * off;
      cable.lineBetween(bottom.x + ox, bottom.y + oy, top.x + ox, top.y + oy);
    }
    const lap = length * 2;
    const chairs: SkiLift['chairs'] = [];
    for (let s = 0; s < lap; s += LIFT.gap) {
      chairs.push({ s, image: this.scene.add.image(0, 0, TANK_TEXTURE, 'chair-0').setDepth(this.depths.lift).setVisible(false), riders: [] });
    }
    const ski: SkiLift = { lift, dir, length, nx, ny, holds, running: true, cable, chairs, skiers: [] };
    // Skiers, some on their way down, some riding up.
    for (let k = 0, n = 6 + Math.floor(this.rand() * 5); k < n; k++) {
      const skier: Skier = {
        image: this.scene.add.image(0, 0, TANK_TEXTURE, `skier-${k % LIFE_VARIANTS.person}`).setDepth(this.depths.life).setScale(1.7).setVisible(false),
        state: 'down',
        p: this.rand(),
        swing: 50 + this.rand() * 60,
        phase: this.rand() * Math.PI * 2,
        speed: 80 + this.rand() * 50,
      };
      const chair = chairs[Math.floor(this.rand() * chairs.length)];
      if (k % 3 === 0 && chair.s < length && chair.riders.length === 0) {
        skier.state = 'ride';
        chair.riders.push(skier);
      }
      ski.skiers.push(skier);
    }
    return ski;
  }

  /** Where a skier is on the way down (`p` from the top), beside the lift on its piste, swinging from side to side. */
  private pistePoint(l: SkiLift, s: Skier, p: number): { x: number; y: number } {
    const along = l.length * (1 - p);
    const across = 150 + Math.sin((p * l.length) / 90 + s.phase) * s.swing;
    const { bottom } = l.lift;
    return { x: bottom.x + Math.cos(l.dir) * along + l.nx * across, y: bottom.y + Math.sin(l.dir) * along + l.ny * across };
  }

  private updateLift(l: SkiLift, dt: number, view: Phaser.Geom.Rectangle): void {
    const { bottom, top } = l.lift;
    const margin = 500;
    const near =
      Math.max(bottom.x, top.x) > view.left - margin &&
      Math.min(bottom.x, top.x) < view.right + margin &&
      Math.max(bottom.y, top.y) > view.top - margin &&
      Math.min(bottom.y, top.y) < view.bottom + margin;
    if (l.running && l.holds.some((t) => t.phase === 'wrecked' || t.phase === 'gone')) {
      // A pylon or station's down: the cable falls, and the lift stops for good (the riders get down as best they can).
      l.running = false;
      l.cable.clear();
      for (const chair of l.chairs) {
        chair.image.setVisible(false);
        for (const s of chair.riders) {
          s.state = 'wait';
          s.p = 1;
        }
        chair.riders = [];
      }
    }
    if (!near) {
      for (const s of l.skiers) if (s.image.visible) s.image.setVisible(false);
      for (const c of l.chairs) if (c.image.visible) c.image.setVisible(false);
      return;
    }
    const lap = l.length * 2;
    if (l.running) {
      for (const chair of l.chairs) {
        const before = chair.s;
        chair.s = (chair.s + LIFT.speed * dt) % lap;
        // Round the bottom: whoever's waiting gets on (two at a time).
        if (chair.s < before) {
          for (const s of l.skiers) if (s.state === 'wait' && chair.riders.length < 2) {
            s.state = 'ride';
            chair.riders.push(s);
          }
        }
        // At the top: off they get, and away down the piste.
        if (before < l.length && chair.s >= l.length) {
          for (const s of chair.riders) {
            s.state = 'down';
            s.p = 0;
          }
          chair.riders = [];
        }
        const up = chair.s < l.length;
        const along = up ? chair.s : lap - chair.s;
        const off = up ? -7 : 7;
        const x = bottom.x + Math.cos(l.dir) * along - Math.sin(l.dir) * off;
        const y = bottom.y + Math.sin(l.dir) * along + Math.cos(l.dir) * off;
        const frame = chair.riders.length > 0 ? 'chair-2' : 'chair-0';
        if (chair.image.frame.name !== frame) chair.image.setFrame(frame);
        chair.image.setPosition(x, y).setRotation(l.dir).setVisible(true);
      }
    }
    for (const s of l.skiers) {
      if (s.state === 'ride') {
        s.image.setVisible(false);
        continue;
      }
      if (s.state === 'down') {
        const from = this.pistePoint(l, s, s.p);
        s.p = Math.min(1, s.p + (s.speed * dt) / l.length);
        const to = this.pistePoint(l, s, s.p);
        s.image.setPosition(to.x, to.y).setRotation(Math.atan2(to.y - from.y, to.x - from.x));
        // Down at the bottom: over to the lift to wait for a chair.
        if (s.p >= 1) s.state = 'wait';
      } else {
        const spot = Math.sin(s.phase * 7) * 30;
        s.image
          .setPosition(bottom.x - Math.cos(l.dir) * 40 + l.nx * (40 + spot), bottom.y - Math.sin(l.dir) * 40 + l.ny * (40 + spot))
          .setRotation(l.dir);
      }
      s.image.setVisible(true);
    }
  }

  // --- Water ----------------------------------------------------------------------

  /** Crests rolling over the open water with the wind, and surf rolling in and breaking along the shore. */
  private updateWaves(dt: number, view: Phaser.Geom.Rectangle): void {
    for (let k = this.waves.length - 1; k >= 0; k--) {
      const w = this.waves[k];
      w.age += dt;
      if (w.age >= w.life) {
        w.image.destroy();
        this.waves.splice(k, 1);
        continue;
      }
      w.image.x += w.vx * dt;
      w.image.y += w.vy * dt;
      w.image.setAlpha(Math.sin((Math.PI * w.age) / w.life) * w.peak);
    }
    for (let tries = 0; tries < 6 && this.waves.length < WAVES; tries++) {
      const x = view.x + this.rand() * view.width;
      const y = view.y + this.rand() * view.height;
      const b = biomeAt(this.island, x, y);
      if (b === BIOME.river) {
        // Ripples carried downstream.
        const flow = this.downstream(x, y);
        if (!flow) continue;
        const image = this.scene.add
          .image(x, y, TANK_TEXTURE, 'wave')
          .setRotation(flow + Math.PI / 2)
          .setDepth(this.depths.water)
          .setAlpha(0)
          .setScale(0.5 + this.rand() * 0.3);
        this.waves.push({ image, age: 0, life: 1.5 + this.rand(), vx: Math.cos(flow) * 45, vy: Math.sin(flow) * 45, peak: 0.45 });
        continue;
      }
      if (b !== BIOME.deep && b !== BIOME.shallow) continue;
      const { heights } = this.island;
      // Uphill (towards the shore), from the slope of the sea bed.
      const gx = heightAt(heights, x + 16, y) - heightAt(heights, x - 16, y);
      const gy = heightAt(heights, x, y + 16) - heightAt(heights, x, y - 16);
      const shore = b === BIOME.shallow && Math.hypot(gx, gy) > 0.001;
      const angle = shore ? Math.atan2(gy, gx) : Math.atan2(WIND.y, WIND.x);
      const speed = shore ? 16 : 10;
      const image = this.scene.add
        .image(x, y, TANK_TEXTURE, shore ? 'foam' : 'wave')
        .setRotation(angle + Math.PI / 2)
        .setDepth(this.depths.water)
        .setAlpha(0)
        .setScale(shore ? 1.2 : 0.8 + this.rand() * 0.6);
      this.waves.push({ image, age: 0, life: shore ? 2.5 + this.rand() : 3 + this.rand() * 2, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, peak: shore ? 0.75 : 0.35 });
    }
  }

  /** Which way a river flows at a point (towards the sea), from the nearest bit of the nearest river. */
  private downstream(x: number, y: number): number | null {
    let best = Infinity;
    let flow: number | null = null;
    for (const river of this.island.rivers) {
      const { path } = river;
      for (let k = 0; k < path.length - 1; k += 2) {
        const d = Math.abs(path[k].x - x) + Math.abs(path[k].y - y);
        if (d >= best) continue;
        best = d;
        const next = path[Math.min(path.length - 1, k + 2)];
        flow = Math.atan2(next.y - path[k].y, next.x - path[k].x);
      }
    }
    return best < 200 ? flow : null;
  }

  // --- Birds ----------------------------------------------------------------------

  /** Every so often a flock flies over: gulls near the sea, darker birds inland. */
  private updateBirds(time: number, dt: number, view: Phaser.Geom.Rectangle): void {
    this.nextFlock -= dt;
    if (this.nextFlock <= 0) {
      this.nextFlock = 8 + this.rand() * 12;
      const dir = this.rand() * Math.PI * 2;
      const reach = Math.hypot(view.width, view.height) / 2 + 60;
      this.flock(view.centerX - Math.cos(dir) * reach, view.centerY - Math.sin(dir) * reach, dir, 70, 3 + Math.floor(this.rand() * 6));
    }
    for (let k = this.birds.length - 1; k >= 0; k--) {
      const b = this.birds[k];
      b.image.x += b.vx * dt;
      b.image.y += b.vy * dt;
      b.shadow.setPosition(b.image.x + SHADOW.x * 110, b.image.y + SHADOW.y * 110);
      const frame = `bird-${Math.floor(time / 130 + b.phase) % 2}`;
      if (b.image.frame.name !== frame) {
        b.image.setFrame(frame);
        b.shadow.setFrame(frame);
      }
      if (Math.abs(b.image.x - view.centerX) > view.width + 400 || Math.abs(b.image.y - view.centerY) > view.height + 400) {
        b.image.destroy();
        b.shadow.destroy();
        this.birds.splice(k, 1);
      }
    }
  }

  private flock(x: number, y: number, dir: number, speed: number, count: number): void {
    const coast = biomeAt(this.island, x, y) <= BIOME.beach;
    for (let k = 0; k < count; k++) {
      const back = Math.ceil(k / 2) * 22;
      const side = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 18;
      const bx = x - Math.cos(dir) * back - Math.sin(dir) * side + (this.rand() - 0.5) * 8;
      const by = y - Math.sin(dir) * back + Math.cos(dir) * side + (this.rand() - 0.5) * 8;
      const image = this.scene.add
        .image(bx, by, TANK_TEXTURE, 'bird-0')
        .setRotation(dir)
        .setTint(coast ? 0xffffff : 0x3a3532)
        .setDepth(this.depths.sky);
      const shadow = this.scene.add.image(bx, by, TANK_TEXTURE, 'bird-0').setRotation(dir).setTint(0x000000).setAlpha(0.15).setDepth(this.depths.shadows);
      this.birds.push({ image, shadow, vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed, phase: this.rand() * 2 });
    }
  }

  /** An explosion near trees sends birds up out of them, flying off away from it. */
  private startle(b: { x: number; y: number }): void {
    if (this.birds.length > 40) return;
    const trees = this.world.near(b.x, b.y, 250).filter((t) => t.def.material === 'plant' && t.phase === 'intact' && t.kind !== 'bush');
    if (trees.length < 3) return;
    const t = trees[Math.floor(this.rand() * trees.length)];
    this.flock(t.x, t.y, Math.atan2(t.y - b.y, t.x - b.x) + (this.rand() - 0.5), 150, 3 + Math.floor(this.rand() * 5));
  }
}
