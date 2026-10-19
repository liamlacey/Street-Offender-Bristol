import type * as Phaser from 'phaser';
import type { Perspective } from '../world/perspective';
import type { Traffic, Vehicle } from '../world/traffic';
import { ART_SCALE } from './art';
import { forgetWreck, paintWreck } from './dentArt';
import { VEHICLES } from '../world/traffic';
import { bodyLayout, busTexture, vehicleShadow, vehicleTexture } from './vehicleArt';

/** How the traffic's drawn among everything else: on the ground and on the bridges, with you on one or the other. */
export interface TrafficDepths {
  /** You on the ground: those on the ground (just under your car), and those up on a bridge. */
  ground: number;
  onDeck: number;
  /** You on a bridge: those on the ground below it, and those on it with you. */
  below: number;
  beside: number;
}

/**
 * Draws the traffic and the parked cars near the view: each one's picture
 * and shadow, standing on the hills, with its brake lights when it's slowing
 * and its indicators flashing before it turns.
 */
export class TrafficLayer {
  /** Each one in view: its picture and shadow, and which version of its damage the picture shows. */
  private readonly sprites = new Map<Vehicle, { body: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; shown: number }>();
  private readonly lamps: [Phaser.GameObjects.Graphics, Phaser.GameObjects.Graphics];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly traffic: Traffic,
    /** The height of the ground (or the deck, on level 1) under a point, px. */
    private readonly base: (x: number, y: number, level: number) => number,
    /** Whether a point's at the end of a bridge, where its deck meets the road (within `reach` px). */
    private readonly atDeckEnd: (x: number, y: number, reach: number) => boolean,
    private readonly depths: TrafficDepths,
  ) {
    this.lamps = [scene.add.graphics(), scene.add.graphics()];
  }

  update(view: Phaser.Geom.Rectangle, perspective: Perspective, level: number, time: number): void {
    const pad = 60;
    const seen = new Set<Vehicle>();
    for (const g of this.lamps) g.clear();
    // Up on a bridge, or at the end of one (driving on or off it, where the deck meets the road): drawn with the deck, over it.
    const up = (v: Vehicle) => v.level === 1 || this.atDeckEnd(v.x, v.y, v.length / 2 + 4);
    const depthOf = (onDeck: boolean) => (level === 0 ? (onDeck ? this.depths.onDeck : this.depths.ground) : onDeck ? this.depths.beside : this.depths.below);
    this.lamps[0].setDepth(depthOf(false) + 0.01);
    this.lamps[1].setDepth(depthOf(true) + 0.01);
    for (const list of [this.traffic.parked, this.traffic.vehicles]) {
      for (const v of list) {
        if (v.x < view.left - pad || v.x > view.right + pad || v.y < view.top - pad || v.y > view.bottom + pad) continue;
        seen.add(v);
        let s = this.sprites.get(v);
        if (!s) {
          const shadow = this.scene.add.image(0, 0, vehicleShadow(this.scene, v.kind)).setScale(1 / ART_SCALE).setTint(0x000000).setAlpha(0.33);
          const body = this.scene.add.image(0, 0, (v.bus ? busTexture(this.scene, v.kind, v.bus.colour, v.bus.ref) : vehicleTexture(this.scene, v.kind, v.colour))).setScale(1 / ART_SCALE);
          s = { body, shadow, shown: 0 };
          this.sprites.set(v, s);
        }
        // Damaged: its own picture, with its dents and scratches.
        if (v.wreck && v.wreck.version !== s.shown) {
          s.shown = v.wreck.version;
          const key = `vehicle-dented-${v.id}`;
          paintWreck(this.scene, key, { base: (v.bus ? busTexture(this.scene, v.kind, v.bus.colour, v.bus.ref) : vehicleTexture(this.scene, v.kind, v.colour)), length: VEHICLES[v.kind].length, width: VEHICLES[v.kind].width, mirror: bodyLayout(v.kind).mirror }, v.wreck);
          s.body.setTexture(key);
        // Its shadow the shape it is now (crumpled in, parts gone).
        s.shadow.setTexture(key);
        }
        const lift = perspective.lift(this.base(v.x, v.y, v.level));
        const [x, y] = [perspective.x(v.x, lift), perspective.y(v.y, lift)];
        const onDeck = up(v);
        const d = depthOf(onDeck);
        s.body.setPosition(x, y).setRotation(v.angle).setDepth(d);
        // Taller, the further its shadow falls.
        const fall = v.kind === 'lorry' ? 1.8 : v.kind === 'van' || v.kind === 'suv' ? 1.3 : 1;
        s.shadow.setPosition(x + 2.5 * fall, y + 3.5 * fall).setRotation(v.angle).setDepth(d - 0.02);
        this.drawLamps(this.lamps[onDeck ? 1 : 0], v, x, y, time);
      }
    }
    // Gone, or out of sight.
    for (const [v, s] of this.sprites) {
      if (seen.has(v)) continue;
      s.body.destroy();
      s.shadow.destroy();
      forgetWreck(this.scene, `vehicle-dented-${v.id}`);
      this.sprites.delete(v);
    }
  }

  /** Brake lights (red, at the back corners) and an indicator (amber, front and back on the side it's turning). */
  private drawLamps(g: Phaser.GameObjects.Graphics, v: Vehicle, x: number, y: number, time: number): void {
    // Hazard lights: limping, broken down, or a parked car's alarm going off (flashing quicker).
    const hazards = v.limping || v.broken || v.alarm > 0;
    if (v.mode === 'parked' && !hazards) return;
    const [cx, cy] = [Math.cos(v.angle), Math.sin(v.angle)];
    // Left of the way it's pointing (y down): (sin, -cos).
    const [lx, ly] = [cy, -cx];
    const back = v.length / 2 - 0.8;
    const side = v.r - 1.6;
    if (v.braking) {
      g.fillStyle(0xff2a1f, 0.95);
      for (const k of [-1, 1]) g.fillCircle(x - cx * back + lx * side * k, y - cy * back + ly * side * k, 1.5);
    }
    // Each its own indicators' timing (a little quicker or slower, and out of step with the rest); an alarm's flashing quicker.
    const period = v.alarm > 0 ? 0.5 : 0.68 + ((v.id * 37) % 23) / 100;
    const flash = ((time + ((v.id * 0.618) % 1) * period) % period) < period * 0.55;
    if ((v.turning || hazards) && flash) {
      g.fillStyle(0xffa424, 1);
      for (const k of hazards ? [1, -1] : [v.turning === -1 ? 1 : -1]) {
        for (const along of [back, -back]) g.fillCircle(x + cx * along + lx * (side + 0.6) * k, y + cy * along + ly * (side + 0.6) * k, 1.3);
      }
    }
  }
}
