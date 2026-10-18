import * as Phaser from 'phaser';
import type { Prop } from '../track/decoration';
import type { Track, Vec2 } from '../track/Track';
import { type ChunkLayers, ChunkedGraphics } from '../scenes/ChunkLayers';
import { DECO_TEXTURE } from '../scenes/decorationArt';
import type { DecorationDepths } from '../scenes/Decorations';
import { JIB } from './art';
import type { Building, Downtown, Grounds, Signal } from './plan';
import { signal } from './street';
import { Traffic, type Vehicle, crossLights } from './traffic';
import { SIDE_STREET } from './city';
import { mulberry32 } from '../track/generate';
import { TEX } from '../scenes/textures';
import { TYRE_RADIUS } from '../track/barriers';

/** Light from the top left, as for the cars. */
const SHADOW_DIR = { x: 0.62, y: 0.78 };
/** How far each floor makes a building lean out from the middle of the view (as in the old top-down games). */
const LEAN_PER_FLOOR = 0.0042;
/** How far each floor's shadow reaches, px (and the most it does). */
const SHADOW_PER_FLOOR = 2.6;
const SHADOW_MAX = 170;

/** Walls, roof and the roof's rim for each building style: concrete, brick, glass, dark glass, sandstone, white. */
const STYLES: { wall: [number, number]; roof: number; rim: number; glass: boolean }[] = [
  { wall: [0x6b6f76, 0x7d828a], roof: 0x8d9096, rim: 0xa4a7ac, glass: false },
  { wall: [0x7a4634, 0x8d5640], roof: 0x6d4a3e, rim: 0x8a6656, glass: false },
  { wall: [0x35597c, 0x456c92], roof: 0x5d7c99, rim: 0x86a2bc, glass: true },
  { wall: [0x262b34, 0x323844], roof: 0x3b4250, rim: 0x59616f, glass: true },
  { wall: [0x8f7a58, 0xa48d68], roof: 0xb8a27e, rim: 0xcbb894, glass: false },
  { wall: [0xa8a8a2, 0xbdbdb6], roof: 0xd6d6d0, rim: 0xe8e8e2, glass: false },
];

/** Something on a roof, in the building's own coordinates (fractions of its width and depth). */
interface RoofThing {
  kind: 'box' | 'tank' | 'pad' | 'garden' | 'pool' | 'mast';
  u: number;
  v: number;
  w: number;
  h: number;
}

/** A building, ready to draw: its footprint, how far it leans, its look, roof things, and any upper tier. */
interface Tower {
  b: Building;
  lean: number;
  style: (typeof STYLES)[number];
  things: RoofThing[];
  tier: { u0: number; v0: number; u1: number; v1: number; lean: number } | null;
}

/** A tower crane slewing round between picks, the load swinging below its trolley. */
interface Crane {
  jib: Phaser.GameObjects.Image;
  load: Phaser.GameObjects.Image;
  angle: number;
  target: number;
  wait: number;
  reach: number;
}

/**
 * Draws a downtown round the track and brings it to life: the side streets
 * and their junctions, parks, plazas, car parks and building sites, and the
 * buildings, whose walls lean out from the middle of the view as it moves
 * so the towers stand up off the map, casting long shadows over the streets.
 */
export class CityScenery {
  private readonly towers: Tower[];
  private readonly buildings: Phaser.GameObjects.Graphics;
  private readonly cranes: Crane[] = [];
  private readonly sprays: Phaser.GameObjects.Image[] = [];
  /** Traffic lights over the race's road, and which junction each belongs to. */
  private readonly signals: { head: Phaser.GameObjects.Image; junction: number }[] = [];
  /** The city's own traffic lights, at its junctions off the race's route. */
  private readonly crossSignals: { head: Phaser.GameObjects.Image; junction: Downtown['city']['junctions'][number]; axis: 'ew' | 'ns' }[] = [];
  private readonly traffic: Traffic;
  private readonly cars: { v: Vehicle; sprite: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image }[] = [];
  /** Manholes on the side streets with steam rising from them. */
  private readonly vents: Vec2[] = [];
  private readonly steam: Phaser.GameObjects.Particles.ParticleEmitter;
  private steamDue = 0;
  private readonly rng: Phaser.Math.RandomDataGenerator;

  constructor(
    private readonly scene: Phaser.Scene,
    track: Track,
    downtown: Downtown,
    private readonly depths: DecorationDepths,
    private readonly chunks: ChunkLayers,
  ) {
    this.rng = new Phaser.Math.RandomDataGenerator([`${track.length}`, 'city']);
    this.drawGrounds(downtown.grounds);
    this.drawShadows(downtown.buildings);
    this.towers = downtown.buildings.map((b) => this.tower(b)).sort((a, b) => a.b.floors - b.b.floors);
    this.buildings = scene.add.graphics().setDepth(depths.overhead - 0.2);

    const closure = track.width / 2 + track.kerbWidth + (track.runOff ?? 0) + TYRE_RADIUS * 2;
    this.traffic = new Traffic(downtown.city, closure, mulberry32(Math.round(track.length)));
    for (const v of this.traffic.vehicles) {
      const frame = vehicleFrame(v, 0);
      const shadow = scene.add.image(v.x, v.y, DECO_TEXTURE, frame).setTint(0x000000).setAlpha(0.28).setDepth(depths.shadows);
      const sprite = scene.add.image(v.x, v.y, DECO_TEXTURE, frame).setDepth(depths.props);
      this.cars.push({ v, sprite, shadow });
    }
    this.addCrossSignals(downtown);
    for (const sig of downtown.signals) this.addSignal(sig);
    this.steam = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: 2600,
        speedX: { min: 6, max: 18 },
        speedY: { min: -14, max: -4 },
        scale: { start: 0.4, end: 1.8 },
        alpha: { start: 0.32, end: 0 },
        tint: 0xf2f2f2,
        emitting: false,
      })
      .setDepth(depths.overhead - 0.3);
    this.addVents(downtown);
  }

  /** Manholes out in the side streets, some of them steaming. */
  private addVents(downtown: Downtown): void {
    const g = new ChunkedGraphics(this.scene, this.chunks, this.depths.ground + 0.03);
    for (const street of downtown.city.streets) {
      if (street.onTrack || this.rng.frac() < 0.55) continue;
      const t = this.rng.realInRange(0.3, 0.7);
      const across = this.rng.realInRange(-40, 40);
      const x = street.a.x + (street.b.x - street.a.x) * t + (street.horizontal ? 0 : across);
      const y = street.a.y + (street.b.y - street.a.y) * t + (street.horizontal ? across : 0);
      g.fillStyle(0x2f3236).fillCircle(x, y, 9);
      g.fillStyle(0x55585e).fillCircle(x, y, 6.5);
      if (this.rng.frac() < 0.6) this.vents.push({ x, y });
    }
  }

  /** A city prop: a parked car, a fountain, a tower crane, a digger or a bench. */
  addProp(prop: Prop): void {
    const image = (frame: string, depth = this.depths.props) =>
      this.chunks.add(this.scene.add.image(prop.x, prop.y, DECO_TEXTURE, frame).setRotation(prop.angle), depth);
    const shadow = (frame: string, length: number) => {
      const s = this.scene.add
        .image(prop.x + SHADOW_DIR.x * length, prop.y + SHADOW_DIR.y * length, DECO_TEXTURE, frame)
        .setRotation(prop.angle)
        .setTint(0x000000)
        .setAlpha(0.28);
      this.chunks.add(s, this.depths.shadows);
    };
    switch (prop.kind) {
      case 'building':
        break;
      case 'parked':
        shadow(`parked-${prop.variant}`, 2.5);
        image(`parked-${prop.variant}`);
        break;
      case 'fountain': {
        image(`fountain-${prop.variant}`);
        const spray = this.scene.add.image(prop.x, prop.y, DECO_TEXTURE, 'spray-0').setDepth(this.depths.props + 0.05);
        this.sprays.push(spray);
        break;
      }
      case 'towercrane': {
        shadow('crane-mast', 6);
        image('crane-mast');
        const angle = this.rng.angle();
        const jib = this.scene.add
          .image(prop.x, prop.y, DECO_TEXTURE, 'crane-jib')
          .setOrigin(JIB.pivot / JIB.w, 0.5)
          .setRotation(angle)
          .setDepth(this.depths.overhead + 0.1);
        const load = this.scene.add.image(prop.x, prop.y, DECO_TEXTURE, 'crane-load').setDepth(this.depths.overhead + 0.05);
        this.cranes.push({ jib, load, angle, target: angle, wait: this.rng.realInRange(0, 4), reach: this.rng.realInRange(110, JIB.w - JIB.pivot - 20) });
        break;
      }
      default:
        shadow(`${prop.kind}-${prop.variant}`, 3);
        image(prop.kind === 'digger' || prop.kind === 'bench' ? prop.kind : `${prop.kind}-${prop.variant}`);
        break;
    }
  }

  /** Call once a frame with where the cars are. */
  update(time: number, dt: number, _cars: Vec2[], camera: Phaser.Cameras.Scene2D.Camera): void {
    const view = camera.worldView;
    this.drawBuildings(view);
    this.traffic.step(Math.min(dt, 0.1), time / 1000);
    for (const { v, sprite, shadow } of this.cars) {
      const show = v.x > view.left - 60 && v.x < view.right + 60 && v.y > view.top - 60 && v.y < view.bottom + 60;
      if (sprite.visible !== show) {
        sprite.setVisible(show);
        shadow.setVisible(show);
      }
      if (!show) continue;
      sprite.setPosition(v.x, v.y).setRotation(v.heading);
      shadow.setPosition(v.x + SHADOW_DIR.x * 3, v.y + SHADOW_DIR.y * 3).setRotation(v.heading);
      if (v.kind === 'police') {
        const frame = vehicleFrame(v, time);
        if (sprite.frame.name !== frame) sprite.setFrame(frame, false, false);
      }
    }
    this.steamDue -= dt;
    if (this.steamDue <= 0) {
      this.steamDue = 0.25;
      for (const v of this.vents) {
        if (v.x > view.left - 80 && v.x < view.right + 80 && v.y > view.top - 80 && v.y < view.bottom + 80) this.steam.emitParticleAt(v.x, v.y, 1);
      }
    }
    for (const { head, junction, axis } of this.crossSignals) {
      const lights = crossLights(junction, time / 1000);
      const frame = lights === axis ? 'signal-green' : 'signal-red';
      if (head.frame.name !== frame) head.setFrame(frame, false, false);
    }
    for (const spray of this.sprays) {
      const frame = `spray-${Math.floor(time / 140) % 3}`;
      if (spray.frame.name !== frame) spray.setFrame(frame, false, false);
    }
    for (const c of this.cranes) this.updateCrane(c, dt);
    for (const { head, junction } of this.signals) {
      const frame = `signal-${signal(junction, time / 1000)}`;
      if (head.frame.name !== frame) head.setFrame(frame, false, false);
    }
  }

  /**
   * Lights at the city's own junctions: one on the far right-hand corner for
   * each way in, facing the traffic coming.
   */
  private addCrossSignals(downtown: Downtown): void {
    const corner = SIDE_STREET.width / 2 + 14;
    for (const j of downtown.city.junctions) {
      if (j.onTrack) continue;
      // Each way in: the direction traffic comes from, and its axis.
      for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        // Traffic heading (ux, uy) sees its light on the far side, to its right.
        const x = j.x + ux * corner - uy * corner;
        const y = j.y + uy * corner + ux * corner;
        const pole = this.scene.add.image(x, y, DECO_TEXTURE, 'signal-pole').setScale(0.7);
        this.chunks.add(pole, this.depths.props);
        const arm = this.scene.add.image(x, y, DECO_TEXTURE, 'signal-arm').setOrigin(0, 0.5).setRotation(Math.atan2(-ux, uy)).setDisplaySize(52, 4);
        this.chunks.add(arm, this.depths.overhead);
        const head = this.scene.add
          // Hanging out over the lanes coming in, towards the street's middle.
          .image(x + uy * 48, y - ux * 48, DECO_TEXTURE, 'signal-red')
          .setScale(0.7)
          .setRotation(Math.atan2(uy, ux) + Math.PI / 2);
        this.chunks.add(head, this.depths.overhead);
        this.crossSignals.push({ head, junction: j, axis: ux !== 0 ? 'ew' : 'ns' });
      }
    }
  }

  /** A traffic light: its pole in line with the bollards and its arm out over the lanes coming in, the lights hanging off the end. */
  private addSignal(sig: Signal): void {
    const { x, y, angle, reach } = sig;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const pole = this.scene.add.image(x, y, DECO_TEXTURE, 'signal-pole');
    this.chunks.add(pole, this.depths.props);
    const arm = this.scene.add.image(x, y, DECO_TEXTURE, 'signal-arm').setOrigin(0, 0.5).setRotation(angle).setDisplaySize(reach, 6);
    this.chunks.add(arm, this.depths.overhead);
    const shadow = this.scene.add
      .image(x + SHADOW_DIR.x * 14, y + SHADOW_DIR.y * 14, DECO_TEXTURE, 'signal-arm')
      .setOrigin(0, 0.5)
      .setRotation(angle)
      .setDisplaySize(reach, 6)
      .setTint(0x000000)
      .setAlpha(0.22);
    this.chunks.add(shadow, this.depths.roadShadow);
    const head = this.scene.add.image(x + c * (reach - 14), y + s * (reach - 14), DECO_TEXTURE, 'signal-green').setRotation(angle);
    this.chunks.add(head, this.depths.overhead + 0.01);
    this.signals.push({ head, junction: sig.junction });
  }

  private updateCrane(c: Crane, dt: number): void {
    if (c.wait > 0) c.wait -= dt;
    else {
      const step = 0.25 * dt;
      const d = Phaser.Math.Angle.Wrap(c.target - c.angle);
      if (Math.abs(d) <= step) {
        c.angle = c.target;
        c.wait = this.rng.realInRange(2, 6);
        c.target = this.rng.angle();
        c.reach = this.rng.realInRange(110, JIB.w - JIB.pivot - 20);
      } else c.angle += Math.sign(d) * step;
    }
    c.jib.setRotation(c.angle);
    c.load.setPosition(c.jib.x + Math.cos(c.angle) * c.reach, c.jib.y + Math.sin(c.angle) * c.reach).setRotation(c.angle + Math.PI / 2);
  }

  // --- Ground --------------------------------------------------------------

  /** Parks' lawns and paths, plazas' paving, car parks' tarmac and bays, building sites' mud. */
  private drawGrounds(grounds: Grounds[]): void {
    const g = new ChunkedGraphics(this.scene, this.chunks, this.depths.ground + 0.05);
    for (const r of grounds) {
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      const cx = r.x0 + w / 2;
      const cy = r.y0 + h / 2;
      if (r.kind === 'park') {
        g.fillStyle(0x5a8f3e).fillRect(r.x0, r.y0, w, h);
        g.fillStyle(0x649a46);
        for (let x = r.x0; x < r.x1; x += 48) g.fillRect(x, r.y0, Math.min(24, r.x1 - x), h);
        // Paths crossing it and round the fountain.
        g.fillStyle(0xcfc6b0);
        g.fillRect(r.x0, cy - 9, w, 18);
        g.fillRect(cx - 9, r.y0, 18, h);
        g.fillCircle(cx, cy, 70);
      } else if (r.kind === 'plaza') {
        g.fillStyle(0xc9c2b2).fillRect(r.x0, r.y0, w, h);
        g.fillStyle(0xbab3a3);
        for (let x = r.x0; x < r.x1; x += 40) for (let y = r.y0 + ((x - r.x0) % 80 === 0 ? 0 : 20); y < r.y1; y += 40) g.fillRect(x, y, Math.min(20, r.x1 - x), Math.min(20, r.y1 - y));
        g.fillStyle(0xa79f8e);
        g.fillCircle(cx, cy, 64);
      } else if (r.kind === 'parking') {
        g.fillStyle(0x4f5258).fillRect(r.x0, r.y0, w, h);
      } else {
        g.fillStyle(0x7a6449).fillRect(r.x0, r.y0, w, h);
        g.fillStyle(0x6a5640);
        for (let k = 0; k < (w * h) / 6000; k++) g.fillCircle(r.x0 + this.rng.frac() * w, r.y0 + this.rng.frac() * h, 8 + this.rng.frac() * 16);
        // Hoarding round the edge.
        g.fillStyle(0x2f5a8a);
        g.fillRect(r.x0, r.y0, w, 4).fillRect(r.x0, r.y1 - 4, w, 4).fillRect(r.x0, r.y0, 4, h).fillRect(r.x1 - 4, r.y0, 4, h);
      }
    }
  }

  /** Each building's shadow on the ground, longer the taller it is, falling over the streets. */
  private drawShadows(buildings: Building[]): void {
    const g = new ChunkedGraphics(this.scene, this.chunks, this.depths.roadShadow);
    g.fillStyle(0x000000, 0.24);
    for (const b of buildings) {
      const l = Math.min(SHADOW_MAX, b.floors * SHADOW_PER_FLOOR);
      const dx = SHADOW_DIR.x * l;
      const dy = SHADOW_DIR.y * l;
      // The outline of the footprint swept along the light: a six-sided shape, fanned from its top-left corner.
      const pts = [
        [b.x0, b.y0],
        [b.x1, b.y0],
        [b.x1 + dx, b.y0 + dy],
        [b.x1 + dx, b.y1 + dy],
        [b.x0 + dx, b.y1 + dy],
        [b.x0, b.y1],
      ];
      for (let k = 1; k < pts.length - 1; k++) g.fillTriangle(pts[0][0], pts[0][1], pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]);
    }
  }

  // --- Buildings ----------------------------------------------------------

  /** Works out how a building looks: roof things by height, and a stepped top on some towers. */
  private tower(b: Building): Tower {
    const rand = new Phaser.Math.RandomDataGenerator([`${b.seed}`]);
    const things: RoofThing[] = [];
    const add = (kind: RoofThing['kind'], w: number, h: number) => {
      things.push({ kind, u: rand.realInRange(0.1, 0.9 - w), v: rand.realInRange(0.1, 0.9 - h), w, h });
    };
    const width = b.x1 - b.x0;
    const depth = b.y1 - b.y0;
    // Roof things are sized in px, as fractions of this building.
    const size = (px: number, of: number) => Math.min(0.35, px / of);
    let tier: Tower['tier'] = null;
    if (b.floors >= 26 && rand.frac() < 0.5) {
      const inset = rand.realInRange(0.15, 0.28);
      tier = { u0: inset, v0: inset, u1: 1 - inset, v1: 1 - inset, lean: (b.floors + rand.between(3, 8)) * LEAN_PER_FLOOR };
    }
    if (b.floors >= 26 && !tier && rand.frac() < 0.5) things.push({ kind: 'pad', u: 0.5 - size(70, width) / 2, v: 0.5 - size(70, depth) / 2, w: size(70, width), h: size(70, depth) });
    if (b.floors < 10 && rand.frac() < 0.35) add('tank', size(26, width), size(26, depth));
    if (b.floors >= 9 && b.floors < 26 && rand.frac() < 0.15) add('pool', size(60, width), size(30, depth));
    if (b.floors < 26 && rand.frac() < 0.2) add('garden', size(60, width), size(45, depth));
    if (b.floors >= 26 && rand.frac() < 0.6) things.push({ kind: 'mast', u: 0.5, v: 0.5, w: 0, h: 0 });
    for (let k = rand.between(1, 4); k > 0; k--) add('box', size(rand.between(12, 30), width), size(rand.between(10, 22), depth));
    return { b, lean: b.floors * LEAN_PER_FLOOR, style: STYLES[b.style], things, tier };
  }

  /** Redraws the buildings near the view, leaning out from its middle. */
  private drawBuildings(view: Phaser.Geom.Rectangle): void {
    const g = this.buildings;
    g.clear();
    const cx = view.centerX;
    const cy = view.centerY;
    const pad = 40;
    for (const t of this.towers) {
      const { b } = t;
      // How far out the roof is: the footprint pushed away from the middle of the view.
      const out = (x: number, y: number, lean: number) => ({ x: cx + (x - cx) * (1 + lean), y: cy + (y - cy) * (1 + lean) });
      const r0 = out(b.x0, b.y0, t.lean);
      const r1 = out(b.x1, b.y1, t.lean);
      if (Math.max(b.x1, r1.x) < view.left - pad || Math.min(b.x0, r0.x) > view.right + pad) continue;
      if (Math.max(b.y1, r1.y) < view.top - pad || Math.min(b.y0, r0.y) > view.bottom + pad) continue;
      this.drawBox(g, t, b.x0, b.y0, b.x1, b.y1, 0, t.lean, b.floors);
      const roofColor = t.style.roof;
      const rx0 = r0.x;
      const ry0 = r0.y;
      const rw = r1.x - r0.x;
      const rh = r1.y - r0.y;
      // The roof, with a rim round its edge.
      g.fillStyle(t.style.rim).fillRect(rx0, ry0, rw, rh);
      const rim = 4 * (1 + t.lean);
      g.fillStyle(roofColor).fillRect(rx0 + rim, ry0 + rim, rw - rim * 2, rh - rim * 2);
      const roof = (u: number, v: number) => ({ x: rx0 + u * rw, y: ry0 + v * rh });
      for (const th of t.things) {
        const p = roof(th.u, th.v);
        const w = th.w * rw;
        const h = th.h * rh;
        if (th.kind === 'box') {
          g.fillStyle(0x000000, 0.2).fillRect(p.x + 2, p.y + 3, w, h);
          g.fillStyle(0x9a9ea5).fillRect(p.x, p.y, w, h);
          g.fillStyle(0xb5b9bf).fillRect(p.x + 2, p.y + 2, w - 4, h / 2 - 2);
        } else if (th.kind === 'tank') {
          // A wooden water tank on legs.
          const r = Math.min(w, h) / 2;
          g.fillStyle(0x000000, 0.22).fillCircle(p.x + r + 3, p.y + r + 4, r);
          g.fillStyle(0x6b4a2b).fillCircle(p.x + r, p.y + r, r);
          g.fillStyle(0x8a6440).fillCircle(p.x + r, p.y + r, r * 0.75);
          g.fillStyle(0x4e341d).fillCircle(p.x + r, p.y + r, r * 0.2);
        } else if (th.kind === 'pad') {
          // A helipad: a dark circle with a big H.
          const r = Math.min(w, h) / 2;
          const c = { x: p.x + w / 2, y: p.y + h / 2 };
          g.fillStyle(0x2b2d31).fillCircle(c.x, c.y, r);
          g.fillStyle(0xf2c230).fillCircle(c.x, c.y, r * 0.86);
          g.fillStyle(0x2b2d31).fillCircle(c.x, c.y, r * 0.78);
          g.fillStyle(0xf4f4f4);
          g.fillRect(c.x - r * 0.35, c.y - r * 0.4, r * 0.16, r * 0.8);
          g.fillRect(c.x + r * 0.19, c.y - r * 0.4, r * 0.16, r * 0.8);
          g.fillRect(c.x - r * 0.35, c.y - r * 0.07, r * 0.7, r * 0.14);
        } else if (th.kind === 'garden') {
          g.fillStyle(0x4f7f38).fillRect(p.x, p.y, w, h);
          g.fillStyle(0x3d6a2b);
          for (let k = 0; k < 4; k++) g.fillCircle(p.x + ((k * 0.27 + 0.12) % 1) * w, p.y + ((k * 0.41 + 0.3) % 1) * h, Math.min(w, h) * 0.18);
        } else if (th.kind === 'pool') {
          g.fillStyle(0xd8d2c4).fillRect(p.x - 4, p.y - 4, w + 8, h + 8);
          g.fillStyle(0x3fa7d6).fillRect(p.x, p.y, w, h);
          g.fillStyle(0x7fcbea).fillRect(p.x + 2, p.y + 2, w - 4, h * 0.3);
        } else if (th.kind === 'mast') {
          const c = roof(0.5, 0.5);
          g.fillStyle(0x3d4148).fillCircle(c.x, c.y, 5);
          g.fillStyle(0xd7263d).fillCircle(c.x, c.y, 2.5);
        }
      }
      if (t.tier) {
        // A stepped top: a narrower block standing on the roof.
        const { u0, v0, u1, v1, lean } = t.tier;
        const base0 = { x: b.x0 + u0 * (b.x1 - b.x0), y: b.y0 + v0 * (b.y1 - b.y0) };
        const base1 = { x: b.x0 + u1 * (b.x1 - b.x0), y: b.y0 + v1 * (b.y1 - b.y0) };
        this.drawBox(g, t, base0.x, base0.y, base1.x, base1.y, t.lean, lean, 6);
        const q0 = out(base0.x, base0.y, lean);
        const q1 = out(base1.x, base1.y, lean);
        g.fillStyle(t.style.rim).fillRect(q0.x, q0.y, q1.x - q0.x, q1.y - q0.y);
        g.fillStyle(roofColor).fillRect(q0.x + rim, q0.y + rim, q1.x - q0.x - rim * 2, q1.y - q0.y - rim * 2);
      }
    }
  }

  /**
   * The walls of a box standing on (x0, y0)-(x1, y1), from `leanBase` (its
   * foot) up to `leanTop`: just the walls facing the middle of the view, with
   * floors and windows marked on them.
   */
  private drawBox(g: Phaser.GameObjects.Graphics, t: Tower, x0: number, y0: number, x1: number, y1: number, leanBase: number, leanTop: number, floors: number): void {
    const view = this.scene.cameras.main.worldView;
    const cx = view.centerX;
    const cy = view.centerY;
    const out = (x: number, y: number, lean: number) => ({ x: cx + (x - cx) * (1 + lean), y: cy + (y - cy) * (1 + lean) });
    const [shadeX, shadeY] = t.style.wall;
    const wall = (a: Vec2, b: Vec2, color: number) => {
      const a0 = out(a.x, a.y, leanBase);
      const b0 = out(b.x, b.y, leanBase);
      const a1 = out(a.x, a.y, leanTop);
      const b1 = out(b.x, b.y, leanTop);
      g.fillStyle(color);
      g.fillTriangle(a0.x, a0.y, b0.x, b0.y, b1.x, b1.y);
      g.fillTriangle(a0.x, a0.y, b1.x, b1.y, a1.x, a1.y);
      // Floors across, and (on glass towers) the frames between the panes up the wall.
      const rows = Math.min(floors, 14);
      g.lineStyle(1, 0x000000, t.style.glass ? 0.18 : 0.28);
      for (let k = 1; k < rows; k++) {
        const f = k / rows;
        g.lineBetween(a0.x + (a1.x - a0.x) * f, a0.y + (a1.y - a0.y) * f, b0.x + (b1.x - b0.x) * f, b0.y + (b1.y - b0.y) * f);
      }
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      const cols = Math.floor(span / (t.style.glass ? 22 : 30));
      g.lineStyle(1, t.style.glass ? 0xffffff : 0x000000, t.style.glass ? 0.12 : 0.2);
      for (let k = 1; k < cols; k++) {
        const f = k / cols;
        g.lineBetween(a0.x + (b0.x - a0.x) * f, a0.y + (b0.y - a0.y) * f, a1.x + (b1.x - a1.x) * f, a1.y + (b1.y - a1.y) * f);
      }
    };
    // Only the walls you'd see: those facing the middle of the view.
    if (cx < x0) wall({ x: x0, y: y0 }, { x: x0, y: y1 }, shadeX);
    if (cx > x1) wall({ x: x1, y: y0 }, { x: x1, y: y1 }, shadeX);
    if (cy < y0) wall({ x: x0, y: y0 }, { x: x1, y: y0 }, shadeY);
    if (cy > y1) wall({ x: x0, y: y1 }, { x: x1, y: y1 }, shadeY);
  }
}

/** The picture for a vehicle of the city's traffic (a police car's lights flash). */
function vehicleFrame(v: Vehicle, time: number): string {
  switch (v.kind) {
    case 'car':
      return `parked-${v.look % 12}`;
    case 'taxi':
      return 'taxi';
    case 'van':
      return `van-${v.look % 3}`;
    case 'bus':
      return 'bus';
    case 'truck':
      return `truck-${v.look % 5}`;
    case 'police':
      return `police-${Math.floor(time / 250) % 2}`;
  }
}
