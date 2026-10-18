import * as Phaser from 'phaser';

export interface TouchState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
}

type ButtonKey = keyof TouchState;

interface Button {
  key: ButtonKey;
  zone: Phaser.Geom.Circle;
  gfx: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

const LABELS: Record<ButtonKey, string> = {
  left: '<',
  right: '>',
  up: 'GAS',
  down: 'BRAKE',
  handbrake: 'DRIFT',
};

/**
 * On-screen buttons for phones and tablets. Each frame every active pointer is
 * hit-tested against every button, so sliding a thumb from one button to the
 * next works and several buttons can be held at once.
 */
export class TouchControls {
  readonly state: TouchState = { up: false, down: false, left: false, right: false, handbrake: false };
  private readonly buttons: Button[];

  constructor(private readonly scene: Phaser.Scene) {
    this.buttons = (Object.keys(LABELS) as ButtonKey[]).map((key) => ({
      key,
      zone: new Phaser.Geom.Circle(0, 0, 1),
      gfx: scene.add.graphics(),
      label: scene.add
        .text(0, 0, LABELS[key], { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', fontStyle: 'bold' })
        .setOrigin(0.5),
    }));
  }

  layout(width: number, height: number): void {
    const r = Phaser.Math.Clamp(Math.min(width, height) * 0.11, 34, 56);
    const m = r * 0.5 + 12;
    const gap = r * 2.3;
    const bottom = height - m - r;
    const gasX = width - m - r;
    // Portrait screens are too narrow for four buttons in a row, so brake moves above gas.
    const portrait = width < height;
    const place: Record<ButtonKey, [number, number]> = {
      left: [m + r, bottom],
      right: [m + r + gap, bottom],
      up: [gasX, bottom],
      down: portrait ? [gasX, bottom - gap] : [gasX - gap, bottom],
      handbrake: portrait ? [gasX - gap, bottom - gap] : [gasX, bottom - gap],
    };
    for (const b of this.buttons) {
      const [x, y] = place[b.key];
      b.zone.setTo(x, y, r);
      b.label.setPosition(x, y).setFontSize(b.key === 'left' || b.key === 'right' ? r * 0.8 : r * 0.34);
    }
    this.draw();
  }

  update(): void {
    const pointers = this.scene.input.manager.pointers.filter((p) => p.isDown);
    let changed = false;
    for (const b of this.buttons) {
      const held = pointers.some((p) => b.zone.contains(p.x, p.y));
      if (held !== this.state[b.key]) {
        this.state[b.key] = held;
        changed = true;
      }
    }
    if (changed) this.draw();
  }

  private draw(): void {
    for (const b of this.buttons) {
      const held = this.state[b.key];
      b.gfx.clear();
      b.gfx.fillStyle(0xffffff, held ? 0.35 : 0.12);
      b.gfx.fillCircle(b.zone.x, b.zone.y, b.zone.radius);
      b.gfx.lineStyle(2, 0xffffff, held ? 0.8 : 0.35);
      b.gfx.strokeCircle(b.zone.x, b.zone.y, b.zone.radius);
    }
  }
}
