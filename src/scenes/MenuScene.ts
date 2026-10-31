import { MAPS, chooseMap, currentMap } from '../map/maps';
import * as Phaser from 'phaser';
import { type Going, OVERVIEW_SCALE, type Overview, type OverviewRoad, type Spot, drawOverview, jumpSpot } from '../world/overview';
import { softTexture } from '../world/canvas';

/** What the game hands the menu as it pauses. */
export interface MenuData {
  /** How big the whole map is, px; and what its map's drawn from, fetched (only when it's wanted). */
  map: { width: number; height: number };
  overview: () => Promise<Overview>;
  /** Where you are, and which way you're facing. */
  you: { x: number; y: number; heading: number };
  /** What you're getting about in (where you can be put down). */
  going: Going;
  /** Back to the game: put down at a spot, or just carry on. */
  done: (to: Spot | null) => void;
}

const OVERVIEW = 'overview-map';
/** The overview's picture's longest side, at most, px (a big map's drawn smaller, and scaled up). */
const MOST_SIDE = 2048;
/** Closest in, screen px for each of the overview's. */
const MOST_ZOOM = 3.5;
/** A touch that moves less than this is a tap (a place picked), px. */
const TAP = 10;

const FONT = { fontFamily: 'monospace', color: '#ffffff', fontStyle: 'bold' };

/**
 * Paused: RESUME; MAP, a map of the whole of the place you're in to drag about
 * (and pinch, or scroll, to zoom), showing where you are (tap a place on it and
 * GO to be put down on the road there); or PLACES, the maps there are to play
 * (Bristol, Llanidloes: see src/map/maps.ts), to go to another.
 */
export class MenuScene extends Phaser.Scene {
  private data_!: MenuData;
  private mode: 'menu' | 'map' | 'places' = 'menu';
  private items: Phaser.GameObjects.GameObject[] = [];
  private image: Phaser.GameObjects.Image | null = null;
  private marks!: Phaser.GameObjects.Graphics;
  /** The map's view: the screen point its top-left corner is at, and its zoom (screen px for each of the overview's). */
  private view = { x: 0, y: 0, zoom: 1 };
  private target: Spot | null = null;
  private go: Phaser.GameObjects.Text | null = null;
  /** Fingers on the map (by pointer id): where each was last; and whether it's been a drag (not a tap). */
  private touches = new Map<number, { x: number; y: number }>();
  private dragged = false;
  /** The roads (to put you down on), once the overview's here; and how much bigger it's shown than its picture's drawn. */
  private roads: OverviewRoad[] | null = null;
  private upscale = 1;
  private fetching = false;

  constructor() {
    super('menu');
  }

  init(data: MenuData): void {
    this.data_ = data;
    this.mode = 'menu';
    this.target = null;
    this.touches.clear();
  }

  create(): void {
    this.build();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.build, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.build, this);
      // The overview's let go till it's next wanted (it's the whole map).
      if (this.textures.exists(OVERVIEW)) this.textures.remove(OVERVIEW);
      this.roads = null;
    });
    const kb = this.input.keyboard;
    kb?.on('keydown-ESC', () => (this.mode === 'menu' ? this.close(null) : this.showMenu()));
    kb?.on('keydown-P', () => this.close(null));
    kb?.on('keydown-M', () => this.mode === 'menu' && this.showMap());
    this.input.on('pointerdown', this.down, this);
    this.input.on('pointermove', this.move, this);
    this.input.on('pointerup', this.up, this);
    this.input.on('pointerupoutside', this.up, this);
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.mode === 'map') this.zoomAt(p.x, p.y, Math.exp(-dy * 0.0015));
    });
  }

  /** Lays it out again (at the start, and when the screen turns or changes size). */
  private build(): void {
    if (this.mode === 'map') this.showMap(false);
    else if (this.mode === 'places') this.showPlaces();
    else this.showMenu();
  }

  private clear(): void {
    for (const o of this.items) o.destroy();
    this.items = [];
    this.image = null;
    this.go = null;
  }

  private button(x: number, y: number, label: string, onTap: () => void, size = 20, fill = '#000000b3'): Phaser.GameObjects.Text {
    const t = this.add
      .text(x, y, label, { ...FONT, fontSize: `${size}px`, backgroundColor: fill, padding: { x: 18, y: 12 } })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        onTap();
      });
    this.items.push(t);
    return t;
  }

  private showMenu(): void {
    this.mode = 'menu';
    this.clear();
    const { width, height } = this.scale;
    const shade = this.add.rectangle(0, 0, width, height, 0x000000, 0.55).setOrigin(0).setInteractive();
    this.items.push(shade);
    this.items.push(this.add.text(width / 2, height * 0.17, 'PAUSED', { ...FONT, fontSize: '34px', color: '#f2c94c' }).setOrigin(0.5).setShadow(2, 2, '#000', 4));
    this.button(width / 2, height * 0.4, 'RESUME', () => this.close(null), 22);
    this.button(width / 2, height * 0.6, 'MAP', () => this.showMap(), 22);
    this.button(width / 2, height * 0.8, 'PLACES', () => this.showPlaces(), 22);
  }

  /** The maps there are to play: the one you're in marked; another tapped, and the game's loaded again there (starting afresh). */
  private showPlaces(): void {
    this.mode = 'places';
    this.clear();
    const { width, height } = this.scale;
    this.items.push(this.add.rectangle(0, 0, width, height, 0x000000, 0.7).setOrigin(0).setInteractive());
    this.button(70, 30, 'BACK', () => this.showMenu(), 15);
    this.items.push(this.add.text(width / 2, height * 0.17, 'PLACES', { ...FONT, fontSize: '28px', color: '#f2c94c' }).setOrigin(0.5).setShadow(2, 2, '#000', 4));
    const here = currentMap();
    const gap = Math.min(80, (height * 0.7) / MAPS.length);
    MAPS.forEach((m, i) => {
      const y = height * 0.38 + i * gap;
      if (m.id === here.id) {
        this.items.push(
          this.add
            .text(width / 2, y, `${m.name.toUpperCase()}  ✓`, { ...FONT, fontSize: '20px', color: '#f2c94c', backgroundColor: '#000000b3', padding: { x: 18, y: 12 } })
            .setOrigin(0.5),
        );
      } else {
        this.button(width / 2, y, m.name.toUpperCase(), () => chooseMap(m.id), 20, '#2f8f4ee6');
      }
    });
  }

  /** The map; `fresh` centres it on you, close enough to see the streets round you. */
  private showMap(fresh = true): void {
    this.mode = 'map';
    this.clear();
    const { you } = this.data_;
    const { width, height } = this.scale;
    this.items.push(this.add.rectangle(0, 0, width, height, 0x14161b, 1).setOrigin(0));
    if (!this.textures.exists(OVERVIEW)) {
      // Fetched, and drawn; then the map shown again.
      this.items.push(this.add.text(width / 2, height / 2, 'LOADING THE MAP…', { ...FONT, fontSize: '16px' }).setOrigin(0.5));
      this.button(70, 30, 'BACK', () => this.showMenu(), 15);
      if (!this.fetching) {
        this.fetching = true;
        void this.data_
          .overview()
          .then((o) => {
            const s = Math.min(OVERVIEW_SCALE, MOST_SIDE / Math.max(o.width, o.height));
            const tex = softTexture(this, OVERVIEW, Math.ceil(o.width * s), Math.ceil(o.height * s));
            drawOverview(tex.context, o, s);
            tex.refresh();
            this.upscale = OVERVIEW_SCALE / s;
            this.roads = o.roads;
            if (this.mode === 'map' && this.sys.isActive()) this.showMap(fresh);
          })
          .catch((e) => console.error('map:', e))
          .finally(() => (this.fetching = false));
      }
      return;
    }
    this.image = this.add.image(0, 0, OVERVIEW).setOrigin(0);
    this.items.push(this.image);
    this.marks = this.add.graphics();
    this.items.push(this.marks);
    if (fresh) {
      this.view.zoom = 1.2;
      this.view.x = width / 2 - you.x * OVERVIEW_SCALE * this.view.zoom;
      this.view.y = height / 2 - you.y * OVERVIEW_SCALE * this.view.zoom;
    }
    this.clamp();
    this.button(70, 30, 'BACK', () => this.showMenu(), 15);
    this.items.push(
      this.add.text(width / 2, 30, 'TAP WHERE TO GO', { ...FONT, fontSize: '14px', backgroundColor: '#000000b3', padding: { x: 10, y: 8 } }).setOrigin(0.5),
    );
    this.button(width - 34, height / 2 - 34, '+', () => this.zoomAt(width / 2, height / 2, 1.6), 22);
    this.button(width - 34, height / 2 + 34, '−', () => this.zoomAt(width / 2, height / 2, 1 / 1.6), 22);
    this.button(width - 70, 30, 'ME', () => this.centreOn(you.x, you.y), 15);
    this.items.push(
      this.add.text(width / 2, height - 3, currentMap().credit, { fontFamily: 'sans-serif', fontSize: '10px', color: '#ffffff' }).setOrigin(0.5, 1).setAlpha(0.7),
    );
    if (this.target) this.pick(this.target);
    this.place();
  }

  /** Where a point on the map is on the screen, and back. */
  private toScreen(x: number, y: number): [number, number] {
    const k = OVERVIEW_SCALE * this.view.zoom;
    return [this.view.x + x * k, this.view.y + y * k];
  }

  private toMap(sx: number, sy: number): [number, number] {
    const k = OVERVIEW_SCALE * this.view.zoom;
    return [(sx - this.view.x) / k, (sy - this.view.y) / k];
  }

  private centreOn(x: number, y: number): void {
    const k = OVERVIEW_SCALE * this.view.zoom;
    this.view.x = this.scale.width / 2 - x * k;
    this.view.y = this.scale.height / 2 - y * k;
    this.clamp();
    this.place();
  }

  /** Zoomed in (or out) by `by`, keeping what's under (sx, sy) there. */
  private zoomAt(sx: number, sy: number, by: number): void {
    const [mx, my] = this.toMap(sx, sy);
    this.view.zoom = Phaser.Math.Clamp(this.view.zoom * by, this.leastZoom(), MOST_ZOOM);
    const k = OVERVIEW_SCALE * this.view.zoom;
    this.view.x = sx - mx * k;
    this.view.y = sy - my * k;
    this.clamp();
    this.place();
  }

  /** Out far enough to see the whole map on the screen, and no further. */
  private leastZoom(): number {
    const { map } = this.data_;
    return Math.min(this.scale.width / (map.width * OVERVIEW_SCALE), this.scale.height / (map.height * OVERVIEW_SCALE));
  }

  /** Not dragged off the screen: the map's kept over it (or in the middle of it, when it's smaller). */
  private clamp(): void {
    const { width, height } = this.scale;
    const { map } = this.data_;
    this.view.zoom = Phaser.Math.Clamp(this.view.zoom, this.leastZoom(), MOST_ZOOM);
    const [w, h] = [map.width * OVERVIEW_SCALE * this.view.zoom, map.height * OVERVIEW_SCALE * this.view.zoom];
    this.view.x = w <= width ? (width - w) / 2 : Phaser.Math.Clamp(this.view.x, width - w, 0);
    this.view.y = h <= height ? (height - h) / 2 : Phaser.Math.Clamp(this.view.y, height - h, 0);
  }

  /** The map where the view says, and you and where you're going marked on it. */
  private place(): void {
    if (!this.image) return;
    this.image.setPosition(this.view.x, this.view.y).setScale(this.view.zoom * this.upscale);
    const g = this.marks.clear();
    const { you } = this.data_;
    const [x, y] = this.toScreen(you.x, you.y);
    // You: an arrow the way you're facing.
    const [c, s] = [Math.cos(you.heading), Math.sin(you.heading)];
    const at = (u: number, v: number) => [x + u * c - v * s, y + u * s + v * c] as const;
    const [a, b, d] = [at(13, 0), at(-8, -8), at(-8, 8)];
    g.fillStyle(0x000000, 0.4).fillCircle(x + 1, y + 2, 13);
    g.fillStyle(0xe0503a, 1).fillTriangle(a[0], a[1], b[0], b[1], d[0], d[1]);
    g.lineStyle(2, 0xffffff, 1).strokeTriangle(a[0], a[1], b[0], b[1], d[0], d[1]);
    if (this.target) {
      // Where you're going: a pin.
      const [tx, ty] = this.toScreen(this.target.x, this.target.y);
      g.fillStyle(0x000000, 0.35).fillEllipse(tx + 2, ty + 1, 12, 5);
      g.lineStyle(3, 0x14161b, 1).lineBetween(tx, ty, tx, ty - 18);
      g.fillStyle(0xf2c94c, 1).fillCircle(tx, ty - 22, 8);
      g.lineStyle(2, 0x14161b, 1).strokeCircle(tx, ty - 22, 8);
    }
  }

  /** A place picked: the pin, and the button to go there. */
  private pick(spot: Spot): void {
    this.target = spot;
    this.go?.destroy();
    const { width, height } = this.scale;
    const label = spot.name ? `GO TO ${spot.name.toUpperCase()}` : 'GO HERE';
    this.go = this.button(width / 2, height - 42, label, () => this.close(spot), 17, '#2f8f4ee6');
    this.place();
  }

  private down(p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (this.mode !== 'map' || over.some((o) => o instanceof Phaser.GameObjects.Text)) return;
    this.touches.set(p.id, { x: p.x, y: p.y });
    if (this.touches.size === 1) this.dragged = false;
    else this.dragged = true;
  }

  private move(p: Phaser.Input.Pointer): void {
    const last = this.touches.get(p.id);
    if (this.mode !== 'map' || !last) return;
    if (this.touches.size >= 2) {
      // Pinching: zoomed by how much the fingers have spread, about the point between them; and moved with them.
      const [a, b] = [...this.touches.entries()];
      const other = a[0] === p.id ? b[1] : a[1];
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(p.x - other.x, p.y - other.y);
      if (before > 4) this.zoomAt((p.x + other.x) / 2, (p.y + other.y) / 2, after / before);
      this.view.x += (p.x - last.x) / 2;
      this.view.y += (p.y - last.y) / 2;
    } else {
      if (Math.hypot(p.x - p.downX, p.y - p.downY) > TAP) this.dragged = true;
      if (this.dragged) {
        this.view.x += p.x - last.x;
        this.view.y += p.y - last.y;
      }
    }
    last.x = p.x;
    last.y = p.y;
    this.clamp();
    this.place();
  }

  private up(p: Phaser.Input.Pointer): void {
    if (!this.touches.delete(p.id) || this.mode !== 'map') return;
    // A tap (not a drag or a pinch): that's where to go.
    if (!this.dragged && this.touches.size === 0) {
      const [x, y] = this.toMap(p.x, p.y);
      const spot = this.roads && jumpSpot({ roads: this.roads }, x, y, this.data_.going);
      if (spot) this.pick(spot);
    }
  }

  private close(to: Spot | null): void {
    const done = this.data_.done;
    this.scene.stop();
    done(to);
  }
}
