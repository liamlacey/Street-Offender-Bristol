import * as Phaser from 'phaser';
import { type Island, SIZE } from './island';
import { loadGunForward, loadPolice, saveGunForward, savePolice } from '../settings';
import { askName } from '../ui/nameDialog';
import { MAX_ISLAND_NAME, islandName, saveIsland } from './savedIslands';
import { GUN_FORWARD_KEY, ISLAND_KEY, MENU_EVENT, POLICE_KEY, SAVED_KEY, SEED_KEY, NEW_ISLAND_EVENT, STATE_EVENT, TOUCH_KEY, type TankState, type TouchInput } from './TankScene';
import { Terrain } from './Terrain';

const FONT = { fontFamily: 'monospace', color: '#ffffff' };
const BUTTON = { ...FONT, fontSize: '14px', backgroundColor: '#00000088', padding: { x: 10, y: 6 } };
const MAP = 120;
/** Sticks: how far the knob goes from the middle, px, and how far it must go to count. */
const STICK = 52;
const DEAD = 0.18;
/** The right stick fires once pushed this far. */
const TRIGGER = 0.45;

interface Stick {
  pointer: number | null;
  base: Phaser.Math.Vector2;
  home: Phaser.Math.Vector2;
  knob: Phaser.Math.Vector2;
  g: Phaser.GameObjects.Graphics;
}

/**
 * Tank World's screen overlay: a map of the island in the corner (the tank,
 * and what's burning), the count of what's been destroyed, NEW ISLAND and
 * MENU, the GUN switch, and on touch screens two thumb sticks: the left one
 * drives (push the way you want to go), the right one aims the turret and
 * fires while pushed out. With the gun set to FORWARD it points the way the
 * tank's going, and the right stick is just a fire button (anywhere on the
 * right of the screen). With a keyboard and mouse it shows how to drive
 * instead.
 */
export class TankHudScene extends Phaser.Scene {
  private left!: Stick;
  private right!: Stick;
  private touch = false;
  private map!: Phaser.GameObjects.Image;
  private marks!: Phaser.GameObjects.Graphics;
  private count!: Phaser.GameObjects.Text;
  private wanted!: Phaser.GameObjects.Text;
  private buttons: Phaser.GameObjects.Text[] = [];
  private ready = 1;
  private forward = false;
  private fireLabel!: Phaser.GameObjects.Text;
  private help: Phaser.GameObjects.Text | null = null;
  private state: TankState | null = null;

  constructor() {
    super('tankhud');
  }

  create(): void {
    const island = this.registry.get(ISLAND_KEY) as Island;
    this.touch = this.sys.game.device.input.touch;
    this.buttons = [];
    this.state = null;
    const key = `minimap-${island.seed}`;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, Terrain.miniMap(island, MAP));
    this.map = this.add.image(0, 0, key).setOrigin(0, 0).setAlpha(0.9);
    this.marks = this.add.graphics();
    this.count = this.add.text(0, 0, '', { ...FONT, fontSize: '18px', fontStyle: 'bold' }).setOrigin(1, 0).setShadow(1, 1, '#000', 3);
    const tank = this.scene.get('tank');
    this.forward = loadGunForward();
    const gun = this.button('', () => this.setForward(!this.forward));
    const save = this.button(this.registry.get(SAVED_KEY) ? 'SAVED' : 'SAVE ISLAND', () => this.save(save));
    const police = this.button('', () => this.setPolice(!this.registry.get(POLICE_KEY), police));
    this.buttons.push(
      this.button('NEW ISLAND', () => tank.events.emit(NEW_ISLAND_EVENT)),
      this.button('MENU', () => tank.events.emit(MENU_EVENT)),
      gun,
      save,
      police,
    );
    this.wanted = this.add.text(0, 0, '', { ...FONT, fontSize: '15px', fontStyle: 'bold', color: '#7fb2ff' }).setShadow(1, 1, '#000', 3);
    this.fireLabel = this.add.text(0, 0, 'FIRE', { ...FONT, fontSize: '16px', fontStyle: 'bold' }).setOrigin(0.5).setVisible(false);
    const stick = (): Stick => ({ pointer: null, base: new Phaser.Math.Vector2(), home: new Phaser.Math.Vector2(), knob: new Phaser.Math.Vector2(), g: this.add.graphics() });
    this.left = stick();
    this.right = stick();
    if (this.touch) {
      this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.press(p));
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.move(p));
      this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.release(p));
    } else {
      this.help = this.add.text(0, 0, '', { ...FONT, fontSize: '13px', color: '#e8edf2' }).setOrigin(0.5, 1).setShadow(1, 1, '#000', 3).setName('help');
    }
    this.setForward(this.forward, gun);
    this.setPolice(loadPolice(), police);
    // A word of welcome, then it fades.
    const intro = this.add
      .text(0, 0, this.touch ? `TANK WORLD\nLeft stick: drive    Right: ${this.forward ? 'fire' : 'aim and fire'}` : 'TANK WORLD\nBlow up anything and everything', {
        ...FONT,
        fontSize: '18px',
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5)
      .setShadow(2, 2, '#000', 4)
      .setName('intro');
    this.tweens.add({ targets: intro, alpha: 0, delay: 4000, duration: 1200, onComplete: () => intro.destroy() });

    tank.events.on(STATE_EVENT, this.onState, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => tank.events.off(STATE_EVENT, this.onState, this));
    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
  }

  update(): void {
    this.drawStick(this.left, false);
    this.drawStick(this.right, true);
    const s = this.state;
    this.marks.clear();
    if (!s) return;
    const k = MAP / SIZE;
    const mx = this.map.x;
    const my = this.map.y;
    this.marks.fillStyle(0xff6a1a, 0.9);
    for (const f of s.fires) this.marks.fillRect(mx + f.x * k - 1, my + f.y * k - 1, 2.5, 2.5);
    // The police after it, and the trains.
    this.marks.fillStyle(0x4d8dff, 1);
    for (const c of s.cops) this.marks.fillRect(mx + c.x * k - 1.5, my + c.y * k - 1.5, 3, 3);
    this.marks.fillStyle(0xffffff, 1);
    for (const t of s.trains) this.marks.fillRect(mx + t.x * k - 1.5, my + t.y * k - 1.5, 3, 3);
    // The tank: a dot with a tick the way it's facing.
    const tx = mx + s.x * k;
    const ty = my + s.y * k;
    this.marks.lineStyle(2, 0xffffff, 1).lineBetween(tx, ty, tx + Math.cos(s.heading) * 6, ty + Math.sin(s.heading) * 6);
    this.marks.fillStyle(0xd7263d, 1).fillCircle(tx, ty, 3.5);
    this.marks.lineStyle(1, 0xffffff, 0.6).strokeRect(mx, my, MAP, MAP);
  }

  private onState(state: TankState): void {
    this.state = state;
    this.ready = state.ready;
    this.count.setText(`DESTROYED ${state.destroyed}`);
    // How hot the police are on the tank: a star for each two after it.
    this.wanted.setText(state.police > 0 ? `POLICE ${'★'.repeat(Math.min(7, Math.ceil(state.police / 2)))}` : '');
  }

  private layout(): void {
    const { width, height } = this.scale;
    const m = 12;
    this.map.setPosition(m, m);
    this.wanted.setPosition(m, m + MAP + 6);
    this.count.setPosition(width - m, m);
    const r = Phaser.Math.Clamp(Math.min(width, height) * 0.16, 50, 80);
    // Down the right, in a second column alongside if they'd run into the stick.
    let x = width - m;
    let y = m + 30;
    let column = 0;
    for (const b of this.buttons) {
      if (y + b.height > height - m - r * 2 - 20 && y > m + 30) {
        x -= column + 6;
        y = m + 30;
        column = 0;
      }
      b.setPosition(x, y);
      y += b.height + 6;
      column = Math.max(column, b.width);
    }
    this.left.home.set(m + r + 18, height - m - r - 10);
    this.right.home.set(width - m - r - 18, height - m - r - 10);
    for (const s of [this.left, this.right]) {
      if (s.pointer === null) {
        s.base.copy(s.home);
        s.knob.copy(s.home);
      }
    }
    (this.children.getByName('help') as Phaser.GameObjects.Text | null)?.setPosition(width / 2, height - 10);
    this.fireLabel?.setPosition(this.right.home.x, this.right.home.y);
    (this.children.getByName('intro') as Phaser.GameObjects.Text | null)?.setPosition(width / 2, height * 0.3);
  }

  /** Asks for a name and saves the island (its seed), so it can be played again from the menu. */
  private async save(button: Phaser.GameObjects.Text): Promise<void> {
    if (this.registry.get(SAVED_KEY)) return;
    const seed = this.registry.get(SEED_KEY) as number;
    const name = await askName(this.game, 'Name this island', islandName(seed), MAX_ISLAND_NAME);
    if (name === null) return;
    const saved = saveIsland(name, seed);
    if (!saved) return;
    this.registry.set(SAVED_KEY, saved.id);
    button.setText('SAVED');
    this.layout();
  }

  /** Switches the gun between pointing the way the tank's going and being aimed on its own (and remembers it). */
  /** The police on or off (remembered); off sends them all away. */
  private setPolice(on: boolean, button: Phaser.GameObjects.Text): void {
    savePolice(on);
    this.registry.set(POLICE_KEY, on);
    button.setText(on ? 'POLICE: ON' : 'POLICE: OFF');
    this.layout();
  }

  private setForward(forward: boolean, gun = this.buttons[2]): void {
    this.forward = forward;
    saveGunForward(forward);
    this.registry.set(GUN_FORWARD_KEY, forward);
    gun.setText(forward ? 'GUN: FORWARD' : 'GUN: AIMED');
    this.help?.setText(forward ? 'WASD / arrows: drive    Click / Space: fire' : 'WASD / arrows: drive    Mouse: aim    Click / Space: fire');
    this.fireLabel?.setVisible(this.touch && forward);
    this.layout();
  }

  private button(label: string, onTap: () => void): Phaser.GameObjects.Text {
    return this.add
      .text(0, 0, label, BUTTON)
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        onTap();
      });
  }

  // --- Thumb sticks: each starts wherever a thumb lands on its half of the screen ---

  private press(p: Phaser.Input.Pointer): void {
    if (this.buttons.some((b) => b.getBounds().contains(p.x, p.y))) return;
    if (p.x < MAP + 24 && p.y < MAP + 24) return;
    const s = p.x < this.scale.width / 2 ? this.left : this.right;
    if (s.pointer !== null) return;
    s.pointer = p.id;
    if (!(s === this.right && this.forward)) {
      s.base.set(p.x, p.y);
      s.knob.set(p.x, p.y);
    }
    this.send();
  }

  private move(p: Phaser.Input.Pointer): void {
    for (const s of [this.left, this.right]) {
      if (s.pointer !== p.id) continue;
      // A fire button doesn't move.
      if (s === this.right && this.forward) continue;
      const v = new Phaser.Math.Vector2(p.x - s.base.x, p.y - s.base.y);
      if (v.length() > STICK) v.setLength(STICK);
      s.knob.set(s.base.x + v.x, s.base.y + v.y);
      this.send();
    }
  }

  private release(p: Phaser.Input.Pointer): void {
    for (const s of [this.left, this.right]) {
      if (s.pointer !== p.id) continue;
      s.pointer = null;
      s.base.copy(s.home);
      s.knob.copy(s.home);
      this.send();
    }
  }

  /** Hands the sticks' state to the tank. */
  private send(): void {
    const push = (s: Stick) => {
      const dx = (s.knob.x - s.base.x) / STICK;
      const dy = (s.knob.y - s.base.y) / STICK;
      return { x: dx, y: dy, length: Math.hypot(dx, dy) };
    };
    const l = push(this.left);
    const r = push(this.right);
    const input: TouchInput = {
      drive: this.left.pointer !== null && l.length > DEAD ? { x: l.x, y: l.y } : null,
      aim: !this.forward && this.right.pointer !== null && r.length > DEAD ? Math.atan2(r.y, r.x) : null,
      fire: this.right.pointer !== null && (this.forward || r.length > TRIGGER),
    };
    this.registry.set(TOUCH_KEY, input);
  }

  private drawStick(s: Stick, trigger: boolean): void {
    s.g.clear();
    if (!this.touch) return;
    const held = s.pointer !== null;
    if (trigger && this.forward) {
      // Just a fire button, with the reload round it.
      s.g.fillStyle(0xd7263d, held ? 0.75 : 0.45).fillCircle(s.home.x, s.home.y, STICK + 6);
      s.g.lineStyle(2, 0xffffff, held ? 0.6 : 0.3).strokeCircle(s.home.x, s.home.y, STICK + 6);
      s.g.lineStyle(4, 0xff8a3c, 0.85);
      s.g.beginPath();
      s.g.arc(s.home.x, s.home.y, STICK + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.ready);
      s.g.strokePath();
      return;
    }
    s.g.fillStyle(0xffffff, held ? 0.12 : 0.07).fillCircle(s.base.x, s.base.y, STICK + 14);
    s.g.lineStyle(2, 0xffffff, held ? 0.4 : 0.22).strokeCircle(s.base.x, s.base.y, STICK + 14);
    if (trigger) {
      // How far it is to firing, and the reload as an arc round the edge.
      s.g.lineStyle(1.5, 0xff8a3c, 0.35).strokeCircle(s.base.x, s.base.y, STICK * TRIGGER);
      s.g.lineStyle(4, 0xff8a3c, 0.85);
      s.g.beginPath();
      s.g.arc(s.base.x, s.base.y, STICK + 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.ready);
      s.g.strokePath();
    }
    s.g.fillStyle(trigger ? 0xd7263d : 0xffffff, held ? 0.7 : 0.35).fillCircle(s.knob.x, s.knob.y, 24);
    if (!held) {
      // What it's for.
      s.g.lineStyle(2, 0xffffff, 0.5);
      if (trigger) {
        s.g.strokeCircle(s.knob.x, s.knob.y, 8);
        s.g.lineBetween(s.knob.x - 13, s.knob.y, s.knob.x + 13, s.knob.y);
        s.g.lineBetween(s.knob.x, s.knob.y - 13, s.knob.x, s.knob.y + 13);
      } else {
        for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const x = s.knob.x + Math.cos(a) * 12;
          const y = s.knob.y + Math.sin(a) * 12;
          s.g.fillStyle(0xffffff, 0.5).fillTriangle(x + Math.cos(a) * 5, y + Math.sin(a) * 5, x + Math.cos(a + 2.3) * 4, y + Math.sin(a + 2.3) * 4, x + Math.cos(a - 2.3) * 4, y + Math.sin(a - 2.3) * 4);
        }
      }
    }
  }
}
