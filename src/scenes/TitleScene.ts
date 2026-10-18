import * as Phaser from 'phaser';
import { bridge, terrace } from './skyline';

/**
 * The title screen, for now: Bristol at dusk (the gorge and the Clifton
 * Suspension Bridge, the painted terraces up the hill) and the name. The
 * game itself is to come; see example-code/ for what can be reused.
 */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('title');
  }

  create(): void {
    this.draw();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.draw, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.draw, this));
  }

  private draw(): void {
    this.children.removeAll(true);
    const { width, height } = this.scale;
    const g = this.add.graphics();
    // Dusk: the sky, the gorge's two sides, and the river at the bottom.
    g.fillGradientStyle(0x1d2b53, 0x1d2b53, 0xe07a5f, 0xe07a5f, 1).fillRect(0, 0, width, height);
    const deck = height * 0.42;
    g.fillStyle(0x2b2d42, 1).fillRect(0, deck, width * 0.22, height - deck);
    g.fillRect(width * 0.78, deck, width * 0.22, height - deck);
    g.fillStyle(0x3d4a5c, 1).fillRect(width * 0.22, height * 0.78, width * 0.56, height * 0.22);
    // The bridge.
    const { towers, chain } = bridge(width * 0.1, width * 0.9, deck);
    g.fillStyle(0x14161b, 1);
    for (const x of towers) g.fillRect(x - 9, deck - 66, 18, 70);
    g.fillRect(width * 0.18, deck - 4, width * 0.64, 6);
    g.lineStyle(3, 0x14161b, 1).strokePoints(chain.map((p) => new Phaser.Math.Vector2(p.x, p.y)));
    for (const p of chain.filter((_, k) => k % 3 === 0)) g.lineBetween(p.x, p.y, p.x, deck - 2);
    // The painted terraces stepping up the hill.
    let s = 11;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (const h of terrace(width, height, rand)) {
      g.fillStyle(h.colour, 1).fillRect(h.x, h.y - h.h, h.w - 2, h.h);
      g.fillStyle(0x14161b, 0.55).fillRect(h.x + 5, h.y - h.h + 8, 6, 8).fillRect(h.x + h.w - 13, h.y - h.h + 8, 6, 8);
    }
    const title = { fontFamily: 'monospace', color: '#ffffff', fontStyle: 'bold' };
    this.add.text(width / 2, height * 0.16, 'STREET OFFENDER', { ...title, fontSize: `${Math.min(56, width / 11)}px` }).setOrigin(0.5).setShadow(3, 3, '#000', 6);
    this.add.text(width / 2, height * 0.16 + Math.min(52, width / 12), 'BRISTOL', { ...title, fontSize: `${Math.min(34, width / 16)}px`, color: '#f2c94c' }).setOrigin(0.5).setShadow(2, 2, '#000', 4);
    this.add.text(width / 2, height * 0.62, 'Coming soon', { ...title, fontSize: '16px', fontStyle: 'normal' }).setOrigin(0.5).setShadow(1, 1, '#000', 3);
  }
}
