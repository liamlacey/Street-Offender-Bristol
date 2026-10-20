import type * as Phaser from 'phaser';
import type { Perspective } from '../world/perspective';
import { Surface, type SurfaceGrid } from '../world/surface';
import { ART_SCALE, canvasTexture } from './art';

/** At most this many ripples and glints on the water at once (they're only ever where you can see). */
const MOST = 150;
/** About how many there are per square px of water in view. */
const DENSITY = 1 / 2600;
/** How long each lasts, s (it fades in and out again). */
const LIFE: [number, number] = [2.2, 4.5];
/** Which way the wind's blowing them, and how fast, px/s. */
const WIND = { x: Math.cos(0.35) * 3, y: Math.sin(0.35) * 3 };

interface Ripple {
  image: Phaser.GameObjects.Image;
  x: number;
  y: number;
  age: number;
  life: number;
  /** How bright it gets at its brightest. */
  peak: number;
}

/**
 * The water moving: faint ripples drifting across it with the wind, and the
 * odd glint of light, each fading in and out again, scattered over the water
 * in view (the harbour, the fountains' pools). Only what can be seen is kept
 * going, so it costs next to nothing.
 */
export class WaterRipples {
  private readonly ripples: Ripple[] = [];
  private readonly free: Phaser.GameObjects.Image[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private surfaces: SurfaceGrid,
    /** The height of the ground (the water) under a point, px. */
    private readonly base: (x: number, y: number) => number,
    private readonly depth: number,
  ) {
    canvasTexture(scene, 'ripple', 12, 4, (ctx) => {
      ctx.strokeStyle = 'rgba(205,232,245,1)';
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(1, 3);
      ctx.quadraticCurveTo(6, 0.4, 11, 3);
      ctx.stroke();
    });
    canvasTexture(scene, 'glint', 4, 4, (ctx) => {
      const g = ctx.createRadialGradient(2, 2, 0, 2, 2, 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 4);
    });
  }

  /** The next region's surfaces (see streamer.ts). */
  use(surfaces: SurfaceGrid): void {
    this.surfaces = surfaces;
  }

  private wet(x: number, y: number): boolean {
    const s = this.surfaces.at(x, y);
    return s === Surface.Deep || s === Surface.Pool;
  }

  update(view: Phaser.Geom.Rectangle, perspective: Perspective, dt: number): void {
    // Those gone, or out of sight, go back for another time.
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.age += dt;
      r.x += WIND.x * dt;
      r.y += WIND.y * dt;
      const out = r.x < view.left - 20 || r.x > view.right + 20 || r.y < view.top - 20 || r.y > view.bottom + 20;
      if (r.age >= r.life || out || !this.wet(r.x, r.y)) {
        r.image.setVisible(false);
        this.free.push(r.image);
        this.ripples.splice(i, 1);
        continue;
      }
      // Fading in, and out again.
      const t = r.age / r.life;
      const s = perspective.lift(this.base(r.x, r.y));
      r.image.setPosition(perspective.x(r.x, s), perspective.y(r.y, s)).setAlpha(r.peak * Math.sin(Math.PI * t) ** 2);
    }
    // New ones where there's water in view, as many as there's water for: found by looking at random spots.
    const want = Math.min(MOST, view.width * view.height * DENSITY);
    for (let tries = 0; tries < 16 && this.ripples.length < want; tries++) {
      const x = view.left + Math.random() * view.width;
      const y = view.top + Math.random() * view.height;
      if (!this.wet(x, y)) continue;
      const glint = Math.random() < 0.18;
      const image = (this.free.pop() ?? this.scene.add.image(0, 0, 'ripple').setDepth(this.depth))
        .setTexture(glint ? 'glint' : 'ripple')
        .setVisible(true)
        .setAlpha(0)
        .setRotation(glint ? 0 : 0.35 + (Math.random() - 0.5) * 0.5)
        .setScale((glint ? 0.6 + Math.random() * 0.6 : 0.7 + Math.random() * 0.8) / ART_SCALE);
      const life = LIFE[0] + Math.random() * (LIFE[1] - LIFE[0]);
      // Already part way through its life, at first, so they don't all come in together.
      this.ripples.push({ image, x, y, age: this.ripples.length < want / 2 ? Math.random() * life * 0.5 : 0, life: glint ? life * 0.4 : life, peak: glint ? 0.55 : 0.28 + Math.random() * 0.17 });
    }
  }
}
