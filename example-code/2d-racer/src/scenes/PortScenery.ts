import * as Phaser from 'phaser';
import type { Decoration, Mover, Prop, Yard } from '../track/decoration';
import { type Port, PORT_CELL, type Route, isLand } from '../track/port';
import type { Track, Vec2 } from '../track/Track';
import { type ChunkLayers, ChunkedGraphics } from './ChunkLayers';
import { DECO_TEXTURE } from './decorationArt';
import type { DecorationDepths } from './Decorations';
import { CONCRETE_TEXTURE, CRANE_BOOM, DOCKER_VESTS, MARKINGS, PORT_VARIANTS, RTG_COLOURS, WATER_FRAMES, createConcreteTexture } from './portArt';
import { TEX } from './textures';

/** Light from the top left, as for the cars. */
const SHADOW_DIR = { x: 0.62, y: 0.78 };
const COPING = 0x77726a;
const SAFETY_LINE = 0xe0b52a;
/** Which way the wind blows the gulls, px/s. */
const WIND = { x: 14, y: 6 };
/** Dockers are drawn a little larger than life, so you can make them out at speed. */
const DOCKER_SCALE = 1.4;
/** Gulls sat by the track take off when a car comes this close (px). */
const GULL_FRIGHT = 260;
/** How long scattered gulls stay away before coming back to land, s. */
const GULLS_AWAY: [number, number] = [9, 18];

/**
 * Something going back and forth along a straight route, pausing at each
 * end: lorries, straddle carriers, the train, tugboats, forklifts, dockers.
 */
interface Vehicle {
  route: Route;
  length: number;
  t: number;
  dir: 1 | -1;
  speed: number;
  pause: number;
  /** How long it waits at each end, s. */
  wait: [number, number];
  /** Images and how far behind the front each sits (a train has several). */
  parts: { image: Phaser.GameObjects.Image; back: number }[];
  /** What it carries on some trips (a container, a pallet), and how far behind its middle it sits. */
  load: Phaser.GameObjects.Image | null;
  loadBack: number;
  loaded: boolean;
  /** Whether it carries its load out (true) or both ways at random. */
  loadsOut: boolean;
  /** Forklifts back up the way they came rather than turning round. */
  reverses: boolean;
  /** A docker's frames: `${walk}-s` standing, `${walk}-0` and `-1` walking. */
  walk: string | null;
  tug: boolean;
  wakeDue: number;
}

/** A yard crane running along its container stacks, lifting containers. */
interface YardCrane {
  gantry: Phaser.GameObjects.Image;
  trolley: Phaser.GameObjects.Image;
  load: Phaser.GameObjects.Image;
  yard: Yard;
  /** Where along the yard it is, and where it's heading next. */
  at: number;
  target: number;
  /** Seconds left working at this stop. */
  working: number;
}

interface Crane {
  trolley: Phaser.GameObjects.Image;
  load: Phaser.GameObjects.Image;
  /** Where the trolley runs, from over the quay out over the ship. */
  from: Vec2;
  to: Vec2;
  phase: number;
}

interface Gull {
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  seat: Vec2;
  /** Where it flies off to and comes back from. */
  away: Vec2;
}

interface GullGroup {
  x: number;
  y: number;
  gulls: Gull[];
  state: 'sitting' | 'leaving' | 'away' | 'returning';
  timer: number;
}

interface Flock {
  centre: Vec2;
  gulls: { image: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; angle: number; radius: number; speed: number }[];
}

/**
 * The docks around the circuit: harbour water, concrete yards and quays, the
 * grass verge, roads and railway; and their life: cranes unloading ships,
 * trucks and straddle carriers, a shunting train, tugboats, boats bobbing at
 * their moorings, gulls (sat by the track and wheeling over the water), and
 * light on the water.
 */
export class PortScenery {
  /** The plots of dock water, for shimmering. */
  private readonly water: { image: Phaser.GameObjects.Image; phase: number }[] = [];
  private shimmerDue = 0;
  private readonly vehicles: Vehicle[] = [];
  private readonly yardCranes: YardCrane[] = [];
  private readonly gangs: { image: Phaser.GameObjects.Image; base: number; phase: number }[] = [];
  private readonly cranes: Crane[] = [];
  private readonly bobbing: { image: Phaser.GameObjects.Image; base: number; phase: number; amount: number }[] = [];
  private readonly smokeSources: Vec2[] = [];
  private readonly gullGroups: GullGroup[] = [];
  private readonly flocks: Flock[] = [];
  private readonly sparkles: { image: Phaser.GameObjects.Image; life: number }[] = [];
  private readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly wake: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly rng: Phaser.Math.RandomDataGenerator;
  private readonly port: Port;
  private smokeDue = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    track: Track,
    deco: Decoration,
    private readonly depths: DecorationDepths,
    private readonly chunks: ChunkLayers,
  ) {
    this.port = deco.port!;
    this.rng = new Phaser.Math.RandomDataGenerator([`${track.length}`, 'port']);
    createConcreteTexture(scene);
    const { x0, y0, cols, rows } = this.port;
    // Concrete under everything; the water and grass go on top, so the screen is only filled once.
    scene.add
      .tileSprite(x0 - 20, y0 - 20, cols * PORT_CELL + 40, rows * PORT_CELL + 40, CONCRETE_TEXTURE)
      .setOrigin(0, 0)
      .setDepth(0);
    this.drawLand();
    this.smoke = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: 3000,
        speedX: { min: 14, max: 26 },
        speedY: { min: 2, max: 12 },
        scale: { start: 0.4, end: 2 },
        alpha: { start: 0.3, end: 0 },
        tint: 0x9a9a9a,
        emitting: false,
      })
      .setDepth(depths.overhead);
    this.wake = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: 1600,
        speed: { min: 2, max: 10 },
        scale: { start: 0.3, end: 1.4 },
        alpha: { start: 0.45, end: 0 },
        tint: 0xe6f2f7,
        emitting: false,
      })
      .setDepth(depths.ground - 0.095);
    for (const route of this.port.tugRoutes) this.addTug(route);
    for (const yard of deco.yards) this.addYardCrane(yard);
    for (const mover of deco.movers) this.addMover(mover);
    for (let k = 0; k < 2; k++) this.flocks.push(this.makeFlock());
    for (let k = 0; k < 14; k++) {
      this.sparkles.push({ image: scene.add.image(0, 0, DECO_TEXTURE, 'glint').setDepth(depths.ground - 0.09).setVisible(false), life: 0 });
    }
  }

  /** Port things the decoration hands over: roads and railway, ships, boats, cranes, gulls. */
  addProp(prop: Prop): void {
    switch (prop.kind) {
      case 'road':
      case 'rail':
        this.addLane(prop);
        break;
      case 'ship': {
        const ship = this.propImage(prop, `ship-${prop.variant}`, this.depths.props);
        this.bobbing.push({ image: ship, base: prop.angle, phase: this.rng.frac() * 6, amount: 0.004 });
        // Smoke from the funnel, at the stern.
        const back = -prop.w / 2 + 29;
        this.smokeSources.push({ x: prop.x + Math.cos(prop.angle) * back, y: prop.y + Math.sin(prop.angle) * back });
        break;
      }
      case 'pontoon':
        this.propImage(prop, 'pontoon-0', this.depths.ground - 0.09);
        break;
      case 'boat': {
        const boat = this.propImage(prop, `boat-${prop.variant}`, this.depths.props);
        this.bobbing.push({ image: boat, base: prop.angle, phase: this.rng.frac() * 6, amount: 0.03 });
        break;
      }
      case 'crane':
        this.addCrane(prop);
        break;
      case 'gulls':
        this.addGullGroup(prop);
        break;
      case 'workers':
        this.addGang(prop);
        break;
    }
  }

  update(time: number, dt: number, cars: Vec2[], camera: Phaser.Cameras.Scene2D.Camera): void {
    const view = camera.worldView;
    const near = (x: number, y: number, margin: number) =>
      x > view.left - margin && x < view.right + margin && y > view.top - margin && y < view.bottom + margin;

    // The water shimmers: each plot steps through its frames, out of step with its neighbours.
    this.shimmerDue -= dt;
    if (this.shimmerDue <= 0) {
      this.shimmerDue = 0.35;
      const step = Math.floor(time / 350);
      for (const w of this.water) {
        if (!near(w.image.x, w.image.y, 100)) continue;
        const frame = `water-${(step + w.phase) % WATER_FRAMES}`;
        if (w.image.frame.name !== frame) w.image.setFrame(frame, false, false);
      }
    }

    for (const b of this.bobbing) {
      if (near(b.image.x, b.image.y, 200)) b.image.setRotation(b.base + Math.sin(time / 900 + b.phase) * b.amount);
    }
    for (const v of this.vehicles) this.updateVehicle(v, dt, near);
    for (const c of this.cranes) this.updateCrane(c, time, near);
    for (const c of this.yardCranes) this.updateYardCrane(c, dt, near);
    for (const g of this.gangs) {
      // Chatting: turning to one another now and then.
      if (near(g.image.x, g.image.y, 50)) g.image.setRotation(g.base + Math.sin(time / 1700 + g.phase) * 0.6 * Math.max(0, Math.sin(time / 3100 + g.phase * 2)));
    }

    this.smokeDue -= dt;
    if (this.smokeDue <= 0) {
      this.smokeDue = 0.3;
      for (const s of this.smokeSources) if (near(s.x, s.y, 150)) this.smoke.emitParticleAt(s.x, s.y, 1);
    }

    for (const g of this.gullGroups) this.updateGulls(g, time, dt, cars, near);
    for (const f of this.flocks) this.updateFlock(f, time, dt, view);
    this.updateSparkles(dt, view);
  }

  // --- The ground -------------------------------------------------------------

  /** Plots of dock water (one picture each, so they draw cheaply), and stone quay walls with bollards along them. */
  private drawLand(): void {
    const { x0, y0, cols, rows, land } = this.port;
    const quay = new ChunkedGraphics(this.scene, this.chunks, this.depths.ground - 0.08);
    const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : land[r * cols + c]);
    const S = PORT_CELL;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = x0 + c * S;
        const y = y0 + r * S;
        if (!at(c, r)) {
          const phase = this.rng.between(0, WATER_FRAMES - 1);
          // Overlapping a pixel (so no seams show), and turned any of four ways so the swells don't repeat.
          const image = this.scene.add
            .image(x + S / 2, y + S / 2, DECO_TEXTURE, `water-${phase}`)
            .setDisplaySize(S + 2, S + 2)
            .setRotation((this.rng.between(0, 3) * Math.PI) / 2)
            .setFlipX(this.rng.frac() < 0.5);
          this.water.push({ image: this.chunks.add(image, this.depths.ground - 0.1), phase });
          continue;
        }
        // Paint on the odd plot, away from the quay edge.
        if (this.rng.frac() < 0.08 && at(c + 1, r) && at(c - 1, r) && at(c, r + 1) && at(c, r - 1)) {
          const marking = this.scene.add
            .image(x + S / 2, y + S / 2, DECO_TEXTURE, `marking-${this.rng.between(0, MARKINGS - 1)}`)
            .setRotation((this.rng.between(0, 3) * Math.PI) / 2);
          this.chunks.add(marking, this.depths.ground - 0.095);
        }
        // Quay walls along each side that meets water.
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (at(c + dc, r + dr)) continue;
          this.quayEdge(quay, x, y, dc, dr);
        }
      }
    }
  }

  /** One plot's side of quay wall: stone coping, a yellow safety line, bollards, and tyre fenders hung over the water. */
  private quayEdge(g: ChunkedGraphics, x: number, y: number, dc: number, dr: number): void {
    const S = PORT_CELL;
    // Edge-aligned rectangle `depth` deep starting `inset` px in from the water side.
    const band = (inset: number, depth: number) => {
      if (dr === 1) g.fillRect(x, y + S - inset - depth, S, depth);
      else if (dr === -1) g.fillRect(x, y + inset, S, depth);
      else if (dc === 1) g.fillRect(x + S - inset - depth, y, depth, S);
      else g.fillRect(x + inset, y, depth, S);
    };
    g.fillStyle(COPING);
    band(0, 8);
    g.fillStyle(0x4f4b45);
    band(0, 2);
    g.fillStyle(SAFETY_LINE);
    band(16, 3);
    const along = (t: number, inset: number): Vec2 => {
      if (dr === 1) return { x: x + t, y: y + S - inset };
      if (dr === -1) return { x: x + t, y: y + inset };
      if (dc === 1) return { x: x + S - inset, y: y + t };
      return { x: x + inset, y: y + t };
    };
    for (const t of [S / 4, (3 * S) / 4]) {
      const b = along(t, 5);
      g.fillStyle(0x2b2b2b);
      g.fillCircle(b.x, b.y, 3.6);
    }
    const f = along(S / 2, -3);
    g.fillStyle(0x1a1a1a);
    if (dr !== 0) g.fillRect(f.x - 6, f.y - 2.5, 12, 5);
    else g.fillRect(f.x - 2.5, f.y - 6, 5, 12);
  }

  // --- Roads, railway and what runs on them -----------------------------------

  private addLane(prop: Prop): void {
    const rail = prop.kind === 'rail';
    const c = Math.cos(prop.angle);
    const s = Math.sin(prop.angle);
    const from = { x: prop.x - (c * prop.w) / 2, y: prop.y - (s * prop.w) / 2 };
    const route = { from, to: { x: prop.x + (c * prop.w) / 2, y: prop.y + (s * prop.w) / 2 } };
    const g = new ChunkedGraphics(this.scene, this.chunks, this.depths.ground - 0.06);
    const horizontal = Math.abs(c) > 0.5;
    // Across-the-lane rectangle at distance t along it: `across` wide, `long` long.
    const piece = (t: number, offset: number, long: number, across: number) => {
      const x = from.x + c * t - s * offset;
      const y = from.y + s * t + c * offset;
      if (horizontal) g.fillRect(Math.min(x, x + c * long), y - across / 2, Math.abs(long), across);
      else g.fillRect(x - across / 2, Math.min(y, y + s * long), across, Math.abs(long));
    };
    // In short pieces, so each chunk of the world draws its own bit.
    for (let t = 0; t < prop.w; t += 64) {
      const long = Math.min(64, prop.w - t);
      if (rail) {
        g.fillStyle(0x8a8378);
        piece(t, 0, long, prop.h);
        g.fillStyle(0x5b4a3a);
        for (let k = 2; k < long; k += 10) piece(t + k, 0, 4, prop.h - 6);
        g.fillStyle(0x9aa0a8);
        piece(t, -7, long, 2.5);
        piece(t, 7, long, 2.5);
      } else {
        // A traffic lane painted on the concrete: yellow lines either side, white dashes down the middle.
        g.fillStyle(SAFETY_LINE, 0.75);
        piece(t, -prop.h / 2 + 2, long, 2.5);
        piece(t, prop.h / 2 - 2, long, 2.5);
        g.fillStyle(0xf0f0f0, 0.6);
        piece(t + 8, 0, 18, 2);
        piece(t + 40, 0, 18, 2);
      }
    }
    const length = prop.w;
    if (rail) {
      // A short freight train shunting up and down the siding.
      const parts = [{ image: this.scene.add.image(0, 0, DECO_TEXTURE, 'loco'), back: 0 }];
      const wagons = this.rng.between(3, 5);
      for (let k = 0; k < wagons; k++) {
        parts.push({ image: this.scene.add.image(0, 0, DECO_TEXTURE, `wagon-${this.rng.between(0, PORT_VARIANTS.wagon - 1)}`), back: 73 + k * 78 });
      }
      for (const p of parts) p.image.setDepth(this.depths.props);
      this.vehicles.push(this.vehicle(route, { t: length / 2, speed: 32, wait: [3, 6], parts }));
      return;
    }
    // Lorries hauling containers and straddle carriers lifting them, up and down the lane.
    const count = Math.min(4, Math.max(1, Math.round(length / 450)));
    for (let k = 0; k < count; k++) {
      const straddle = this.rng.frac() < 0.4;
      const image = this.scene.add.image(0, 0, DECO_TEXTURE, straddle ? 'straddle' : `truck-${this.rng.between(0, 4)}`);
      image.setDepth(straddle ? this.depths.props + 0.02 : this.depths.props);
      // A straddle carrier's container hangs inside its frame; a lorry's sits on its trailer.
      const load = this.scene.add.image(0, 0, DECO_TEXTURE, `container-${this.rng.between(0, 5)}`).setDepth(this.depths.props + 0.01);
      this.vehicles.push(
        this.vehicle(route, {
          t: ((k + this.rng.frac() * 0.6) / count) * length,
          speed: straddle ? this.rng.realInRange(50, 65) : this.rng.realInRange(80, 110),
          wait: [1, 4],
          parts: [{ image, back: 0 }],
          load,
          loadBack: straddle ? 0 : 12,
        }),
      );
    }
  }

  /** A vehicle on a route, with the usual defaults. */
  private vehicle(route: Route, options: Partial<Vehicle>): Vehicle {
    return {
      route,
      length: Math.hypot(route.to.x - route.from.x, route.to.y - route.from.y),
      t: 0,
      dir: this.rng.frac() < 0.5 ? 1 : -1,
      speed: 60,
      pause: 0,
      wait: [1, 3],
      parts: [],
      load: null,
      loadBack: 0,
      loaded: this.rng.frac() < 0.6,
      loadsOut: false,
      reverses: false,
      walk: null,
      tug: false,
      wakeDue: 0,
      ...options,
    };
  }

  /** Forklifts shuttling pallets from warehouse doors, and dockers walking about. */
  private addMover(mover: Mover): void {
    const route = { from: mover.from, to: mover.to };
    if (mover.kind === 'forklift') {
      const image = this.scene.add.image(0, 0, DECO_TEXTURE, 'forklift').setDepth(this.depths.props + 0.01);
      const load = this.scene.add.image(0, 0, DECO_TEXTURE, 'pallet-load').setDepth(this.depths.props + 0.02);
      this.vehicles.push(this.vehicle(route, { dir: 1, speed: 45, wait: [1.5, 3.5], parts: [{ image, back: 0 }], load, loadBack: -14, loadsOut: true, reverses: true }));
      return;
    }
    const walk = `docker-${this.rng.between(0, DOCKER_VESTS - 1)}`;
    const image = this.scene.add.image(0, 0, DECO_TEXTURE, `${walk}-s`).setScale(DOCKER_SCALE).setDepth(this.depths.props + 0.03);
    const length = Math.hypot(route.to.x - route.from.x, route.to.y - route.from.y);
    this.vehicles.push(this.vehicle(route, { t: this.rng.frac() * length, speed: this.rng.realInRange(26, 40), wait: [1, 5], parts: [{ image, back: 0 }], walk }));
  }

  /** A few dockers stood together, turned towards each other. */
  private addGang(prop: Prop): void {
    const count = this.rng.between(2, 4);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + this.rng.frac() * 0.5;
      const x = prop.x + Math.cos(a) * 12;
      const y = prop.y + Math.sin(a) * 12;
      const base = a + Math.PI; // facing the middle
      const image = this.scene.add.image(x, y, DECO_TEXTURE, `docker-${this.rng.between(0, DOCKER_VESTS - 1)}-s`).setRotation(base).setScale(DOCKER_SCALE);
      this.chunks.add(image, this.depths.props + 0.03);
      this.gangs.push({ image, base, phase: this.rng.frac() * 10 });
    }
  }

  // --- Yard cranes ------------------------------------------------------------

  private addYardCrane(yard: Yard): void {
    const variant = this.rng.between(0, RTG_COLOURS - 1);
    // Overhead: the gantry spans the stacks, its trolley runs across it carrying a container.
    const gantry = this.scene.add.image(0, 0, DECO_TEXTURE, `rtg-${variant}`).setDisplaySize(34, yard.span).setRotation(yard.angle).setDepth(this.depths.overhead);
    const load = this.scene.add.image(0, 0, DECO_TEXTURE, `container-${this.rng.between(0, 5)}`).setRotation(yard.angle).setDepth(this.depths.overhead + 0.01);
    const trolley = this.scene.add.image(0, 0, DECO_TEXTURE, 'trolley').setRotation(yard.angle + Math.PI / 2).setDepth(this.depths.overhead + 0.02);
    const at = (this.rng.frac() - 0.5) * yard.length;
    this.yardCranes.push({ gantry, trolley, load, yard, at, target: at, working: this.rng.realInRange(0, 4) });
  }

  /**
   * Runs along to a stack, lifts a container out (or sets one down), and moves
   * on to the next.
   */
  private updateYardCrane(c: YardCrane, dt: number, near: (x: number, y: number, m: number) => boolean): void {
    const { yard } = c;
    const show = near(yard.x, yard.y, Math.max(yard.length, yard.span));
    c.gantry.setVisible(show);
    c.trolley.setVisible(show);
    if (!show) {
      c.load.setVisible(false);
      return;
    }
    const cos = Math.cos(yard.angle);
    const sin = Math.sin(yard.angle);
    const half = yard.length / 2 - 17;
    let across = 0;
    if (c.working > 0) {
      c.working -= dt;
      // Trolley out to a row and back, the container coming up on the way back.
      const f = Math.max(0, Math.min(1, c.working / 5));
      const reach = Math.sin(f * Math.PI) * (yard.span / 2 - 20);
      across = (c.target > 0 ? 1 : -1) * reach;
      c.load.setVisible(f < 0.5);
      if (c.working <= 0) c.target = (this.rng.frac() * 2 - 1) * half;
    } else {
      const step = 22 * dt;
      c.at += Math.max(-step, Math.min(step, c.target - c.at));
      if (Math.abs(c.target - c.at) < 0.5) c.working = 5;
    }
    const x = yard.x + cos * c.at;
    const y = yard.y + sin * c.at;
    c.gantry.setPosition(x, y);
    const tx = x - sin * across;
    const ty = y + cos * across;
    c.trolley.setPosition(tx, ty);
    c.load.setPosition(tx, ty);
  }

  private addTug(route: Route): void {
    const image = this.scene.add.image(0, 0, DECO_TEXTURE, 'boat-0').setDepth(this.depths.props);
    const length = Math.hypot(route.to.x - route.from.x, route.to.y - route.from.y);
    this.vehicles.push(this.vehicle(route, { t: this.rng.frac() * length, dir: 1, speed: 45, wait: [2, 4], parts: [{ image, back: 0 }], tug: true }));
  }

  private updateVehicle(v: Vehicle, dt: number, near: (x: number, y: number, m: number) => boolean): void {
    const { from, to } = v.route;
    const ux = (to.x - from.x) / v.length;
    const uy = (to.y - from.y) / v.length;
    const front = v.parts[0].image;
    const visible = near(from.x + ux * v.t, from.y + uy * v.t, 500);
    if (v.pause > 0) {
      v.pause -= dt;
    } else {
      v.t += v.dir * v.speed * dt;
      // A train's whole length has to stay on the siding.
      const tail = v.parts[v.parts.length - 1].back + 40;
      const lo = v.dir === 1 ? 30 : 30 + tail;
      const hi = v.length - 30;
      if (v.t > hi || v.t < lo) {
        v.t = Phaser.Math.Clamp(v.t, lo, hi);
        v.dir = v.dir === 1 ? -1 : 1;
        v.pause = this.rng.realInRange(...v.wait);
        v.loaded = v.loadsOut ? v.dir === 1 : this.rng.frac() < 0.6;
      }
    }
    for (const p of v.parts) p.image.setVisible(visible);
    v.load?.setVisible(visible && v.loaded);
    if (!visible) return;
    // Forklifts face the same way both ways, backing up on the way home.
    const heading = Math.atan2(uy, ux) + (v.dir === 1 || v.reverses ? 0 : Math.PI);
    for (const p of v.parts) {
      // Wagons trail behind the locomotive, whichever way it's going.
      const t = v.t - v.dir * p.back;
      p.image.setPosition(from.x + ux * t, from.y + uy * t).setRotation(heading);
    }
    if (v.walk) {
      const frame = v.pause > 0 ? `${v.walk}-s` : `${v.walk}-${Math.floor(v.t / 9) % 2}`;
      if (front.frame.name !== frame) front.setFrame(frame, false, false);
    }
    v.load?.setPosition(front.x - Math.cos(heading) * v.loadBack, front.y - Math.sin(heading) * v.loadBack).setRotation(heading);
    if (v.tug && v.pause <= 0) {
      v.wakeDue -= dt;
      if (v.wakeDue <= 0) {
        v.wakeDue = 0.12;
        this.wake.emitParticleAt(front.x - Math.cos(heading) * 28, front.y - Math.sin(heading) * 28, 1);
        if (Math.random() < 0.3) this.smoke.emitParticleAt(front.x - Math.cos(heading) * 10, front.y - Math.sin(heading) * 10, 1);
      }
    }
  }

  // --- Ships' cranes ------------------------------------------------------------

  private addCrane(prop: Prop): void {
    // The art's legs sit at its bottom; its boom reaches out the front over the water.
    const c = Math.cos(prop.angle);
    const s = Math.sin(prop.angle);
    const local = (v: number): Vec2 => ({ x: prop.x - s * v, y: prop.y + c * v });
    const centre = local(-CRANE_BOOM / 2);
    const frame = `crane-${prop.variant}`;
    const crane = this.scene.add.image(centre.x, centre.y, DECO_TEXTURE, frame).setRotation(prop.angle);
    this.chunks.add(crane, this.depths.overhead);
    const shadow = this.scene.add
      .image(centre.x + SHADOW_DIR.x * 26, centre.y + SHADOW_DIR.y * 26, DECO_TEXTURE, frame)
      .setRotation(prop.angle)
      .setTint(0x000000)
      .setAlpha(0.25);
    this.chunks.add(shadow, this.depths.shadows);
    const load = this.scene.add.image(0, 0, DECO_TEXTURE, `container-${this.rng.between(0, 5)}`).setRotation(prop.angle + Math.PI / 2).setDepth(this.depths.overhead + 0.01);
    const trolley = this.scene.add.image(0, 0, DECO_TEXTURE, 'trolley').setRotation(prop.angle).setDepth(this.depths.overhead + 0.02);
    this.cranes.push({ trolley, load, from: local(0), to: local(-prop.h / 2 - CRANE_BOOM + 30), phase: this.rng.frac() * 10 });
  }

  /**
   * Out over the ship, pick up a container, bring it back over the quay, set
   * it down, and again: a ten-second cycle.
   */
  private updateCrane(c: Crane, time: number, near: (x: number, y: number, m: number) => boolean): void {
    const show = near(c.from.x, c.from.y, 300);
    c.trolley.setVisible(show);
    if (!show) {
      c.load.setVisible(false);
      return;
    }
    const t = ((time / 1000 + c.phase) % 10) / 10;
    // 0-0.3 out, 0.3-0.4 lifting, 0.4-0.7 back, 0.7-0.8 setting down, then a pause.
    const out = t < 0.3 ? smooth(t / 0.3) : t < 0.4 ? 1 : t < 0.7 ? 1 - smooth((t - 0.4) / 0.3) : 0;
    const x = c.from.x + (c.to.x - c.from.x) * out;
    const y = c.from.y + (c.to.y - c.from.y) * out;
    c.trolley.setPosition(x, y);
    c.load.setPosition(x, y).setVisible(t > 0.35 && t < 0.75);
  }

  // --- Gulls --------------------------------------------------------------------

  private addGullGroup(prop: Prop): void {
    const count = this.rng.between(4, 7);
    const c = Math.cos(prop.angle);
    const s = Math.sin(prop.angle);
    const gulls: Gull[] = [];
    for (let k = 0; k < count; k++) {
      const u = this.rng.realInRange(-prop.w / 2 + 8, prop.w / 2 - 8);
      const v = this.rng.realInRange(-prop.h / 2 + 6, prop.h / 2 - 6);
      const seat = { x: prop.x + c * u - s * v, y: prop.y + s * u + c * v };
      // They scatter away from the track (local +y), spreading out.
      const flee = prop.angle + Math.PI / 2 + this.rng.realInRange(-0.7, 0.7);
      const distance = this.rng.realInRange(500, 800);
      const away = { x: seat.x + Math.cos(flee) * distance, y: seat.y + Math.sin(flee) * distance };
      const image = this.scene.add.image(seat.x, seat.y, DECO_TEXTURE, 'gull-sit').setRotation(this.rng.angle() * (Math.PI / 180)).setDepth(this.depths.props);
      const shadow = this.scene.add
        .image(seat.x + 1.5, seat.y + 2, DECO_TEXTURE, 'gull-sit')
        .setRotation(image.rotation)
        .setTint(0x000000)
        .setAlpha(0.25)
        .setDepth(this.depths.shadows);
      gulls.push({ image, shadow, seat, away });
    }
    this.gullGroups.push({ x: prop.x, y: prop.y, gulls, state: 'sitting', timer: 0 });
  }

  private updateGulls(g: GullGroup, time: number, dt: number, cars: Vec2[], near: (x: number, y: number, m: number) => boolean): void {
    g.timer += dt;
    const flying = (gull: Gull, k: number, f: number) => {
      // f: 0 at the seat, 1 far away. Higher (bigger, shadow further off) the further out.
      const x = gull.seat.x + (gull.away.x - gull.seat.x) * f;
      const y = gull.seat.y + (gull.away.y - gull.seat.y) * f;
      const height = Math.min(1, f * 3);
      const heading = Math.atan2(gull.away.y - gull.seat.y, gull.away.x - gull.seat.x) + (g.state === 'returning' ? Math.PI : 0);
      const frame = Math.floor(time / 110 + k) % 2 === 0 ? 'gull-0' : 'gull-1';
      gull.image.setFrame(frame, false, false).setPosition(x, y).setRotation(heading).setScale(1 + height * 0.4).setDepth(this.depths.sky);
      gull.shadow
        .setFrame(frame, false, false)
        .setPosition(x + SHADOW_DIR.x * (4 + height * 70), y + SHADOW_DIR.y * (4 + height * 70))
        .setRotation(heading);
    };
    switch (g.state) {
      case 'sitting': {
        if (!near(g.x, g.y, 300)) return;
        // Turning about and pecking now and then.
        for (const [k, gull] of g.gulls.entries()) {
          if (Math.sin(time / 700 + k * 2.1) > 0.97) gull.image.setRotation(gull.image.rotation + 0.05);
        }
        if (cars.some((c) => Math.abs(c.x - g.x) < GULL_FRIGHT && Math.abs(c.y - g.y) < GULL_FRIGHT)) {
          g.state = 'leaving';
          g.timer = 0;
        }
        return;
      }
      case 'leaving': {
        const f = Math.min(1, g.timer / 4);
        g.gulls.forEach((gull, k) => flying(gull, k, Math.min(1, f * (0.8 + (k % 3) * 0.1))));
        if (f >= 1) {
          g.state = 'away';
          g.timer = -this.rng.realInRange(...GULLS_AWAY);
          for (const gull of g.gulls) {
            gull.image.setVisible(false);
            gull.shadow.setVisible(false);
          }
        }
        return;
      }
      case 'away': {
        // Back once the coast is clear.
        if (g.timer < 0 || cars.some((c) => Math.abs(c.x - g.x) < GULL_FRIGHT * 2 && Math.abs(c.y - g.y) < GULL_FRIGHT * 2)) return;
        g.state = 'returning';
        g.timer = 0;
        for (const gull of g.gulls) {
          gull.image.setVisible(true);
          gull.shadow.setVisible(true);
        }
        return;
      }
      case 'returning': {
        const f = 1 - Math.min(1, g.timer / 5);
        g.gulls.forEach((gull, k) => flying(gull, k, f));
        if (f <= 0) {
          g.state = 'sitting';
          for (const gull of g.gulls) {
            gull.image.setFrame('gull-sit', false, false).setPosition(gull.seat.x, gull.seat.y).setScale(1).setDepth(this.depths.props);
            gull.shadow.setFrame('gull-sit', false, false).setPosition(gull.seat.x + 1.5, gull.seat.y + 2);
          }
        }
        return;
      }
    }
  }

  private makeFlock(): Flock {
    const gulls = Array.from({ length: this.rng.between(4, 7) }, () => ({
      image: this.scene.add.image(0, 0, DECO_TEXTURE, 'gull-0').setDepth(this.depths.sky).setScale(1.3),
      shadow: this.scene.add.image(0, 0, DECO_TEXTURE, 'gull-0').setTint(0x000000).setAlpha(0.15).setDepth(this.depths.shadows),
      angle: this.rng.frac() * Math.PI * 2,
      radius: this.rng.realInRange(70, 170),
      speed: this.rng.realInRange(0.45, 0.8) * (this.rng.frac() < 0.5 ? 1 : -1),
    }));
    // Far away, so the first update moves it somewhere near the camera.
    return { centre: { x: -1e6, y: -1e6 }, gulls };
  }

  /** Gulls wheeling over the water, kept near the camera (somewhere over water when they're moved). */
  private updateFlock(f: Flock, time: number, dt: number, view: Phaser.Geom.Rectangle): void {
    const margin = 500;
    if (f.centre.x < view.left - margin || f.centre.x > view.right + margin || f.centre.y < view.top - margin || f.centre.y > view.bottom + margin) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const x = view.x - 200 + this.rng.frac() * (view.width + 400);
        const y = view.y - 200 + this.rng.frac() * (view.height + 400);
        if (!isLand(this.port, x, y)) {
          f.centre = { x, y };
          break;
        }
      }
    }
    f.centre.x += WIND.x * 0.3 * dt;
    f.centre.y += WIND.y * 0.3 * dt;
    f.gulls.forEach((g, k) => {
      g.angle += g.speed * dt;
      const x = f.centre.x + Math.cos(g.angle) * g.radius;
      const y = f.centre.y + Math.sin(g.angle) * g.radius * 0.8;
      const heading = g.angle + (g.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
      // Mostly gliding, with the odd few flaps.
      const frame = Math.sin(time / 500 + k * 1.7) > 0.4 && Math.floor(time / 120) % 2 === 0 ? 'gull-1' : 'gull-0';
      g.image.setFrame(frame, false, false).setPosition(x, y).setRotation(heading);
      g.shadow.setFrame(frame, false, false).setPosition(x + SHADOW_DIR.x * 110, y + SHADOW_DIR.y * 110).setRotation(heading);
    });
  }

  // --- Sky and water --------------------------------------------------------------

  /** Sunlight glinting off the water here and there. */
  private updateSparkles(dt: number, view: Phaser.Geom.Rectangle): void {
    for (const s of this.sparkles) {
      s.life -= dt;
      if (s.life <= 0) {
        const x = view.x + this.rng.frac() * view.width;
        const y = view.y + this.rng.frac() * view.height;
        s.life = this.rng.realInRange(0.8, 1.8);
        s.image.setPosition(x, y).setVisible(!isLand(this.port, x, y)).setRotation(this.rng.realInRange(-0.3, 0.3));
      }
      s.image.setAlpha(Math.sin(Math.min(1, s.life / 1.8) * Math.PI) * 0.7);
    }
  }

  /** An image for a prop in its place, with a soft shadow. */
  private propImage(prop: Prop, frame: string, depth: number): Phaser.GameObjects.Image {
    const image = this.scene.add.image(prop.x, prop.y, DECO_TEXTURE, frame).setRotation(prop.angle).setDepth(depth);
    this.scene.add
      .image(prop.x + SHADOW_DIR.x * 5, prop.y + SHADOW_DIR.y * 5, DECO_TEXTURE, frame)
      .setRotation(prop.angle)
      .setTint(0x000000)
      .setAlpha(0.25)
      .setDepth(this.depths.ground - 0.095);
    return image;
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
