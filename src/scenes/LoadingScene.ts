import { currentMap } from '../map/maps';
import * as Phaser from 'phaser';

/**
 * While the game's setting up (see GameScene's `build`): the name, a bar
 * filling up, and what it's doing; at dusk, as the title screen is.
 */
export class LoadingScene extends Phaser.Scene {
  private done = 0;
  private label = '';
  private bar?: Phaser.GameObjects.Graphics;
  private text?: Phaser.GameObjects.Text;

  constructor() {
    super('loading');
  }

  create(): void {
    [this.done, this.label] = [0, ''];
    this.draw();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.draw, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.draw, this);
      // (Gone with the scene: not to be written on before it's made again, next time it's shown.)
      [this.bar, this.text] = [undefined, undefined];
    });
  }

  /** How far it's got (0 to 1), and what it's doing now. */
  show(done: number, label: string): void {
    [this.done, this.label] = [done, label];
    this.fill();
  }

  /** Something's gone wrong setting up. */
  failed(): void {
    // (Not up yet: shown when it is.)
    if (!this.text) {
      this.events.once(Phaser.Scenes.Events.CREATE, () => this.failed());
      return;
    }
    this.text.setText('Something went wrong: tap to try again').setColor('#f2c94c');
    this.input.once('pointerdown', () => window.location.reload());
  }

  private draw(): void {
    this.children.removeAll(true);
    const { width, height } = this.scale;
    this.add.graphics().fillGradientStyle(0x1d2b53, 0x1d2b53, 0xe07a5f, 0xe07a5f, 1).fillRect(0, 0, width, height);
    const title = { fontFamily: 'monospace', color: '#ffffff', fontStyle: 'bold' };
    this.add.text(width / 2, height * 0.3, 'STREET OFFENDER', { ...title, fontSize: `${Math.min(40, width / 14)}px` }).setOrigin(0.5).setShadow(3, 3, '#000', 6);
    this.add.text(width / 2, height * 0.3 + Math.min(40, width / 15), currentMap().name.toUpperCase(), { ...title, fontSize: `${Math.min(26, width / 20)}px`, color: '#f2c94c' }).setOrigin(0.5).setShadow(2, 2, '#000', 4);
    this.bar = this.add.graphics();
    this.text = this.add.text(width / 2, height * 0.62, '', { ...title, fontSize: '15px', fontStyle: 'normal' }).setOrigin(0.5).setShadow(1, 1, '#000', 3);
    this.add.text(width / 2, height - 14, currentMap().credit, { fontFamily: 'sans-serif', fontSize: '11px', color: '#ffffff' }).setOrigin(0.5, 1).setAlpha(0.8);
    this.fill();
  }

  /** The bar: an outline, filled as far as it's got. */
  private fill(): void {
    if (!this.bar || !this.text) return;
    const { width, height } = this.scale;
    const w = Math.min(320, width * 0.7);
    const [x, y, h] = [(width - w) / 2, height * 0.53, 14];
    this.bar.clear();
    this.bar.fillStyle(0x14161b, 0.55).fillRoundedRect(x, y, w, h, 7);
    if (this.done > 0) this.bar.fillStyle(0xf2c94c, 1).fillRoundedRect(x + 2, y + 2, Math.max(10, (w - 4) * Math.min(1, this.done)), h - 4, 5);
    this.bar.lineStyle(2, 0xffffff, 0.9).strokeRoundedRect(x, y, w, h, 7);
    this.text.setText(this.label ? `${this.label}…` : '');
  }
}
