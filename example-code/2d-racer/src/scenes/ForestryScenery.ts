import * as Phaser from 'phaser';
import { type Prop, WORKSITE, type Worksite } from '../track/decoration';
import type { Vec2 } from '../track/Track';
import type { ChunkLayers } from './ChunkLayers';
import { DECO_TEXTURE } from './decorationArt';
import type { DecorationDepths } from './Decorations';
import { DOCKER_VESTS } from './portArt';
import { HARVESTER_ARM, LOADER_BOOM } from './woodsArt';

/** Light from the top left, as for the cars. */
const SHADOW = { x: 0.62 * 4, y: 0.78 * 4 };
const WORKER_SCALE = 1.4;
/** How far the lorry's bed sits behind its middle, px. */
const BED_BACK = 9;
/** Timber lorry speeds, px/s: backing in, and pulling away loaded. */
const REVERSE_SPEED = 42;
const DRIVE_SPEED = 58;
/** Seconds for each move of the loader's boom. */
const SWING = { out: 1.5, grab: 0.6, back: 1.7, drop: 0.5 };

/** A forester at work with a chainsaw, sawdust flying while it bites. */
interface Feller {
  image: Phaser.GameObjects.Image;
  saw: Phaser.GameObjects.Image;
  heading: number;
  phase: number;
}

/** Someone walking back and forth between two places. */
interface Walker {
  image: Phaser.GameObjects.Image;
  frame: string;
  from: Vec2;
  to: Vec2;
  t: number;
  dir: 1 | -1;
  pause: number;
}

/** A worksite: the loader filling timber lorries that come and go down the track, and the harvester felling. */
interface Site {
  site: Prop;
  /** How far down the track the lorry has to go to be out of sight, px. */
  away: number;
  lorry: Phaser.GameObjects.Image;
  lorryShadow: Phaser.GameObjects.Image;
  load: Phaser.GameObjects.Image;
  state: 'arriving' | 'loading' | 'leaving' | 'gone';
  /** How far the lorry is from its parking place down the track, px. */
  d: number;
  /** Thirds of a load on the lorry. */
  stage: number;
  /** Seconds left out of sight before the next lorry comes. */
  wait: number;
  boom: Phaser.GameObjects.Image;
  grapple: Phaser.GameObjects.Image;
  pivot: Vec2;
  /** The boom's angle in the site's own frame, and what it's doing. */
  angle: number;
  move: { kind: keyof typeof SWING | 'idle'; from: number; to: number; t: number };
  holding: boolean;
  /** Whether the bundle it's holding is going on the lorry. */
  forLorry: boolean;
  arm: Phaser.GameObjects.Image;
  head: Phaser.GameObjects.Image;
  armPivot: Vec2;
  phase: number;
}

/**
 * The forestry in the woods: worksites where a loader swings timber onto
 * lorries that back in down a logging track and pull away loaded, a
 * harvester felling at the treeline, and crews with chainsaws throwing up
 * sawdust, at the worksites and in clearings of their own.
 */
export class ForestryScenery {
  private readonly sites: Site[] = [];
  private readonly fellers: Feller[] = [];
  private readonly walkers: Walker[] = [];
  private readonly sawdust: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly rng: Phaser.Math.RandomDataGenerator;
  private sawdustDue = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    worksites: Worksite[],
    private readonly depths: DecorationDepths,
    private readonly chunks: ChunkLayers,
    private readonly smoke: (x: number, y: number) => void,
  ) {
    this.rng = new Phaser.Math.RandomDataGenerator(['forestry', `${worksites.length}`]);
    this.sawdust = scene.add
      .particles(0, 0, DECO_TEXTURE, {
        frame: 'chip',
        lifespan: { min: 400, max: 800 },
        speed: { min: 25, max: 70 },
        scale: { start: 1.2, end: 0.6 },
        alpha: { start: 1, end: 0 },
        emitting: false,
      })
      .setDepth(depths.props + 0.05);
    for (const w of worksites) this.addWorksite(w);
  }

  /** A felling crew in a clearing of its own. */
  addFellers(prop: Prop): void {
    this.ground(prop, 'clearing', 0, 0, prop.w, prop.h);
    this.still(prop, `felled-${prop.variant}`, 0, 8, 0, this.depths.props, 5);
    this.addFeller(prop, -34, -12, Math.PI / 2);
    this.addFeller(prop, 22, 30, -Math.PI / 2);
  }

  update(time: number, dt: number, camera: Phaser.Cameras.Scene2D.Camera): void {
    const view = camera.worldView;
    const near = (x: number, y: number, margin: number) =>
      x > view.left - margin && x < view.right + margin && y > view.top - margin && y < view.bottom + margin;
    this.sawdustDue -= dt;
    const spray = this.sawdustDue <= 0;
    if (spray) this.sawdustDue = 0.05;

    for (const s of this.sites) {
      this.updateLorry(s, dt);
      this.updateLoader(s, dt);
      const seen = near(s.site.x, s.site.y, 500);
      if (!seen) continue;
      // The harvester's arm sweeps along the treeline, stopping to fell at either end.
      const sweep = Math.sin(time / 2400 + s.phase);
      const armAngle = s.site.angle + Math.PI / 2 + 0.75 * Math.sign(sweep) * Math.min(1, Math.abs(sweep) * 1.6);
      s.arm.setRotation(armAngle);
      const head = { x: s.armPivot.x + Math.cos(armAngle) * HARVESTER_ARM.reach, y: s.armPivot.y + Math.sin(armAngle) * HARVESTER_ARM.reach };
      const felling = Math.abs(sweep) > 0.7;
      s.head.setPosition(head.x, head.y).setRotation(armAngle + (felling ? Math.sin(time / 40) * 0.12 : 0));
      if (spray && felling) this.sawdust.emitParticleAt(head.x, head.y, 2);
    }

    for (const f of this.fellers) {
      const cutting = Math.sin(time / 700 + f.phase) > -0.2;
      const lean = cutting ? Math.sin(time / 55 + f.phase) * 0.04 : Math.sin(time / 500 + f.phase) * 0.2;
      f.image.setRotation(f.heading + lean);
      f.saw.setRotation(f.heading + lean * 2);
      if (spray && cutting && near(f.saw.x, f.saw.y, 60)) {
        const tip = { x: f.saw.x + Math.cos(f.heading) * 8, y: f.saw.y + Math.sin(f.heading) * 8 };
        this.sawdust.emitParticleAt(tip.x, tip.y, 1);
      }
    }

    for (const w of this.walkers) this.updateWalker(w, time, dt);
  }

  private addWorksite({ site, trail }: Worksite): void {
    const { depths } = this;
    const { h } = site;
    // The cleared ground, and the track off the back of it.
    this.ground(site, 'clearing', 0, 0, site.w, site.h);
    const trailStart = h / 2 - 6;
    const trailEnd = h / 2 + 4 + trail;
    this.ground(site, 'trail', WORKSITE.trailU, (trailStart + trailEnd - 40) / 2, trailEnd - 40 - trailStart, 34, Math.PI / 2);
    this.ground(site, 'trail-end', WORKSITE.trailU, trailEnd - 20, 40, 34, Math.PI / 2);

    // A pile of timber waiting to go, felled trunks, the crew's pickup.
    this.still(site, `logstack-${this.rng.between(0, 1)}`, WORKSITE.pile.u, WORKSITE.pile.v, Math.PI / 2, depths.props, 4);
    this.still(site, 'felled-0', -100, -60, 0.08, depths.props, 5);
    this.still(site, 'felled-1', -118, -12, -0.1, depths.props, 5);
    this.still(site, `van-${this.rng.between(0, 2)}`, WORKSITE.pickup.u, WORKSITE.pickup.v, Math.PI, depths.props, 3);
    this.addFeller(site, -128, -82, Math.PI / 2);
    this.addFeller(site, -138, 12, -Math.PI / 2);
    this.addWalker(site, { x: 40, y: -56 }, { x: 0, y: -4 });

    // The harvester at the treeline, its arm reaching into the trees.
    this.still(site, 'harvester', WORKSITE.harvester.u, WORKSITE.harvester.v, Math.PI / 2, depths.props, 4);
    const armPivot = this.local(site, WORKSITE.harvester.u, WORKSITE.harvester.v + 24);
    const arm = this.scene.add
      .image(armPivot.x, armPivot.y, DECO_TEXTURE, 'harvester-arm')
      .setOrigin(HARVESTER_ARM.pivot / 52, 0.5)
      .setDepth(depths.props + 0.03);
    const head = this.scene.add.image(armPivot.x, armPivot.y, DECO_TEXTURE, 'harvester-head').setDepth(depths.props + 0.04);
    const exhaust = this.local(site, WORKSITE.harvester.u, WORKSITE.harvester.v - 26);
    this.smoke(exhaust.x, exhaust.y);

    // The loader, its boom turning on its tracks.
    this.still(site, 'loader-tracks', WORKSITE.loader.u, WORKSITE.loader.v, 0, depths.props, 3);
    const pivot = this.local(site, WORKSITE.loader.u, WORKSITE.loader.v);
    const boom = this.scene.add
      .image(pivot.x, pivot.y, DECO_TEXTURE, 'loader-top')
      .setOrigin(LOADER_BOOM.pivot / 88, 0.5)
      .setDepth(depths.props + 0.04);
    const grapple = this.scene.add.image(pivot.x, pivot.y, DECO_TEXTURE, 'grapple').setDepth(depths.props + 0.05);

    // The timber lorry, starting at some point in its round.
    const lorry = this.scene.add.image(0, 0, DECO_TEXTURE, 'logtruck').setDepth(depths.props + 0.01);
    const lorryShadow = this.scene.add.image(0, 0, DECO_TEXTURE, 'logtruck').setTint(0x000000).setAlpha(0.28).setDepth(depths.shadows);
    const load = this.scene.add.image(0, 0, DECO_TEXTURE, 'timber-1').setDepth(depths.props + 0.02).setVisible(false);
    const away = trailEnd - WORKSITE.lorry.v + 60;
    const start = this.rng.between(0, 2);
    const s: Site = {
      site,
      away,
      lorry,
      lorryShadow,
      load,
      state: (['arriving', 'loading', 'gone'] as const)[start],
      d: start === 0 ? this.rng.realInRange(0, away) : start === 1 ? 0 : away,
      stage: start === 1 ? this.rng.between(0, 2) : 0,
      wait: this.rng.realInRange(2, 6),
      boom,
      grapple,
      pivot,
      angle: this.pileAngle(),
      move: { kind: 'idle', from: 0, to: 0, t: 0 },
      holding: false,
      forLorry: false,
      arm,
      head,
      armPivot,
      phase: this.rng.frac() * 10,
    };
    s.move = { kind: 'idle', from: s.angle, to: s.angle, t: 0 };
    this.sites.push(s);
    this.placeLorry(s);
    this.placeBoom(s);
  }

  // --- The timber lorry and the loader ------------------------------------

  private updateLorry(s: Site, dt: number): void {
    if (s.state === 'arriving') {
      s.d = Math.max(0, s.d - REVERSE_SPEED * dt);
      if (s.d === 0) s.state = 'loading';
    } else if (s.state === 'leaving') {
      s.d += DRIVE_SPEED * Math.min(1, 0.3 + s.d / 60) * dt;
      if (s.d >= s.away) {
        s.state = 'gone';
        s.wait = this.rng.realInRange(4, 9);
      }
    } else if (s.state === 'gone') {
      s.wait -= dt;
      if (s.wait <= 0) {
        s.state = 'arriving';
        s.stage = 0;
      }
    }
    this.placeLorry(s);
  }

  private placeLorry(s: Site): void {
    const { site } = s;
    const at = this.local(site, WORKSITE.lorry.u, WORKSITE.lorry.v + s.d);
    const heading = site.angle + Math.PI / 2;
    // Fading out of sight at the far end of the track.
    const alpha = Phaser.Math.Clamp((s.away - s.d) / 70, 0, 1);
    const show = alpha > 0;
    s.lorry.setVisible(show).setPosition(at.x, at.y).setRotation(heading).setAlpha(alpha);
    s.lorryShadow.setVisible(show).setPosition(at.x + SHADOW.x, at.y + SHADOW.y).setRotation(heading).setAlpha(alpha * 0.28);
    const bed = { x: at.x - Math.cos(heading) * BED_BACK, y: at.y - Math.sin(heading) * BED_BACK };
    s.load.setVisible(show && s.stage > 0).setPosition(bed.x, bed.y).setRotation(heading).setAlpha(alpha);
    if (s.stage > 0) setFrame(s.load, `timber-${Math.min(3, s.stage)}`);
  }

  /** The boom's angle (in the site's frame) reaching the timber pile, give or take. */
  private pileAngle(): number {
    const dx = WORKSITE.pile.u - WORKSITE.loader.u;
    const dy = WORKSITE.pile.v - WORKSITE.loader.v;
    return Math.atan2(dy, dx) + this.rng.realInRange(-0.35, 0.35);
  }

  private lorryAngle(): number {
    const dx = WORKSITE.lorry.u - WORKSITE.loader.u;
    const dy = WORKSITE.lorry.v - BED_BACK - WORKSITE.loader.v;
    return Math.atan2(dy, dx) + this.rng.realInRange(-0.3, 0.3);
  }

  /**
   * While a lorry's in, the loader swings out to the pile, grabs a bundle,
   * swings back and drops it on; three loads fill it. Otherwise it tidies
   * the pile.
   */
  private updateLoader(s: Site, dt: number): void {
    const m = s.move;
    m.t += dt;
    const length = m.kind === 'idle' ? 2.2 : SWING[m.kind];
    const u = Math.min(1, m.t / length);
    const ease = u * u * (3 - 2 * u);
    s.angle = m.from + (m.to - m.from) * ease;
    if (u >= 1) {
      const loading = s.state === 'loading';
      const next = (kind: Site['move']['kind'], to: number) => {
        // Swing round the back, away from the road.
        let target = to;
        while (target - s.angle > Math.PI) target -= Math.PI * 2;
        while (target - s.angle < -Math.PI) target += Math.PI * 2;
        s.move = { kind, from: s.angle, to: target, t: 0 };
      };
      if (m.kind === 'out') {
        s.holding = true;
        next('grab', s.angle);
      } else if (m.kind === 'grab') {
        s.forLorry = loading;
        next('back', loading ? this.lorryAngle() : this.pileAngle());
      } else if (m.kind === 'back') {
        next('drop', s.angle);
      } else if (m.kind === 'drop') {
        s.holding = false;
        if (s.forLorry && loading) {
          s.stage++;
          if (s.stage >= 3) s.state = 'leaving';
        }
        next(loading ? 'out' : 'idle', this.pileAngle());
      } else {
        next(loading ? 'out' : this.rng.frac() < 0.5 ? 'out' : 'idle', this.pileAngle());
      }
    }
    this.placeBoom(s);
  }

  private placeBoom(s: Site): void {
    const angle = s.site.angle + s.angle;
    s.boom.setRotation(angle);
    const tip = { x: s.pivot.x + Math.cos(angle) * LOADER_BOOM.reach, y: s.pivot.y + Math.sin(angle) * LOADER_BOOM.reach };
    s.grapple.setPosition(tip.x, tip.y).setRotation(angle);
    setFrame(s.grapple, s.holding ? 'grapple-logs' : 'grapple');
  }

  // --- People -----------------------------------------------------------------

  private addFeller(prop: Prop, u: number, v: number, facing: number): void {
    const at = this.local(prop, u, v);
    const heading = prop.angle + facing;
    const vest = this.rng.between(0, DOCKER_VESTS - 1);
    const image = this.scene.add
      .image(at.x, at.y, DECO_TEXTURE, `docker-${vest}-s`)
      .setScale(WORKER_SCALE)
      .setRotation(heading)
      .setDepth(this.depths.props + 0.03);
    const hands = { x: at.x + Math.cos(heading) * 12, y: at.y + Math.sin(heading) * 12 };
    const saw = this.scene.add.image(hands.x, hands.y, DECO_TEXTURE, 'chainsaw').setRotation(heading).setDepth(this.depths.props + 0.035);
    this.fellers.push({ image, saw, heading, phase: this.rng.frac() * 10 });
  }

  private addWalker(prop: Prop, from: Vec2, to: Vec2): void {
    const a = this.local(prop, from.x, from.y);
    const b = this.local(prop, to.x, to.y);
    const frame = `docker-${this.rng.between(0, DOCKER_VESTS - 1)}`;
    const image = this.scene.add.image(a.x, a.y, DECO_TEXTURE, `${frame}-s`).setScale(WORKER_SCALE).setDepth(this.depths.props + 0.03);
    this.walkers.push({ image, frame, from: a, to: b, t: this.rng.frac(), dir: 1, pause: 0 });
  }

  private updateWalker(w: Walker, time: number, dt: number): void {
    const length = Math.hypot(w.to.x - w.from.x, w.to.y - w.from.y);
    if (w.pause > 0) {
      w.pause -= dt;
      setFrame(w.image, `${w.frame}-s`);
      return;
    }
    w.t += (w.dir * 30 * dt) / length;
    if (w.t >= 1 || w.t <= 0) {
      w.t = Phaser.Math.Clamp(w.t, 0, 1);
      w.dir = w.dir === 1 ? -1 : 1;
      w.pause = this.rng.realInRange(1.5, 5);
    }
    const heading = Math.atan2(w.to.y - w.from.y, w.to.x - w.from.x) + (w.dir === 1 ? 0 : Math.PI);
    w.image.setPosition(w.from.x + (w.to.x - w.from.x) * w.t, w.from.y + (w.to.y - w.from.y) * w.t).setRotation(heading);
    setFrame(w.image, `${w.frame}-${Math.floor(time / 260) % 2}`);
  }

  // --- Helpers ----------------------------------------------------------------

  /** Flat ground at a spot on a prop, stretched to w × h. */
  private ground(prop: Prop, frame: string, u: number, v: number, w: number, h: number, turn = 0): void {
    const at = this.local(prop, u, v);
    const image = this.scene.add.image(at.x, at.y, DECO_TEXTURE, frame).setDisplaySize(w, h).setRotation(prop.angle + turn);
    this.chunks.add(image, this.depths.ground);
  }

  /** Something that stays put, with its shadow `shadow` px long. */
  private still(prop: Prop, frame: string, u: number, v: number, turn: number, depth: number, shadow: number): Phaser.GameObjects.Image {
    const at = this.local(prop, u, v);
    const rotation = prop.angle + turn;
    const s = this.scene.add
      .image(at.x + (SHADOW.x / 4) * shadow, at.y + (SHADOW.y / 4) * shadow, DECO_TEXTURE, frame)
      .setRotation(rotation)
      .setTint(0x000000)
      .setAlpha(0.28);
    this.chunks.add(s, this.depths.shadows);
    return this.chunks.add(this.scene.add.image(at.x, at.y, DECO_TEXTURE, frame).setRotation(rotation), depth);
  }

  /** A point on a prop, `u` px along it and `v` px back from its centre. */
  private local(prop: Prop, u: number, v: number): Vec2 {
    const c = Math.cos(prop.angle);
    const s = Math.sin(prop.angle);
    return { x: prop.x + c * u - s * v, y: prop.y + s * u + c * v };
  }
}

function setFrame(image: Phaser.GameObjects.Image, frame: string): void {
  if (image.frame.name !== frame) image.setFrame(frame, false, false);
}
