import * as Phaser from 'phaser';
import type { Track } from '../track/Track';

/** Small overview of the track with the car's position, drawn in screen space. */
export class Minimap {
  private readonly container: Phaser.GameObjects.Container;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly dot: Phaser.GameObjects.Arc;
  /** A line across the track at the next checkpoint (drawn across the x axis, rotated to the track). */
  private readonly checkpoint: Phaser.GameObjects.Rectangle;
  private readonly opponents: Phaser.GameObjects.Arc[] = [];
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly track: Track,
  ) {
    this.gfx = scene.add.graphics();
    this.dot = scene.add.circle(0, 0, 4, 0xd7263d).setStrokeStyle(1.5, 0xffffff);
    this.checkpoint = scene.add.rectangle(0, 0, 3, 10, 0xffd23f);
    // Car drawn last so it stays visible when it's on the checkpoint.
    this.container = scene.add.container(0, 0, [this.gfx, this.checkpoint, this.dot]);
  }

  /** Places the map with its top-left corner at (x, y), fitting the track in a `size` px square. */
  layout(x: number, y: number, size: number): void {
    const { minX, minY, maxX, maxY } = this.track.bounds;
    const pad = 10;
    this.scale = (size - pad * 2) / Math.max(maxX - minX, maxY - minY);
    this.offsetX = pad + (size - pad * 2 - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.offsetY = pad + (size - pad * 2 - (maxY - minY) * this.scale) / 2 - minY * this.scale;
    this.container.setPosition(x, y);

    const g = this.gfx.clear();
    g.fillStyle(0x10141a, 0.7);
    g.fillRoundedRect(0, 0, size, size, 8);
    g.lineStyle(this.lineWidth(), 0xffffff, 0.75);
    g.beginPath();
    this.track.points.forEach((p, i) => {
      const sx = p.x * this.scale + this.offsetX;
      const sy = p.y * this.scale + this.offsetY;
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    });
    g.closePath();
    g.strokePath();
  }

  setCarPosition(x: number, y: number): void {
    this.dot.setPosition(x * this.scale + this.offsetX, y * this.scale + this.offsetY);
  }

  /** Shows the other cars as dots in their colours, under the player's dot. */
  setOpponents(cars: { x: number; y: number; color: number }[]): void {
    cars.forEach((c, i) => {
      if (!this.opponents[i]) {
        this.opponents[i] = this.scene.add.circle(0, 0, 3.5, c.color).setStrokeStyle(1, 0x10141a);
        this.container.addAt(this.opponents[i], 1);
      }
      this.opponents[i].setPosition(c.x * this.scale + this.offsetX, c.y * this.scale + this.offsetY);
    });
  }

  /** Marks the next checkpoint with a line across the track; longer and thicker when it's been missed. */
  setCheckpoint(at: { x: number; y: number; heading: number }, missed: boolean): void {
    const across = this.lineWidth() + (missed ? 12 : 6);
    this.checkpoint
      .setPosition(at.x * this.scale + this.offsetX, at.y * this.scale + this.offsetY)
      .setSize(missed ? 4 : 2.5, across)
      .setRotation(at.heading);
  }

  /** Thickness of the track on the map, in px. */
  private lineWidth(): number {
    return Math.max(3, this.track.width * this.scale);
  }
}
