import * as Phaser from 'phaser';
import { CAR_LENGTH, CAR_WIDTH, type CarInput, type CarState, type SurfaceKind, forwardSpeed, lateralSpeed } from '../car/CarPhysics';
import { TEX } from './art';
import type { Material } from '../world/damage';
import type { SkidMarks } from './SkidMarks';

/** Wheel positions in the car's frame: x forward, y to the right. */
const REAR = -(CAR_LENGTH / 2 - 8);
const FRONT = CAR_LENGTH / 2 - 9;
const SIDE = CAR_WIDTH / 2 - 2.5;
const WHEELS: [number, number][] = [
  [REAR, -SIDE],
  [REAR, SIDE],
  [FRONT, -SIDE],
  [FRONT, SIDE],
];

const RUBBER = { color: 0x111111, alpha: 0.32, width: 3 };
const TURF = { color: 0x3a2c1a, alpha: 0.35, width: 4 };
const SOIL = { color: 0x2a1c10, alpha: 0.45, width: 4 };

/**
 * Tyre marks, tyre smoke, flying turf, spray and sparks. Purely visual:
 * nothing here affects the physics. (Adapted from 2D Racer's CarEffects.)
 */
export class CarEffects {
  private readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly turf: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly spray: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  /** What flies off things as they break. */
  private readonly dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly leaves: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly splinters: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly glass: Phaser.GameObjects.Particles.ParticleEmitter;
  private lastMark: ({ x: number; y: number } | null)[] = [null, null, null, null];

  constructor(
    scene: Phaser.Scene,
    private readonly skid: SkidMarks,
    depth: number,
  ) {
    this.smoke = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: 800,
        speed: { min: 5, max: 25 },
        scale: { start: 0.9, end: 2.6 },
        alpha: { start: 0.35, end: 0 },
        tint: 0xdedede,
        emitting: false,
      })
      .setDepth(depth);
    this.turf = scene.add
      .particles(0, 0, TEX.spark, {
        lifespan: { min: 250, max: 550 },
        speed: { min: 40, max: 120 },
        scale: { start: 1.2, end: 0.4 },
        tint: [0x3f6b2c, 0x4e3a2a, 0x5b8a3c],
        emitting: false,
      })
      .setDepth(depth);
    this.spray = scene.add
      .particles(0, 0, TEX.spark, {
        lifespan: { min: 250, max: 600 },
        speed: { min: 60, max: 180 },
        scale: { start: 1.3, end: 0.3 },
        alpha: { start: 0.9, end: 0 },
        tint: [0xffffff, 0xd8ecf5, 0xb5d4e2],
        emitting: false,
      })
      .setDepth(depth + 0.1);
    this.sparks = scene.add
      .particles(0, 0, TEX.spark, {
        lifespan: { min: 120, max: 320 },
        speed: { min: 80, max: 260 },
        scale: { start: 0.9, end: 0.1 },
        tint: [0xfff1a8, 0xffb347, 0xffffff],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      })
      .setDepth(depth + 0.1);
    this.dust = scene.add
      .particles(0, 0, TEX.puff, {
        lifespan: { min: 900, max: 1800 },
        speed: { min: 10, max: 60 },
        scale: { start: 0.8, end: 2.6 },
        alpha: { start: 0.55, end: 0 },
        tint: [0xb3a690, 0x9a8f80, 0xc9bfae],
        emitting: false,
      })
      .setDepth(depth + 0.2);
    const bits = (tint: number[], lifespan: number, speed: number) =>
      scene.add
        .particles(0, 0, TEX.spark, {
          lifespan: { min: lifespan * 0.5, max: lifespan },
          speed: { min: speed * 0.3, max: speed },
          scale: { start: 1.3, end: 0.5 },
          rotate: { min: 0, max: 360 },
          tint,
          emitting: false,
        })
        .setDepth(depth + 0.2);
    this.leaves = bits([0x3f7a2e, 0x5b9a3e, 0x2f5e24, 0x7ab655], 1400, 110);
    this.splinters = bits([0x8f6038, 0x6b4527, 0xc79a62], 700, 180);
    this.glass = bits([0xdff3fb, 0xb5d4e2, 0xffffff], 600, 200);
  }

  /** Bits of something breaking, flying off: dust, leaves, splinters, glass, sparks, by what it's made of. */
  burst(material: Material, x: number, y: number, count: number): void {
    switch (material) {
      case 'stone':
        this.dust.emitParticleAt(x, y, count);
        break;
      case 'plant':
        this.leaves.emitParticleAt(x, y, count);
        break;
      case 'wood':
        this.leaves.emitParticleAt(x, y, count);
        this.splinters.emitParticleAt(x, y, Math.ceil(count / 2));
        break;
      case 'timber':
        this.splinters.emitParticleAt(x, y, count);
        break;
      case 'glass':
        this.glass.emitParticleAt(x, y, count);
        this.sparks.emitParticleAt(x, y, Math.ceil(count / 3));
        break;
      case 'electric':
      case 'metal':
      case 'iron':
        this.sparks.emitParticleAt(x, y, count);
        break;
      case 'plastic':
        this.splinters.emitParticleAt(x, y, Math.ceil(count / 2));
        break;
    }
  }

  /** Call once a frame with the car and what's under it. */
  update(car: CarState, input: CarInput, surface: SurfaceKind, dt: number): void {
    const vF = forwardSpeed(car);
    const vR = lateralSpeed(car);
    const speed = Math.hypot(car.vx, car.vy);
    const sliding = Math.abs(vR) > 70 || (input.handbrake && speed > 50);
    const locking = input.brake > 0 && vF > 120;
    const spinning = input.throttle > 0 && vF < 70 && vF > -5;
    const hard = surface === 'road' || surface === 'pavement';
    const soft = surface === 'grass' || surface === 'mud' || surface === 'dirt';
    const cos = Math.cos(car.heading);
    const sin = Math.sin(car.heading);
    WHEELS.forEach(([fx, fy], i) => {
      const x = car.x + cos * fx - sin * fy;
      const y = car.y + sin * fx + cos * fy;
      const rear = i < 2;
      const marking = (hard && (sliding || locking || (spinning && rear))) || (soft && speed > 30);
      const style = hard ? RUBBER : surface === 'grass' ? TURF : SOIL;
      const last = this.lastMark[i];
      if (marking && (rear || sliding || soft)) {
        if (last) this.skid.add(last.x, last.y, x, y, style.color, style.alpha, style.width);
        this.lastMark[i] = { x, y };
      } else {
        this.lastMark[i] = null;
      }
      if (!rear) return;
      if (hard && (sliding || (spinning && speed < 60 && input.throttle > 0)) && Math.random() < dt * 30) this.smoke.emitParticleAt(x, y, 1);
      if (soft && speed > 60 && Math.random() < dt * (speed / 12)) this.turf.emitParticleAt(x, y, 1);
      if (surface === 'water' && speed > 40 && Math.random() < dt * (speed / 6)) this.spray.emitParticleAt(x, y, 1);
    });
  }

  sparksAt(x: number, y: number, strength: number): void {
    this.sparks.emitParticleAt(x, y, Math.min(14, Math.floor(strength / 25)));
  }

  splashAt(x: number, y: number, count: number): void {
    this.spray.emitParticleAt(x, y, count);
  }

  /** Forget where the wheels were (after the car's been moved, so no mark joins the two places). */
  reset(): void {
    this.lastMark = [null, null, null, null];
  }
}
