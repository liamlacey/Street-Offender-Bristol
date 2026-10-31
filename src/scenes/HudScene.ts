import * as Phaser from 'phaser';
import { pounds } from '../world/bill';

/** What the thumbs are asking of the car. */
export interface TouchDrive {
  /** -1 (left) .. 1 (right) */
  steer: number;
  gas: boolean;
  brake: boolean;
  handbrake: boolean;
}

/** How far the steering knob goes from where the thumb landed, px. */
const STICK = 56;
/** Less than this much of the way is straight ahead. */
const DEAD_ZONE = 0.08;

type ButtonKey = 'gas' | 'brake' | 'handbrake';

interface Button {
  key: ButtonKey;
  zone: Phaser.Geom.Circle;
  label: Phaser.GameObjects.Text;
}

/** Shown on the game for a while when the car turns into another street. */
export const STREET_EVENT = 'street';
/** Sent by the HUD's reset button: put the car back on the road. */
export const RESET_EVENT = 'reset-car';
/** Sent by the HUD's action button: get out of what you're driving, or into what you're by. */
export const ACTION_EVENT = 'get-in-out';
/** Sent by the HUD's pause button: the pause menu. */
export const PAUSE_EVENT = 'pause';

/**
 * Drawn over the game: the street you're on (the old games put up the name
 * of each district as you drove into it), and on touch screens the controls:
 * a steering stick wherever the left thumb lands, and GAS, BRAKE (and
 * reverse) and HANDBRAKE under the right.
 */
export class HudScene extends Phaser.Scene {
  readonly drive: TouchDrive = { steer: 0, gas: false, brake: false, handbrake: false };
  private touch = false;
  private steerPointer: Phaser.Input.Pointer | null = null;
  private steerBase = new Phaser.Math.Vector2();
  private steerKnob = new Phaser.Math.Vector2();
  private buttons: Button[] = [];
  private stickGfx!: Phaser.GameObjects.Graphics;
  private buttonGfx!: Phaser.GameObjects.Graphics;
  private street!: Phaser.GameObjects.Text;
  private streetTimer = 0;
  private resetButton!: Phaser.GameObjects.Text;
  private pauseButton!: Phaser.GameObjects.Text;
  private credit!: Phaser.GameObjects.Text;
  /** The damage done (see GameScene's `charge`): the count, as it's shown (counting up to the total), and what's just been added. */
  private bill!: Phaser.GameObjects.Text;
  private added!: Phaser.GameObjects.Text;
  /** How many you've run down. */
  private killCount!: Phaser.GameObjects.Text;
  private total = 0;
  private shown = 0;
  private recent = 0;
  private recentFor = 0;
  private hint: Phaser.GameObjects.Text | null = null;
  /** Getting out (or in): the button, and whether it's lit (something to get into within reach). */
  private action!: Phaser.GameObjects.Text;
  private actionZone = new Phaser.Geom.Circle(0, 0, 1);
  private actionLit = true;
  private actionHeld = false;

  constructor() {
    super('hud');
  }

  create(): void {
    this.touch = this.sys.game.device.input.touch;
    this.stickGfx = this.add.graphics();
    this.buttonGfx = this.add.graphics();
    const labels: Record<ButtonKey, string> = { gas: 'GAS', brake: 'BRAKE', handbrake: 'H/BRAKE' };
    this.buttons = this.touch
      ? (Object.keys(labels) as ButtonKey[]).map((key) => ({
          key,
          zone: new Phaser.Geom.Circle(0, 0, 1),
          label: this.add.text(0, 0, labels[key], { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setAlpha(0.85),
        }))
      : [];

    this.street = this.add
      .text(0, 0, '', { fontFamily: 'monospace', fontSize: '22px', color: '#f2c94c', fontStyle: 'bold', stroke: '#000000', strokeThickness: 5 })
      .setOrigin(0.5, 0)
      .setAlpha(0);
    this.resetButton = this.add
      .text(0, 0, 'RESET', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', backgroundColor: '#00000066', padding: { x: 8, y: 6 } })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.get('game').events.emit(RESET_EVENT));
    this.pauseButton = this.add
      .text(0, 0, 'II', { fontFamily: 'monospace', fontSize: '15px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#00000066', padding: { x: 12, y: 6 } })
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.get('game').events.emit(PAUSE_EVENT));
    this.action = this.add
      .text(0, 0, 'GET OUT', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#00000066', padding: { x: 8, y: 6 } })
      .setOrigin(0.5);
    // (On a touch screen, it's a button by the others; with a keyboard, F or E.)
    if (!this.touch) this.action.setOrigin(1, 0);
    this.bill = this.add
      .text(0, 0, `DAMAGE ${pounds(0)}`, { fontFamily: 'monospace', fontSize: '14px', color: '#ff7a59', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4 })
      .setOrigin(0, 0);
    this.killCount = this.add
      .text(0, 0, 'KILLS 0', { fontFamily: 'monospace', fontSize: '14px', color: '#e8e8e8', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4 })
      .setOrigin(0, 0);
    this.added = this.add
      .text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#ffd2c2', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0, 0)
      .setAlpha(0);
    // Carrying on (after the picture was lost: see recovery.ts): the counts as they were.
    const counts = this.registry.get('counts') as { damage: number; kills: number } | undefined;
    if (counts) {
      this.total = this.shown = counts.damage;
      this.bill.setText(`DAMAGE ${pounds(counts.damage)}`);
      this.killCount.setText(`KILLS ${counts.kills}`);
    }
    this.credit = this.add
      .text(0, 0, '© OpenStreetMap contributors · LIDAR © Environment Agency (OGL)', { fontFamily: 'sans-serif', fontSize: '10px', color: '#ffffff' })
      .setAlpha(0.6)
      .setOrigin(0.5, 1);
    if (!this.touch) {
      this.hint = this.add
        .text(0, 0, 'Arrows / WASD to drive (or walk)    SPACE handbrake    F get out / in    R reset    P pause', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', backgroundColor: '#00000066', padding: { x: 8, y: 5 } })
        .setOrigin(0.5, 1);
      this.time.delayedCall(9000, () => this.tweens.add({ targets: this.hint, alpha: 0, duration: 800 }));
    }

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // Getting out or in: once, as it's touched (however quick the tap).
      if (this.touch && this.actionZone.contains(p.x, p.y)) {
        this.scene.get('game').events.emit(ACTION_EVENT);
        return;
      }
      // A thumb landing on the left of the screen takes the steering, from wherever it lands (not on the pause button).
      if (this.touch && !this.steerPointer && p.x < this.scale.width * 0.45 && !this.pauseButton.getBounds().contains(p.x, p.y)) {
        this.steerPointer = p;
        this.steerBase.set(p.x, p.y);
        this.steerKnob.set(p.x, p.y);
      }
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
    this.scene.get('game').events.on(STREET_EVENT, this.showStreet, this);
    this.layout();
  }

  private layout(): void {
    const { width, height } = this.scale;
    this.street.setPosition(width / 2, 10);
    this.resetButton.setPosition(width - 10, 10);
    this.pauseButton.setPosition(10, 10);
    // Under it (clear of the street's name, along the top): the damage bill, the kills, and what's just been added to the bill.
    const bounds = this.pauseButton.getBounds();
    this.bill.setPosition(bounds.left, bounds.bottom + 6);
    this.killCount.setPosition(bounds.left, bounds.bottom + 26);
    this.added.setPosition(bounds.left, bounds.bottom + 46);
    if (!this.touch) this.action.setPosition(width - 10, 46);
    this.credit.setPosition(width / 2, height - 3);
    this.hint?.setPosition(width / 2, height - 18);
    if (!this.touch) return;
    const r = Phaser.Math.Clamp(Math.min(width, height) * 0.12, 34, 54);
    const m = 14;
    const gas = { x: width - m - r, y: height - m - r - 8 };
    const place: Record<ButtonKey, [number, number, number]> = {
      gas: [gas.x, gas.y, r * 1.15],
      brake: [gas.x - r * 2.45, gas.y + r * 0.15, r],
      handbrake: [gas.x - r * 0.4, gas.y - r * 2.3, r * 0.82],
    };
    for (const b of this.buttons) {
      const [x, y, radius] = place[b.key];
      b.zone.setTo(x, y, radius);
      b.label.setPosition(x, y).setFontSize(Math.round(radius * 0.32));
    }
    // Getting out or in: up above the brake, out of the way of the thumb on the pedals.
    this.actionZone.setTo(gas.x - r * 2.55, gas.y - r * 2.05, r * 0.72);
    this.action.setPosition(this.actionZone.x, this.actionZone.y).setFontSize(Math.round(r * 0.26)).setBackgroundColor('#00000000');
  }

  update(_time: number, delta: number): void {
    this.countUp(delta / 1000);
    if (this.streetTimer > 0) {
      this.streetTimer -= delta / 1000;
      this.street.setAlpha(Phaser.Math.Clamp(this.streetTimer / 0.6, 0, 1));
    }
    if (!this.touch) return;

    // Steering: how far the knob is pushed left or right of where the thumb landed.
    const p = this.steerPointer;
    if (p && !p.isDown) this.steerPointer = null;
    if (this.steerPointer) {
      const dx = Phaser.Math.Clamp(this.steerPointer.x - this.steerBase.x, -STICK, STICK);
      this.steerKnob.set(this.steerBase.x + dx, this.steerBase.y);
      const k = dx / STICK;
      this.drive.steer = Math.abs(k) < DEAD_ZONE ? 0 : Math.sign(k) * ((Math.abs(k) - DEAD_ZONE) / (1 - DEAD_ZONE));
    } else {
      this.drive.steer = 0;
    }

    // Buttons: any thumb on one holds it, so a thumb can slide from one to the next.
    const pointers = this.input.manager.pointers.filter((q) => q.isDown && q !== this.steerPointer);
    for (const b of this.buttons) this.drive[b.key] = pointers.some((q) => b.zone.contains(q.x, q.y));
    // (Getting out or in happens as it's touched: see create. Lit while it's held.)
    this.actionHeld = pointers.some((q) => this.actionZone.contains(q.x, q.y));
    this.draw();
  }

  private draw(): void {
    const g = this.stickGfx.clear();
    const { height } = this.scale;
    // Where to put a thumb, before one's down.
    const home = this.steerPointer ? this.steerBase : new Phaser.Math.Vector2(30 + STICK + 20, height - 30 - STICK);
    const held = !!this.steerPointer;
    g.fillStyle(0xffffff, held ? 0.1 : 0.06).fillRoundedRect(home.x - STICK - 22, home.y - 26, (STICK + 22) * 2, 52, 26);
    g.lineStyle(2, 0xffffff, held ? 0.35 : 0.2).strokeRoundedRect(home.x - STICK - 22, home.y - 26, (STICK + 22) * 2, 52, 26);
    const knob = held ? this.steerKnob : home;
    g.fillStyle(0xffffff, held ? 0.45 : 0.25).fillCircle(knob.x, knob.y, 22);
    g.fillStyle(0xffffff, 0.5).fillTriangle(home.x - STICK - 12, home.y, home.x - STICK, home.y - 8, home.x - STICK, home.y + 8);
    g.fillTriangle(home.x + STICK + 12, home.y, home.x + STICK, home.y - 8, home.x + STICK, home.y + 8);

    const bg = this.buttonGfx.clear();
    const colours: Record<ButtonKey, number> = { gas: 0x3ad16b, brake: 0xe0503a, handbrake: 0xf2c94c };
    for (const b of this.buttons) {
      const on = this.drive[b.key];
      bg.fillStyle(colours[b.key], on ? 0.55 : 0.22).fillCircle(b.zone.x, b.zone.y, b.zone.radius);
      bg.lineStyle(2, 0xffffff, on ? 0.8 : 0.35).strokeCircle(b.zone.x, b.zone.y, b.zone.radius);
    }
    const a = this.actionZone;
    bg.fillStyle(0x4aa3df, this.actionHeld ? 0.55 : this.actionLit ? 0.3 : 0.1).fillCircle(a.x, a.y, a.radius);
    bg.lineStyle(2, 0xffffff, this.actionLit ? 0.5 : 0.2).strokeCircle(a.x, a.y, a.radius);
  }

  /** Lets go of the steering and the pedals (back from the pause menu: the fingers on them then aren't now). */
  release(): void {
    this.steerPointer = null;
    Object.assign(this.drive, { steer: 0, gas: false, brake: false, handbrake: false });
  }

  /** What the action button says (GET OUT, or GET IN), and whether there's anything to do with it now. */
  setAction(label: string, lit: boolean): void {
    if (this.action.text !== label) this.action.setText(label);
    this.actionLit = lit;
    this.action.setAlpha(lit ? 0.9 : 0.4);
  }

  /** More damage done: the total now, and how much that was (added to what's just been, while it's still showing). */
  billed(total: number, amount: number): void {
    this.total = total;
    this.recent = this.recentFor > 0 ? this.recent + amount : amount;
    this.recentFor = 1.6;
    this.added.setText(`+${pounds(this.recent)}`).setAlpha(1);
    // (A big one: the count jumps out at you.)
    if (amount >= 1000) {
      this.tweens.killTweensOf(this.bill);
      this.bill.setScale(1);
      this.tweens.add({ targets: this.bill, scale: 1.25, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
    }
  }

  /** One more run down: how many now. */
  kills(count: number): void {
    this.killCount.setText(`KILLS ${count}`);
    this.tweens.killTweensOf(this.killCount);
    this.killCount.setScale(1);
    this.tweens.add({ targets: this.killCount, scale: 1.25, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
  }

  /** The count rolling up to the total (quickly: within about half a second, however much), and what was added fading. */
  private countUp(dt: number): void {
    if (this.shown < this.total) {
      this.shown = Math.min(this.total, this.shown + Math.max(1, (this.total - this.shown) * Math.min(1, dt * 8)));
      this.bill.setText(`DAMAGE ${pounds(this.shown)}`);
    }
    if (this.recentFor > 0) {
      this.recentFor -= dt;
      this.added.setAlpha(Phaser.Math.Clamp(this.recentFor / 0.5, 0, 1));
    }
  }

  private showStreet(name: string): void {
    this.street.setText(name.toUpperCase());
    this.streetTimer = 3.5;
  }
}
