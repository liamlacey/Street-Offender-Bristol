import * as Phaser from 'phaser';
import { DECO_TEXTURE } from './decorationArt';
import { PORT_VARIANTS } from './portArt';

/** Which way the clouds drift, and how fast (px/s). */
const WIND = { x: 14, y: 6 };
const CLOUDS = 6;

/**
 * Soft shadows of clouds drifting slowly over everything, cars included.
 * There are only a few, kept around the camera: one that drifts out of sight
 * comes round again upwind.
 */
export class CloudShadows {
  private readonly clouds: Phaser.GameObjects.Image[] = [];

  constructor(
    scene: Phaser.Scene,
    depth: number,
    private readonly rng: Phaser.Math.RandomDataGenerator,
  ) {
    for (let k = 0; k < CLOUDS; k++) {
      this.clouds.push(
        scene.add
          .image(0, 0, DECO_TEXTURE, `cloud-${k % PORT_VARIANTS.cloud}`)
          .setScale(rng.realInRange(3.5, 6))
          .setRotation(rng.frac() * Math.PI)
          .setTint(0x000000)
          .setAlpha(0.16)
          .setDepth(depth)
          .setVisible(false),
      );
    }
  }

  update(dt: number, view: Phaser.Geom.Rectangle): void {
    const margin = 700;
    for (const cloud of this.clouds) {
      const out =
        !cloud.visible ||
        cloud.x > view.right + margin ||
        cloud.x < view.left - margin * 1.5 ||
        cloud.y > view.bottom + margin ||
        cloud.y < view.top - margin * 1.5;
      if (out) {
        // Anywhere around the view to start with; after that, back in from upwind.
        const first = !cloud.visible;
        cloud.setVisible(true);
        cloud.setPosition(
          first ? view.x + this.rng.frac() * view.width * 2 - view.width / 2 : view.left - margin + this.rng.frac() * 200,
          first ? view.y + this.rng.frac() * view.height * 2 - view.height / 2 : view.top - margin + this.rng.frac() * (view.height + margin * 2),
        );
      }
      cloud.x += WIND.x * dt;
      cloud.y += WIND.y * dt;
    }
  }
}
