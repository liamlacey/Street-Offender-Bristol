import * as Phaser from 'phaser';
import {
  CAR_LENGTH,
  CAR_WIDTH,
  type CarInput,
  type CarState,
  type SurfaceKind,
  forwardSpeed,
  lateralSpeed,
} from '../car/CarPhysics';
import type { SkidMarks } from './SkidMarks';
import { TEX } from './textures';

/** Wheel positions in the car's frame: x forward, y to the right. */
const REAR = -(CAR_LENGTH / 2 - 10);
const FRONT = CAR_LENGTH / 2 - 10;
const SIDE = CAR_WIDTH / 2 - 3;
const WHEELS: [number, number][] = [
  [REAR, -SIDE],
  [REAR, SIDE],
  [FRONT, -SIDE],
  [FRONT, SIDE],
];

const RUBBER = { color: 0x111111, alpha: 0.3, width: 4 };
const RUT = { color: 0x4a3b22, alpha: 0.32, width: 5 };
const DIRT_MARK = { color: 0x4f3a22, alpha: 0.3, width: 5 };
const MUD_RUT = { color: 0x2a1c10, alpha: 0.5, width: 6 };
/** Tracks pressed into packed snow, ploughed through deep snow, and scratched into ice. */
const SNOW_MARK = { color: 0x8796a3, alpha: 0.28, width: 5 };
const SNOW_RUT = { color: 0x7d8e9c, alpha: 0.45, width: 7 };
const ICE_MARK = { color: 0xffffff, alpha: 0.35, width: 2 };
/** Furrows ploughed through soft sand. */
const SAND_RUT = { color: 0x9c7a4c, alpha: 0.4, width: 7 };

/**
 * Tyre marks, smoke, dust, mud, spray and sparks for every car. Purely
 * visual: nothing here affects the physics.
 */
export class CarEffects {
  private readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly dirtDust: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly mud: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly spray: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly snow: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly sand: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly wake: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Where each wheel was last frame, if it was leaving a mark. */
  private readonly lastMark = new Map<CarState, ({ x: number; y: number } | null)[]>();

  constructor(
    scene: Phaser.Scene,
    private readonly skid: SkidMarks,
    depth: number,
  ) {
    this.smoke = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: 700,
        speed: { min: 5, max: 30 },
        scale: { start: 0.35, end: 1.3 },
        alpha: { start: 0.3, end: 0 },
        emitting: false,
      })
      .setDepth(depth);
    this.dust = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: 900,
        speed: { min: 10, max: 40 },
        scale: { start: 0.4, end: 1.5 },
        alpha: { start: 0.4, end: 0 },
        tint: 0xa58a5c,
        emitting: false,
      })
      .setDepth(depth);
    // A dirt road kicks up pale dust behind a fast car.
    this.dirtDust = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: 1300,
        speed: { min: 5, max: 30 },
        scale: { start: 0.5, end: 2.2 },
        alpha: { start: 0.28, end: 0 },
        tint: 0xc9ac80,
        emitting: false,
      })
      .setDepth(depth);
    this.mud = scene.add
      .particles(0, 0, TEX.spark, {
        lifespan: { min: 250, max: 600 },
        speed: { min: 60, max: 170 },
        scale: { start: 1.1, end: 0.4 },
        tint: [0x3b2a1a, 0x4a3420, 0x2a1c10],
        emitting: false,
      })
      .setDepth(depth);
    this.spray = scene.add
      .particles(0, 0, TEX.spark, {
        lifespan: { min: 200, max: 480 },
        speed: { min: 90, max: 220 },
        scale: { start: 0.9, end: 0.2 },
        alpha: { start: 0.9, end: 0 },
        tint: [0xffffff, 0xd8ecf5, 0xb5d4e2],
        emitting: false,
      })
      .setDepth(depth);
    // Snow thrown up from the wheels.
    this.snow = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: { min: 500, max: 1000 },
        speed: { min: 20, max: 70 },
        scale: { start: 0.35, end: 1.2 },
        alpha: { start: 0.75, end: 0 },
        tint: [0xffffff, 0xf0f6fa, 0xdfeaf1],
        emitting: false,
      })
      .setDepth(depth);
    // Sand sprayed up from the wheels, and a cloud of it hanging behind.
    this.sand = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: { min: 700, max: 1500 },
        speed: { min: 15, max: 60 },
        scale: { start: 0.45, end: 1.9 },
        alpha: { start: 0.45, end: 0 },
        tint: [0xe0c79c, 0xd4b886, 0xc9a874],
        emitting: false,
      })
      .setDepth(depth);
    // Rings spreading on the water where a car went through.
    this.wake = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: 800,
        speed: 0,
        scale: { start: 0.3, end: 1.6 },
        alpha: { start: 0.35, end: 0 },
        tint: 0xe6f2f7,
        emitting: false,
      })
      .setDepth(depth);
    this.sparks = scene.add
      .particles(0, 0, TEX.spark, {
        lifespan: { min: 120, max: 320 },
        speed: { min: 120, max: 320 },
        scale: { start: 1, end: 0 },
        tint: [0xffffff, 0xffd23f, 0xff8a00],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      })
      .setDepth(depth);
  }

  /** Call once per frame for each car with what it's driving on and its controls. */
  update(car: CarState, surface: SurfaceKind, input: CarInput): void {
    const speed = Math.hypot(car.vx, car.vy);
    const slide = Math.abs(lateralSpeed(car));
    const forward = forwardSpeed(car);
    const braking = input.brake > 0 && forward > 150;
    const onGrass = surface === 'grass' || surface === 'gravel';
    const wet = surface === 'water';
    const mud = surface === 'mud';
    const dirt = surface === 'dirt';
    const snow = surface === 'snow';
    const drift = surface === 'drift';
    const ice = surface === 'ice';
    const sand = surface === 'sand';

    // On the road: rubber (or on dirt, scuffs) when sliding or braking hard. On
    // grass, in mud and deep snow: ruts whenever moving. Packed snow keeps the
    // tracks of every car that's been by; ice just gets scratched. Water
    // leaves no marks.
    const rutting = onGrass || mud || drift || sand;
    const sliding = slide > 80 || braking || (input.handbrake && speed > 60);
    const rearMarks = !wet && (rutting ? speed > 40 : snow ? speed > 120 || sliding : sliding);
    const frontMarks = !wet && (rutting ? speed > 40 : braking);
    const style = mud ? MUD_RUT : drift ? SNOW_RUT : sand ? SAND_RUT : onGrass ? RUT : dirt ? DIRT_MARK : snow ? SNOW_MARK : ice ? ICE_MARK : RUBBER;

    const cos = Math.cos(car.heading);
    const sin = Math.sin(car.heading);
    const last = this.lastMark.get(car) ?? [null, null, null, null];
    WHEELS.forEach(([fx, sy], i) => {
      const marking = i < 2 ? rearMarks : frontMarks;
      if (!marking) {
        last[i] = null;
        return;
      }
      const x = car.x + cos * fx - sin * sy;
      const y = car.y + sin * fx + cos * sy;
      const prev = last[i];
      if (prev) this.skid.add(prev.x, prev.y, x, y, style.color, style.alpha, style.width);
      last[i] = { x, y };

      if (i < 2) {
        const hard = !onGrass && !wet && !mud && !dirt && !snow && !drift && !ice && !sand;
        if (hard && (slide > 140 || (braking && forward > 250)) && Math.random() < 0.6) {
          this.smoke.emitParticleAt(x, y, 1);
        }
        if (onGrass && speed > 80 && Math.random() < (surface === 'gravel' ? 0.9 : 0.5)) this.dust.emitParticleAt(x, y, 1);
        if (dirt && (speed > 260 || slide > 100) && Math.random() < 0.18 + slide / 900) this.dirtDust.emitParticleAt(x, y, 1);
        if (mud && speed > 70 && Math.random() < 0.7) this.mud.emitParticleAt(x, y, 2);
        if (sand && speed > 50 && Math.random() < 0.7) this.sand.emitParticleAt(x, y, 1);
        if (drift && speed > 50 && Math.random() < 0.8) this.snow.emitParticleAt(x, y, 2);
        if (snow && (speed > 280 || slide > 90) && Math.random() < 0.2 + slide / 700) this.snow.emitParticleAt(x, y, 1);
      }
    });
    // Water: spray off every wheel, and a wake spreading behind.
    if (wet && speed > 60) {
      if (Math.random() < 0.9) this.spray.emitParticleAt(car.x + (Math.random() - 0.5) * 20, car.y + (Math.random() - 0.5) * 20, 3);
      if (Math.random() < 0.35) this.wake.emitParticleAt(car.x - cos * 16, car.y - sin * 16, 1);
    }
    this.lastMark.set(car, last);
  }

  /** A shower of sparks at a hard contact, more for harder hits. */
  sparksAt(x: number, y: number, impulse: number): void {
    this.sparks.emitParticleAt(x, y, Math.round(Phaser.Math.Clamp(impulse / 50, 2, 16)));
  }

  /** Draws this frame's tyre marks. */
  flush(): void {
    this.skid.flush();
  }
}
