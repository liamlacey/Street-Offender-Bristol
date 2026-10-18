import * as Phaser from 'phaser';
import { loadGunForward, loadMuted } from '../settings';
import { ChunkLayers } from '../scenes/ChunkLayers';
import { TEX, createPlaceholderTextures } from '../scenes/textures';
import { CloudShadows } from '../scenes/CloudShadows';
import { createDecorationTexture } from '../scenes/decorationArt';
import { BEACH_VARIANTS, CITY_VARIANTS, FIELD_VARIANTS, HARBOUR_VARIANTS, TANK_TEXTURE, TOWN_VARIANTS, VARIANTS, createTankTexture } from './art';
import { IslandLife } from './IslandLife';
import { type Driver, afloat, makeDriver, planTraffic, stepDriver, trafficSpecs } from './traffic';
import { type Train, planTrains, stepTrain, trainSpecs } from './train';
import { type Cop, arrival, stepCop, wanted } from './police';
import { BIOME, type Island, SIZE, biomeAt, islandSteps } from './island';
import { random } from './noise';
import { TankAudio } from './TankAudio';
import { Terrain } from './Terrain';
import {
  RELOAD,
  ROCKET_BLAST,
  bridgeAt,
  type Rocket,
  type Tank,
  type TankInput,
  createTank,
  launch,
  stepRocket,
  stepTank,
  wantsToFire,
} from './tank';
import { type Thing, World, type WorldEvent } from './world';

/** What the touch controls ask for (set by TankHudScene). */
export interface TouchInput {
  drive: { x: number; y: number } | null;
  aim: number | null;
  fire: boolean;
}

/** What the HUD shows, sent every frame. */
export interface TankState {
  x: number;
  y: number;
  heading: number;
  /** 0 (just fired) to 1 (ready). */
  ready: number;
  destroyed: number;
  fires: { x: number; y: number }[];
  /** How many police are after the tank, and where they (and the trains) are. */
  police: number;
  cops: { x: number; y: number }[];
  trains: { x: number; y: number }[];
}

export const TOUCH_KEY = 'tankTouch';
/** Whether the gun points the way the tank's going (true) or is aimed on its own (false). */
export const GUN_FORWARD_KEY = 'tankGunForward';
/** The island's seed, and its saved id if it's been saved (null if not). */
export const SEED_KEY = 'tankSeed';
export const SAVED_KEY = 'tankSaved';
export const ISLAND_KEY = 'tankIsland';
/** Whether the police come after the tank. */
export const POLICE_KEY = 'tankPolice';
export const STATE_EVENT = 'tankState';
export const MENU_EVENT = 'tankMenu';
export const NEW_ISLAND_EVENT = 'tankNewIsland';

const DEPTH = { ground: 0, water: 0.5, low: 2, shadows: 3, life: 3.5, things: 4, lift: 4.6, tank: 5, rockets: 6, clouds: 6.5, smoke: 7, fire: 8, flash: 9, sky: 9.5 };
/** How much the trees sway in the wind, radians, and how often the gusts come, s. */
const SWAY = { oak: 0.035, pine: 0.03, palm: 0.07, bush: 0.05 };
const GUST = 9;
/** Light from the top left: shadows fall down and right. */
const SHADOW = { x: 0.62, y: 0.78 };
/** How far each kind's shadow falls (its height, near enough), px. */
const SHADOW_LENGTH: Partial<Record<Thing['kind'], number>> = {
  oak: 12,
  pine: 12,
  palm: 12,
  bush: 3,
  rock: 4,
  boulder: 7,
  house: 9,
  barn: 11,
  car: 4,
  truck: 5,
  tractor: 5,
  haystack: 4,
  barrel: 3,
  crate: 3,
  fueltank: 10,
  boat: 3,
  fence: 2,
  townhouse: 10,
  shop: 7,
  church: 16,
  fountain: 3,
  bridge: 4,
  stonebridge: 5,
  beachhut: 6,
  tent: 3,
  logpile: 4,
  harvester: 5,
  lifttower: 16,
  liftstation: 8,
  chalet: 9,
  jetty: 3,
  warehouse: 11,
  crane: 6,
  container: 5,
  trawler: 4,
  forklift: 3,
  tower: 44,
  office: 22,
  bench: 1,
  bus: 5,
  station: 9,
  railbridge: 5,
  loco: 5,
  carriage: 5,
  police: 4,
  policevan: 5,
  silo: 14,
  combine: 6,
};
/** The colour things burn towards. */
const CHAR = 0x4a3428;
const MAX_DEBRIS = 160;
/** How long things smoulder after the fire's out, s. */
const SMOULDER = 25;

interface Sprite {
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image | null;
  /** Which way it fell (trees), radians. */
  fell: number;
}

interface Debris {
  image: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  spin: number;
}

/**
 * Tank World: an island to drive a tank round and blow up. Everything on it
 * reacts to a rocket by what it's made of (see world.ts); this draws it all
 * and the fire, smoke, dust and debris, and runs the tank, its rockets and
 * the camera. The controls are in TankHudScene.
 */
export class TankScene extends Phaser.Scene {
  private seed = 1;
  /** While the island's being built: the steps still to run, how many things have been put on it, and the loading screen. */
  private loading: { steps: Generator<number, Island>; progress: number; screen: Phaser.GameObjects.Container } | null = null;
  private island!: Island;
  private world!: World;
  private terrain!: Terrain;
  private chunks!: ChunkLayers;
  /** Each thing's sprite, by its id, once it's been near enough the view to be drawn. */
  private sprites: (Sprite | undefined)[] = [];
  /** The things in each area of the island (not the traffic), and which areas have been drawn. */
  private byArea = new Map<number, Thing[]>();
  private drawn = new Set<number>();
  private tank!: Tank;
  private hull!: Phaser.GameObjects.Image;
  private turret!: Phaser.GameObjects.Image;
  private tankShadow!: Phaser.GameObjects.Image;
  private rockets: { rocket: Rocket; image: Phaser.GameObjects.Image }[] = [];
  private debris: Debris[] = [];
  private smoulder = new Map<Thing, number>();
  private fireEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private blastEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private smokeEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private dustEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparkEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private leafEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private audio: TankAudio | null = null;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'space', Phaser.Input.Keyboard.Key>;
  private lastBlast = { x: 0, y: 0 };
  private life!: IslandLife;
  private clouds!: CloudShadows;
  private drivers: Driver[] = [];
  private trains: Train[] = [];
  private cops: Cop[] = [];
  /** Seconds till the next police car can turn up. */
  private copDue = 0;
  private flash = 0;
  /** The things that move about (the traffic), which aren't kept in the static chunks. */
  private movers = new Set<Thing>();
  /** Explosions (and the tank firing) this frame, to scare the people and animals. */
  private blasts: { x: number; y: number }[] = [];
  private treadDue = 0;
  private stateDue = 0;
  private look = { x: 0, y: 0 };

  constructor() {
    super('tank');
  }

  init(data: { seed?: number; savedId?: string }): void {
    this.seed = data.seed ?? Math.floor(Math.random() * 1_000_000) + 1;
    this.registry.set(SAVED_KEY, data.savedId ?? null);
    this.registry.set(SEED_KEY, this.seed);
    this.sprites = [];
    this.byArea = new Map();
    this.drawn = new Set();
    this.rockets = [];
    this.debris = [];
    this.smoulder = new Map();
    this.drivers = [];
    this.trains = [];
    this.cops = [];
    this.copDue = 3;
    this.movers = new Set();
    this.blasts = [];
    this.island = undefined as unknown as Island;
  }

  create(): void {
    this.sound.mute = loadMuted();
    if (!this.textures.exists(TEX.puff)) createPlaceholderTextures(this);
    createTankTexture(this);
    createDecorationTexture(this);
    this.cameras.main.setBackgroundColor('#184270').setZoom(1).setScroll(0, 0);
    // The island's built a bit at a time over the next few frames, behind a loading screen.
    this.loading = { steps: islandSteps(this.seed), progress: 0, screen: this.loadingScreen() };
  }

  /** The loading screen: a title, what's being done, and a bar filling up. */
  private loadingScreen(): Phaser.GameObjects.Container {
    const { width, height } = this.scale;
    const bar = Math.min(320, width - 60);
    const screen = this.add.container(width / 2, height / 2).setScrollFactor(0).setDepth(100);
    screen.add([
      this.add.text(0, -60, 'TANK WORLD', { fontFamily: 'monospace', fontSize: '30px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5).setShadow(2, 2, '#000', 4),
      this.add.text(0, -18, '', { fontFamily: 'monospace', fontSize: '14px', color: '#d0d7de' }).setOrigin(0.5).setName('stage'),
      this.add.rectangle(0, 18, bar + 6, 20, 0x10141a, 0.8).setStrokeStyle(2, 0xffffff, 0.6),
      this.add.rectangle(-bar / 2, 18, 0, 14, 0x6a8a3a).setOrigin(0, 0.5).setName('fill'),
    ]);
    screen.setData('bar', bar);
    return screen;
  }

  /**
   * Builds some more of the island (about 30 ms worth); when it's done, puts
   * it in the World and starts the game. (Things are only drawn once the view
   * nears them: see drawNear.)
   */
  private buildMore(): void {
    const loading = this.loading!;
    const until = performance.now() + 30;
    while (performance.now() < until) {
      const step = loading.steps.next();
      if (step.done) {
        this.island = step.value;
        // Vehicles driving the tracks and boats at sea go into the world after the island's own things.
        // (And then the trains.)
        const plans = planTraffic(this.island, random(this.seed + 11));
        const railway = this.island.railway;
        const trainPlans = railway ? planTrains(railway, random(this.seed + 17)) : [];
        const trainCars = railway ? trainSpecs(railway, trainPlans) : [];
        this.world = new World([...this.island.things, ...trafficSpecs(plans), ...trainCars], random(this.seed + 5));
        plans.forEach((p, k) => {
          const t = this.world.things[this.island.things.length + k];
          this.movers.add(t);
          this.drivers.push(makeDriver(p, t));
        });
        let car = this.island.things.length + plans.length;
        for (const p of trainPlans) {
          const cars = p.kinds.map(() => this.world.things[car++]);
          for (const c of cars) this.movers.add(c);
          this.trains.push({ cars, s: p.s, speed: 0, dwell: 0, last: -1, stopped: false });
        }
        for (const t of this.world.things) {
          if (this.movers.has(t)) continue;
          const key = areaKey(t.x, t.y);
          const list = this.byArea.get(key);
          if (list) list.push(t);
          else this.byArea.set(key, [t]);
        }
        this.chunks = new ChunkLayers(this);
        for (const t of this.movers) this.sprites[t.id] = this.makeSprite(t);
        loading.screen.destroy();
        this.loading = null;
        this.begin();
        return;
      }
      loading.progress = step.value;
    }
    const p = loading.progress;
    const stage = p < 0.3 ? 'Raising the land' : p < 0.42 ? 'Running the rivers' : p < 0.66 ? 'Laying out the towns and roads' : p < 0.7 ? 'Building the harbours' : 'Planting the forests';
    (loading.screen.getByName('stage') as Phaser.GameObjects.Text).setText(`${stage}...`);
    (loading.screen.getByName('fill') as Phaser.GameObjects.Rectangle).width = (loading.screen.getData('bar') as number) * p;
  }

  /** Everything else, once the island's ready: the tank, effects, life, camera, controls, sound, and the HUD. */
  private begin(): void {
    this.registry.set(ISLAND_KEY, this.island);
    this.registry.set(TOUCH_KEY, { drive: null, aim: null, fire: false } satisfies TouchInput);
    this.registry.set(GUN_FORWARD_KEY, loadGunForward());
    this.terrain = new Terrain(this, this.island, DEPTH.ground);

    this.tank = createTank(this.island);
    this.tankShadow = this.add.image(0, 0, TANK_TEXTURE, 'tank-hull').setTint(0x000000).setAlpha(0.3).setDepth(DEPTH.shadows);
    this.hull = this.add.image(0, 0, TANK_TEXTURE, 'tank-hull').setDepth(DEPTH.tank);
    // The turret turns about its own middle, 22 px in from the back of the picture.
    this.turret = this.add.image(0, 0, TANK_TEXTURE, 'tank-turret').setOrigin(22 / 64, 0.5).setDepth(DEPTH.tank + 0.1);
    this.createEmitters();
    this.life = new IslandLife(this, this.island, this.world, DEPTH, random(this.seed + 13));
    this.clouds = new CloudShadows(this, DEPTH.clouds, new Phaser.Math.RandomDataGenerator([`${this.seed}`]));

    const cam = this.cameras.main;
    cam.setBounds(0, 0, SIZE, SIZE);
    cam.setZoom(this.zoom());
    cam.centerOn(this.tank.x, this.tank.y);
    this.drawNear(cam.worldView, true);
    this.terrain.update(cam.worldView, 0, 99);

    const keyboard = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = keyboard.addKeys({ up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D, space: K.SPACE }) as typeof this.keys;

    const sound = this.sound as Phaser.Sound.WebAudioSoundManager;
    if ('context' in sound && sound.context) this.audio = new TankAudio(sound.context, sound.destination);

    const resize = () => this.cameras.main.setZoom(this.zoom());
    this.scale.on(Phaser.Scale.Events.RESIZE, resize);
    this.events.on(MENU_EVENT, () => this.scene.start('menu', { page: 'islands', listPage: 0 }));
    this.events.on(NEW_ISLAND_EVENT, () => this.scene.restart({ seed: Math.floor(Math.random() * 1_000_000) + 1 }));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, resize);
      this.events.off(MENU_EVENT);
      this.events.off(NEW_ISLAND_EVENT);
      this.audio?.destroy();
      this.audio = null;
      this.scene.stop('tankhud');
    });
    this.scene.launch('tankhud');
  }

  update(time: number, deltaMs: number): void {
    if (this.loading) {
      this.buildMore();
      return;
    }
    const dt = Math.min(0.05, deltaMs / 1000);
    const cam = this.cameras.main;
    const input = this.readInput();

    const crushed = stepTank(this.tank, input, this.island, this.world, dt);
    // What the tank smashes falls away from it.
    this.lastBlast = { x: this.tank.x, y: this.tank.y };
    this.handle(crushed);
    if (wantsToFire(this.tank, input)) this.fire();
    for (let k = this.rockets.length - 1; k >= 0; k--) {
      const r = this.rockets[k];
      const boom = stepRocket(r.rocket, this.world, dt);
      r.image.setPosition(r.rocket.x, r.rocket.y);
      if (Math.random() < 0.9) this.smokeEmitter.emitParticleAt(r.rocket.x - Math.cos(r.rocket.angle) * 10, r.rocket.y - Math.sin(r.rocket.angle) * 10, 1);
      if (!boom) continue;
      r.image.destroy();
      this.rockets.splice(k, 1);
      this.lastBlast = { x: boom.x, y: boom.y };
      // Into the ground (not something on it): a crater.
      if (!boom.hit) this.terrain.mark({ t: 'scorch', x: boom.x, y: boom.y, r: 34 });
      this.handle(this.world.blast(boom.x, boom.y, ROCKET_BLAST.radius, ROCKET_BLAST.power, boom.hit));
    }
    this.handle(this.world.update(dt));

    this.drawTank(dt);
    this.updateDebris(dt);
    this.updateFires(dt, cam.worldView);
    this.updateTraffic(dt, cam.worldView);
    this.updateTrains(dt);
    this.updatePolice(dt);
    this.sway(time, cam.worldView);
    this.life.update(time, dt, cam.worldView, this.tank, this.blasts);
    this.blasts = [];
    this.clouds.update(dt, cam.worldView);

    // The camera follows, looking a little ahead the way the turret's pointing.
    const lead = 90;
    this.look.x += (Math.cos(this.tank.turret) * lead - this.look.x) * Math.min(1, dt * 2);
    this.look.y += (Math.sin(this.tank.turret) * lead - this.look.y) * Math.min(1, dt * 2);
    const tx = this.tank.x + this.look.x;
    const ty = this.tank.y + this.look.y;
    cam.centerOn(cam.midPoint.x + (tx - cam.midPoint.x) * Math.min(1, dt * 6), cam.midPoint.y + (ty - cam.midPoint.y) * Math.min(1, dt * 6));
    this.drawNear(cam.worldView);
    this.terrain.update(cam.worldView, dt);
    this.chunks.update(cam);

    let burning = 0;
    for (const t of this.world.fires) burning += Math.max(0, 1 - Math.hypot(t.x - this.tank.x, t.y - this.tank.y) / 700);
    this.audio?.update(Math.min(1, Math.abs(this.tank.speed) / 230), Math.min(1, burning / 4));

    this.stateDue -= dt;
    if (this.stateDue <= 0) {
      this.stateDue = 0.1;
      const state: TankState = {
        x: this.tank.x,
        y: this.tank.y,
        heading: this.tank.heading,
        ready: 1 - this.tank.reload / RELOAD,
        destroyed: this.world.destroyed,
        fires: [...this.world.fires].slice(0, 60).map((t) => ({ x: t.x, y: t.y })),
        police: this.cops.filter((c) => !c.stopped).length,
        cops: this.cops.filter((c) => !c.stopped).map((c) => ({ x: c.thing.x, y: c.thing.y })),
        trains: this.trains.map((t) => ({ x: t.cars[0].x, y: t.cars[0].y })),
      };
      this.events.emit(STATE_EVENT, state);
    }
  }

  private zoom(): number {
    const { width, height } = this.scale;
    return Phaser.Math.Clamp(Math.min(width, height) / 430, 0.7, 1.3);
  }

  /** Touch, keyboard and mouse together. */
  private readInput(): TankInput {
    const touch = this.registry.get(TOUCH_KEY) as TouchInput;
    const k = this.keys;
    const throttle = (k.up.isDown || k.w.isDown ? 1 : 0) - (k.down.isDown || k.s.isDown ? 1 : 0);
    const turn = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    let aim = touch.aim;
    let fire = touch.fire || k.space.isDown;
    if (this.registry.get(GUN_FORWARD_KEY)) {
      // The gun points the way the tank's going (backwards when it's reversing it still points ahead).
      aim = this.tank.heading;
      if (!this.sys.game.device.input.touch) fire = fire || this.input.activePointer.leftButtonDown();
    } else if (!this.sys.game.device.input.touch) {
      // A mouse: the turret follows the pointer; click to fire.
      const p = this.input.activePointer;
      const world = this.cameras.main.getWorldPoint(p.x, p.y);
      aim = Math.atan2(world.y - this.tank.y, world.x - this.tank.x);
      fire = fire || p.leftButtonDown();
    }
    return { drive: touch.drive, throttle, turn, aim, fire };
  }

  private fire(): void {
    const rocket = launch(this.tank);
    const image = this.add.image(rocket.x, rocket.y, TANK_TEXTURE, 'rocket').setRotation(rocket.angle).setDepth(DEPTH.rockets);
    this.rockets.push({ rocket, image });
    // Muzzle flash, a puff of smoke, and the tank rocks back.
    for (let k = 0; k < 4; k++) this.fireEmitter.emitParticleAt(rocket.x, rocket.y, 1);
    this.smokeEmitter.emitParticleAt(rocket.x, rocket.y, 3);
    this.tank.speed -= 40;
    this.cameras.main.shake(80, 0.003);
    this.audio?.launch();
    this.blasts.push({ x: this.tank.x, y: this.tank.y });
  }

  private drawTank(dt: number): void {
    const { x, y, heading, turret } = this.tank;
    this.hull.setPosition(x, y).setRotation(heading);
    this.turret.setPosition(x, y).setRotation(turret);
    this.tankShadow.setPosition(x + SHADOW.x * 5, y + SHADOW.y * 5).setRotation(heading);
    // Tracks pressed into the ground behind it; in the water, spray thrown up off the hull.
    const b = biomeAt(this.island, x, y);
    const wading = (b === BIOME.river && !bridgeAt(this.world, x, y)) || b === BIOME.shallow;
    this.treadDue -= Math.abs(this.tank.speed) * dt;
    if (this.treadDue <= 0) {
      this.treadDue = 9;
      if (wading) {
        this.dustEmitter.setParticleTint(0xeaf4f8);
        for (const side of [-1, 1]) {
          const a = heading + side * 0.6 * Math.sign(this.tank.speed || 1);
          this.dustEmitter.emitParticleAt(x + Math.cos(a) * 26 * Math.sign(this.tank.speed || 1), y + Math.sin(a) * 26 * Math.sign(this.tank.speed || 1), 2);
        }
      } else this.terrain.mark({ t: 'tread', x, y, a: heading });
    }
  }

  // --- Things on the island ---------------------------------------------------------

  /**
   * Draws the things in the areas the view's near that haven't been drawn yet
   * (a couple of areas a frame, so driving on doesn't stutter; `all` at the start).
   */
  private drawNear(view: Phaser.Geom.Rectangle, all = false): void {
    const margin = 500;
    let budget = all ? Infinity : 2;
    for (let ay = Math.floor((view.top - margin) / AREA); ay <= Math.floor((view.bottom + margin) / AREA); ay++) {
      for (let ax = Math.floor((view.left - margin) / AREA); ax <= Math.floor((view.right + margin) / AREA); ax++) {
        const key = ay * 4096 + ax;
        if (this.drawn.has(key)) continue;
        if (budget-- <= 0) return;
        this.drawn.add(key);
        for (const t of this.byArea.get(key) ?? []) {
          if (t.phase === 'gone') continue;
          this.sprites[t.id] = this.makeSprite(t);
          // Something's happened to it already (a fire spreading out of sight).
          if (t.phase !== 'intact' || t.burnt || t.fire > 0) this.refresh(t);
        }
      }
    }
  }

  private makeSprite(t: Thing): Sprite {
    const image = this.add.image(t.x, t.y, TANK_TEXTURE, this.frameFor(t)).setRotation(this.restingAngle(t));
    const length = SHADOW_LENGTH[t.kind] ?? 0;
    let shadow: Phaser.GameObjects.Image | null = null;
    if (length > 0) {
      shadow = this.add
        .image(t.x + SHADOW.x * length, t.y + SHADOW.y * length, TANK_TEXTURE, image.frame.name)
        .setRotation(image.rotation)
        .setTint(0x000000)
        .setAlpha(0.28);
      if (this.movers.has(t)) shadow.setDepth(DEPTH.shadows);
      else this.chunks.add(shadow, DEPTH.shadows);
    }
    if (this.movers.has(t)) image.setDepth(DEPTH.things);
    else this.chunks.add(image, t.def.low || t.def.material === 'bridge' ? DEPTH.low : DEPTH.things);
    // A bridge stretches from bank to bank.
    if (t.def.material === 'bridge') for (const img of [image, shadow]) img?.setDisplaySize(t.length ?? t.def.w, t.def.h);
    return { image, shadow, fell: 0 };
  }

  /** Trees and rocks lie any way round; everything else faces the way it was put down. */
  private restingAngle(t: Thing): number {
    const m = t.def.material;
    return m === 'plant' || m === 'stone' || t.kind === 'haystack' || t.kind === 'barrel' || t.kind === 'fueltank' ? (t.variant * 2.399) % (Math.PI * 2) : t.angle;
  }

  private frameFor(t: Thing): string {
    const v = t.variant;
    const pick = (n: number) => v % n;
    const wrecked = t.phase === 'wrecked';
    switch (t.kind) {
      case 'oak':
      case 'pine':
      case 'palm':
        if (t.burnt && wrecked) return `ash-${pick(VARIANTS.ash)}`;
        return wrecked ? `fallen-${t.kind}` : `${t.kind}-${pick(VARIANTS[t.kind])}`;
      case 'bush':
        return wrecked ? `ash-${pick(VARIANTS.ash)}` : `bush-${pick(VARIANTS.bush)}`;
      case 'rock':
      case 'boulder':
        if (wrecked) return `rubble-${pick(VARIANTS.rubble)}`;
        return `${t.kind}-${pick(VARIANTS[t.kind])}${t.phase === 'damaged' ? '-cracked' : ''}`;
      case 'house':
        if (wrecked) return `hrubble-${pick(VARIANTS.rubble)}`;
        return `house-${pick(VARIANTS.house)}${t.phase === 'damaged' ? '-damaged' : ''}`;
      case 'barn':
        if (wrecked) return `hrubble-${pick(VARIANTS.rubble)}`;
        return t.phase === 'damaged' ? 'barn-damaged' : 'barn';
      case 'car':
        return wrecked ? 'wreck-car' : `car-${pick(VARIANTS.car)}`;
      case 'truck':
        return wrecked ? 'wreck-truck' : `truck-${pick(VARIANTS.truck)}`;
      case 'boat':
        return wrecked ? 'wreck-boat' : `boat-${pick(VARIANTS.boat)}`;
      case 'tractor':
        return wrecked ? 'wreck-tractor' : 'tractor';
      case 'fueltank':
        return wrecked ? 'wreck-fueltank' : 'fueltank';
      case 'haystack':
        return wrecked && t.burnt ? `ash-${pick(VARIANTS.ash)}` : 'haystack';
      case 'townhouse':
      case 'shop':
        if (wrecked) return `hrubble-${pick(VARIANTS.rubble)}`;
        return `${t.kind}-${pick(TOWN_VARIANTS[t.kind])}${t.phase === 'damaged' ? '-damaged' : ''}`;
      case 'church':
        if (wrecked) return `hrubble-${pick(VARIANTS.rubble)}`;
        return t.phase === 'damaged' ? 'church-damaged' : 'church';
      case 'fountain':
        if (wrecked) return `rubble-${pick(VARIANTS.rubble)}`;
        return t.phase === 'damaged' ? 'fountain-cracked' : 'fountain';
      case 'bridge':
      case 'stonebridge':
      case 'jetty':
      case 'railbridge':
        return wrecked ? `${t.kind}-broken` : t.kind;
      case 'tower':
      case 'office':
        if (wrecked) return `hrubble-${pick(VARIANTS.rubble)}`;
        return `${t.kind}-${pick(CITY_VARIANTS[t.kind])}${t.phase === 'damaged' ? '-damaged' : ''}`;
      case 'police':
      case 'policevan':
        return wrecked ? `wreck-${t.kind}` : `${t.kind}-0`;
      case 'loco':
      case 'carriage':
      case 'bus':
      case 'silo':
      case 'combine':
        return wrecked ? `wreck-${t.kind}` : t.kind;
      case 'station':
        return wrecked ? `hrubble-${pick(VARIANTS.rubble)}` : 'station';
      case 'warehouse':
        if (wrecked) return `hrubble-${pick(VARIANTS.rubble)}`;
        return t.phase === 'damaged' ? 'warehouse-damaged' : 'warehouse';
      case 'crane':
      case 'forklift':
        return wrecked ? `wreck-${t.kind}` : t.kind;
      case 'container':
      case 'trawler':
        return wrecked ? `wreck-${t.kind}` : `${t.kind}-${pick(HARBOUR_VARIANTS[t.kind])}`;
      case 'crop':
      case 'grass':
        if (wrecked) return t.flattened ? `${t.kind}-flat-${pick(FIELD_VARIANTS[t.kind])}` : t.kind === 'crop' ? 'crop-burnt' : 'stubble';
        return `${t.kind}-${pick(FIELD_VARIANTS[t.kind])}`;
      case 'tent':
        if (wrecked) return t.flattened ? `tent-flat-${pick(BEACH_VARIANTS.tent)}` : `ash-${pick(VARIANTS.ash)}`;
        return `tent-${pick(BEACH_VARIANTS.tent)}`;
      case 'beachhut':
        return wrecked ? `hrubble-${pick(VARIANTS.rubble)}` : `beachhut-${pick(BEACH_VARIANTS.beachhut)}`;
      case 'parasol':
        return `parasol-${pick(BEACH_VARIANTS.parasol)}`;
      case 'liftstation':
      case 'chalet':
        return wrecked ? `hrubble-${pick(VARIANTS.rubble)}` : t.kind;
      case 'campfire':
      case 'lifttower':
        return wrecked ? `rubble-${pick(VARIANTS.rubble)}` : t.kind;
      case 'stump':
        return wrecked ? `ash-${pick(VARIANTS.ash)}` : 'stump';
      case 'harvester':
        return wrecked ? 'wreck-harvester' : 'harvester';
      default:
        return t.kind;
    }
  }

  /** Brings a thing's picture up to date with what's happened to it. */
  private refresh(t: Thing): void {
    const s = this.sprites[t.id];
    if (!s) return;
    if (t.phase === 'gone') {
      s.image.setVisible(false);
      s.shadow?.setVisible(false);
      return;
    }
    const frame = this.frameFor(t);
    if (s.image.frame.name !== frame) s.image.setFrame(frame);
    if (t.def.material === 'bridge') {
      // Broken (or burnt) where it stands: keeps its length, darkened by fire.
      for (const img of [s.image, s.shadow]) img?.setFrame(frame).setDisplaySize(t.length ?? t.def.w, t.def.h);
      if (t.burnt) s.image.setTint(0x5a4a3e);
      else if (t.phase === 'damaged') s.image.setTint(0xb8b0a6);
      else if (t.fire <= 0) s.image.clearTint();
      return;
    }
    const flat = t.phase === 'wrecked' && !t.def.wreckSolid;
    const ash = frame.startsWith('ash');
    // Scaled to suit: rubble the size of what it was, the ash of a small thing small.
    let scale = 1;
    if (frame.startsWith('rubble')) scale = t.kind === 'boulder' ? 1.4 : t.kind === 'campfire' || t.kind === 'lifttower' ? 0.5 : 0.75;
    else if (frame.startsWith('hrubble')) scale = t.kind === 'tower' ? 1.9 : t.kind === 'barn' || t.kind === 'church' || t.kind === 'warehouse' || t.kind === 'office' ? 1.35 : t.kind === 'beachhut' ? 0.5 : 0.85;
    else if (ash) scale = t.def.r / 18;
    s.image.setScale(scale);
    if (t.phase === 'wrecked' && t.def.material === 'plant' && !ash) s.image.setRotation(s.fell);
    else if (!ash && !flat) s.image.setRotation(this.restingAngle(t));
    // Things that are down drop below the tank.
    const depth = flat ? DEPTH.low : t.def.low ? DEPTH.low : DEPTH.things;
    if (this.movers.has(t)) s.image.setDepth(depth);
    else this.chunks.add(s.image, depth);
    if (s.shadow) {
      const show = !flat;
      s.shadow.setVisible(show);
      if (show) s.shadow.setFrame(frame).setScale(scale).setRotation(s.image.rotation);
    }
    // Scorched by fire; blackened once it's burnt out (a ruin's rubble, a crushed bush flattened green).
    if (t.flattened && (t.kind === 'crop' || t.kind === 'grass' || t.kind === 'tent')) s.image.clearTint();
    else if (t.burnt) s.image.setTint(ash || frame === 'stubble' || frame === 'crop-burnt' ? 0xffffff : 0x6a625c);
    else if (t.kind === 'bush' && t.phase === 'wrecked') s.image.setTint(0x7a8a50).setScale(0.6);
    else if (t.phase === 'damaged' && (t.def.material === 'metal' || t.kind === 'beachhut' || t.kind === 'liftstation' || t.kind === 'chalet' || t.kind === 'lifttower')) s.image.setTint(0xb0aaa4);
    else if (t.fire <= 0) s.image.clearTint();
  }

  /** Shows what happened: new pictures, debris, dust, fireballs, sound. */
  private handle(events: WorldEvent[]): void {
    for (const e of events) {
      if (e.type === 'explode') {
        this.blasts.push({ x: e.x, y: e.y });
        this.lastBlast = { x: e.x, y: e.y };
        this.explosion(e.x, e.y, e.radius, e.thing);
        if (e.thing) this.refresh(e.thing);
        continue;
      }
      const t = e.thing;
      const s = this.sprites[t.id];
      const away = Math.atan2(t.y - this.lastBlast.y, t.x - this.lastBlast.x);
      const distance = Math.hypot(t.x - this.tank.x, t.y - this.tank.y);
      switch (e.type) {
        case 'damaged':
          this.dust(t.x, t.y, 6, t.def.material === 'metal' ? 0x55504b : 0x9c8b74);
          break;
        case 'crumble':
          this.fling(t.x, t.y, `shard-${t.variant % VARIANTS.shard}`, t.kind === 'boulder' ? 12 : 7, away, 1);
          this.dust(t.x, t.y, t.kind === 'boulder' ? 22 : 12, 0x9a948a);
          this.audio?.crumble(distance);
          break;
        case 'split':
          // Trees come down away from the blast.
          if (s) s.fell = away;
          if (t.def.material === 'plant') {
            this.leafEmitter.emitParticleAt(t.x, t.y, t.kind === 'bush' ? 6 : 14);
            this.fling(t.x, t.y, 'plank', t.kind === 'bush' ? 0 : 4, away, 0.8);
            if (t.kind !== 'bush') this.audio?.splinter(distance);
          } else {
            this.fling(t.x, t.y, 'straw', t.kind === 'crop' || t.kind === 'grass' ? 2 : 10, away, 0.6);
          }
          break;
        case 'collapse':
          if (t.def.material === 'bridge') {
            this.bridgeFalls(t, distance);
            break;
          }
          if (t.def.material === 'metal') {
            // Machinery buckling: scrap and dust.
            this.fling(t.x, t.y, 'scrap', 8, away, 1);
            this.dust(t.x, t.y, 14, 0x8d8378);
            this.audio?.collapse(distance);
            break;
          }
          this.fling(t.x, t.y, 'brick', 8, away, 1);
          this.fling(t.x, t.y, 'plank', 5, away, 1);
          this.dust(t.x, t.y, 30, 0x8d8378);
          this.cameras.main.shake(200, 0.004 * Math.max(0, 1 - distance / 900));
          this.audio?.collapse(distance);
          break;
        case 'splinter':
          this.fling(t.x, t.y, 'plank', t.kind === 'fence' ? 4 : 7, away, 0.9);
          this.audio?.splinter(distance);
          break;
        case 'ignite':
          break;
        case 'burntOut':
          this.smoulder.set(t, SMOULDER);
          // A wooden bridge burnt through falls in.
          if (t.def.material === 'bridge') this.bridgeFalls(t, distance);
          break;
      }
      this.refresh(t);
    }
  }

  /** The traffic driving on (the far-off waits); a hit vehicle's driver jumps out and runs. */
  private updateTraffic(dt: number, view: Phaser.Geom.Rectangle): void {
    for (const d of this.drivers) {
      const t = d.thing;
      if (Math.abs(t.x - view.centerX) > 2500 || Math.abs(t.y - view.centerY) > 2500) continue;
      if (stepDriver(d, dt, this.world, this.tank, this.drivers, this.island) && !afloat(t.kind)) this.life.bailOut(t.x + Math.cos(t.angle + Math.PI / 2) * 22, t.y + Math.sin(t.angle + Math.PI / 2) * 22);
      if (d.stopped) continue;
      // A combine harvester cuts the crop as it goes.
      if (t.kind === 'combine' && d.speed > 5) {
        const fx = t.x + Math.cos(t.angle) * 26;
        const fy = t.y + Math.sin(t.angle) * 26;
        for (const o of this.world.near(fx, fy, 24)) {
          if (o.kind === 'crop' && o.phase === 'intact' && Math.hypot(o.x - fx, o.y - fy) < 30) this.handle(this.world.harvest(o));
        }
        if (Math.random() < dt * 8) this.dust(t.x - Math.cos(t.angle) * 30, t.y - Math.sin(t.angle) * 30, 1, 0xd6b45a);
      }
      const s = this.sprites[t.id]!;
      s.image.setPosition(t.x, t.y).setRotation(t.angle);
      const length = SHADOW_LENGTH[t.kind] ?? 0;
      s.shadow?.setPosition(t.x + SHADOW.x * length, t.y + SHADOW.y * length).setRotation(t.angle);
      // Dust off the tracks behind them; a wake behind a boat.
      if (d.speed > 40 && Math.random() < dt * 6) {
        const bx = t.x - Math.cos(t.angle) * t.def.w * 0.5;
        const by = t.y - Math.sin(t.angle) * t.def.w * 0.5;
        this.dustEmitter.setParticleTint(afloat(t.kind) ? 0xffffff : 0xc9ac80);
        this.dustEmitter.emitParticleAt(bx, by, 1);
      }
    }
  }

  /** The trains going round (all of them, near or not: they keep to time); when one's hit, whoever's aboard gets off and runs. */
  private updateTrains(dt: number): void {
    const railway = this.island.railway;
    if (!railway) return;
    for (const train of this.trains) {
      const loco = train.cars[0];
      if (stepTrain(train, railway, this.world, this.tank, dt)) {
        for (let k = 0; k < 3; k++) this.life.bailOut(loco.x + Math.cos(loco.angle + Math.PI / 2) * 24 + k * 8, loco.y + Math.sin(loco.angle + Math.PI / 2) * 24);
      }
      if (train.stopped) continue;
      for (const car of train.cars) {
        const s = this.sprites[car.id]!;
        s.image.setPosition(car.x, car.y).setRotation(car.angle);
        const length = SHADOW_LENGTH[car.kind] ?? 0;
        s.shadow?.setPosition(car.x + SHADOW.x * length, car.y + SHADOW.y * length).setRotation(car.angle);
      }
      // A puff from the locomotive while it's pulling.
      if (train.speed > 20 && Math.random() < dt * 4) this.smokeEmitter.emitParticleAt(loco.x - Math.cos(loco.angle) * 20, loco.y - Math.sin(loco.angle) * 20, 1);
    }
  }

  /**
   * The police: once things are being destroyed (and they're switched on),
   * cars and vans turn up, more the more's destroyed, and race to cut the
   * tank off. Their lights flash; the siren's louder the nearer they are.
   */
  private updatePolice(dt: number): void {
    const on = !!this.registry.get(POLICE_KEY);
    const active = this.cops.filter((c) => !c.stopped);
    this.copDue -= dt;
    if (on && this.copDue <= 0 && active.length < wanted(this.world.destroyed)) {
      this.copDue = 1.5;
      const spec = arrival(this.island, this.tank, Math.random, Math.random() < 0.3);
      if (spec) {
        const t = this.world.add(spec);
        this.movers.add(t);
        this.sprites[t.id] = this.makeSprite(t);
        this.cops.push({ thing: t, speed: 0, stopped: false });
      }
    }
    this.flash += dt;
    const blink = Math.floor(this.flash / 0.22) % 2;
    let nearest = Infinity;
    for (const c of this.cops) {
      const t = c.thing;
      if (!on && !c.stopped) {
        // Called off: they go away.
        t.phase = 'gone';
        c.stopped = true;
        this.refresh(t);
        continue;
      }
      if (stepCop(c, dt, this.tank, this.world, this.island)) this.life.bailOut(t.x + Math.cos(t.angle + Math.PI / 2) * 22, t.y + Math.sin(t.angle + Math.PI / 2) * 22);
      if (c.stopped) continue;
      const s = this.sprites[t.id]!;
      s.image.setPosition(t.x, t.y).setRotation(t.angle).setFrame(`${t.kind}-${blink}`);
      const length = SHADOW_LENGTH[t.kind] ?? 0;
      s.shadow?.setPosition(t.x + SHADOW.x * length, t.y + SHADOW.y * length).setRotation(t.angle).setFrame(`${t.kind}-${blink}`);
      nearest = Math.min(nearest, Math.hypot(t.x - this.tank.x, t.y - this.tank.y));
    }
    this.audio?.siren(Math.max(0, 1 - nearest / 1400), this.flash);
  }

  /** Trees and bushes near the view swaying in the wind, harder in the gusts, now and then losing a leaf. */
  private sway(time: number, view: Phaser.Geom.Rectangle): void {
    const t0 = time / 1000;
    const gust = 0.55 + 0.45 * Math.sin((t0 * Math.PI * 2) / GUST) ** 2;
    const reach = Math.hypot(view.width, view.height) / 2 + 40;
    for (const t of this.world.near(view.centerX, view.centerY, reach)) {
      if (t.def.material !== 'plant' || (t.phase !== 'intact' && t.phase !== 'damaged') || t.fire > 0) continue;
      const amp = SWAY[t.kind as keyof typeof SWAY] * gust;
      const s = this.sprites[t.id];
      if (!s) continue;
      const a = this.restingAngle(t) + Math.sin(t0 * 1.7 + t.x * 0.013 + t.y * 0.007) * amp;
      s.image.setRotation(a);
      s.shadow?.setRotation(a);
      if (t.kind !== 'bush' && Math.random() < 0.0006 * gust) this.life.leaf(t.x, t.y);
    }
  }

  /** A bridge falling into the river: its middle drops in with a great splash, bits flying. */
  private bridgeFalls(t: Thing, distance: number): void {
    const stone = t.kind === 'stonebridge';
    this.dustEmitter.setParticleTint(0xffffff);
    for (let k = -1; k <= 1; k++) {
      const x = t.x + Math.cos(t.angle) * k * 22;
      const y = t.y + Math.sin(t.angle) * k * 22;
      this.dustEmitter.emitParticleAt(x, y, 10);
    }
    this.fling(t.x, t.y, stone ? `shard-${t.variant % VARIANTS.shard}` : 'plank', 10, 0, 0.9, true);
    if (stone) this.dust(t.x, t.y, 16, 0x9a948a);
    this.cameras.main.shake(220, 0.005 * Math.max(0, 1 - distance / 900));
    this.audio?.collapse(distance);
  }

  // --- Effects ------------------------------------------------------------------------

  private createEmitters(): void {
    this.smokeEmitter = this.add
      .particles(0, 0, TEX.puff, {
        lifespan: { min: 1800, max: 3200 },
        speedX: { min: 6, max: 34 },
        speedY: { min: -18, max: 6 },
        scale: { start: 0.5, end: 2.6 },
        alpha: { start: 0.42, end: 0 },
        tint: [0x2f2c2a, 0x4a4643, 0x6a6560],
        emitting: false,
      })
      .setDepth(DEPTH.smoke);
    this.dustEmitter = this.add
      .particles(0, 0, TEX.puff, {
        lifespan: { min: 700, max: 1500 },
        speed: { min: 30, max: 120 },
        scale: { start: 0.6, end: 2.2 },
        alpha: { start: 0.55, end: 0 },
        emitting: false,
      })
      .setDepth(DEPTH.smoke);
    this.fireEmitter = this.add
      .particles(0, 0, TEX.puff, {
        lifespan: { min: 250, max: 550 },
        speed: { min: 8, max: 40 },
        scale: { start: 0.75, end: 0.15 },
        alpha: { start: 0.95, end: 0 },
        tint: [0xffe066, 0xffa21a, 0xff5a1a, 0xe8361a],
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(DEPTH.fire);
    this.blastEmitter = this.add
      .particles(0, 0, TEX.puff, {
        lifespan: { min: 350, max: 750 },
        speed: { min: 40, max: 240 },
        scale: { start: 1.5, end: 0.3 },
        alpha: { start: 1, end: 0 },
        tint: [0xfff2a8, 0xffb21a, 0xff6a1a, 0xd8361a],
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(DEPTH.fire);
    this.sparkEmitter = this.add
      .particles(0, 0, TEX.spark, {
        lifespan: { min: 300, max: 700 },
        speed: { min: 120, max: 380 },
        scale: { start: 1, end: 0 },
        tint: [0xffe08a, 0xff9a3c],
        emitting: false,
      })
      .setDepth(DEPTH.fire);
    // Leaves and twigs blown off a tree.
    this.leafEmitter = this.add
      .particles(0, 0, TEX.spark, {
        lifespan: { min: 400, max: 900 },
        speed: { min: 60, max: 220 },
        scale: { start: 1.1, end: 0.3 },
        tint: [0x3f7d3a, 0x2c6330, 0x5a9a48, 0x6b4a2a],
        emitting: false,
      })
      .setDepth(DEPTH.fire);
  }

  /** A fireball, a flash, a ring of shock, smoke, sparks; scrap if it was a vehicle; the camera shakes. */
  private explosion(x: number, y: number, radius: number, thing: Thing | null): void {
    const size = radius / ROCKET_BLAST.radius;
    this.blastEmitter.emitParticleAt(x, y, Math.round(14 * size));
    this.sparkEmitter.emitParticleAt(x, y, Math.round(10 * size));
    this.smokeEmitter.emitParticleAt(x, y, Math.round(8 * size));
    const flash = this.add.circle(x, y, radius * 0.5, 0xfff4c0, 0.9).setDepth(DEPTH.flash).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: flash, scale: 1.6, alpha: 0, duration: 220, onComplete: () => flash.destroy() });
    const ring = this.add.circle(x, y, radius * 0.3).setStrokeStyle(3, 0xffffff, 0.5).setDepth(DEPTH.flash);
    this.tweens.add({ targets: ring, scale: 3.3, alpha: 0, duration: 380, onComplete: () => ring.destroy() });
    if (thing && (thing.def.material === 'metal' || thing.def.material === 'fuel')) {
      this.fling(x, y, 'scrap', Math.round(6 * size), Math.random() * 6.28, 1.6, true);
      this.terrain.mark({ t: 'scorch', x, y, r: radius * 0.45 });
    } else if (!thing) {
      this.fling(x, y, `shard-${Math.floor(Math.random() * VARIANTS.shard)}`, 4, Math.random() * 6.28, 0.7, true, 0x6b5236);
    }
    const distance = Math.hypot(x - this.tank.x, y - this.tank.y);
    const near = Math.max(0, 1 - distance / 1000);
    this.cameras.main.shake(140 + 120 * size, 0.006 * near * Math.min(2, size));
    this.audio?.explosion(radius, distance);
  }

  private dust(x: number, y: number, count: number, tint: number): void {
    this.dustEmitter.setParticleTint(tint);
    this.dustEmitter.emitParticleAt(x, y, count);
  }

  /** Bits thrown out from a point, mostly away from the blast (all round, if `round`). */
  private fling(x: number, y: number, frame: string, count: number, away: number, force: number, round = false, tint?: number): void {
    for (let k = 0; k < count; k++) {
      if (this.debris.length >= MAX_DEBRIS) this.settle(this.debris.shift()!);
      const a = round ? Math.random() * Math.PI * 2 : away + (Math.random() - 0.5) * 2.2;
      const speed = (120 + Math.random() * 260) * force;
      const image = this.add
        .image(x + (Math.random() - 0.5) * 14, y + (Math.random() - 0.5) * 14, TANK_TEXTURE, frame)
        .setRotation(Math.random() * 6.28)
        .setDepth(DEPTH.rockets);
      if (tint !== undefined) image.setTint(tint);
      this.debris.push({ image, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, spin: (Math.random() - 0.5) * 18 });
    }
  }

  private updateDebris(dt: number): void {
    const drag = Math.exp(-3.2 * dt);
    for (let k = this.debris.length - 1; k >= 0; k--) {
      const d = this.debris[k];
      d.image.x += d.vx * dt;
      d.image.y += d.vy * dt;
      d.image.rotation += d.spin * dt;
      d.vx *= drag;
      d.vy *= drag;
      d.spin *= drag;
      if (Math.hypot(d.vx, d.vy) < 18) {
        this.debris.splice(k, 1);
        this.settle(d);
      }
    }
  }

  /** Debris that's come to rest becomes part of the ground (and stays). */
  private settle(d: Debris): void {
    this.terrain.mark({ t: 'stamp', frame: d.image.frame.name, x: d.image.x, y: d.image.y, a: d.image.rotation, s: 1, alpha: 0.9 });
    d.image.destroy();
  }

  /** Flames licking over what's alight (and charring it), and smoke from it and from what's still smouldering. */
  private updateFires(dt: number, view: Phaser.Geom.Rectangle): void {
    const near = (x: number, y: number) => x > view.left - 80 && x < view.right + 80 && y > view.top - 80 && y < view.bottom + 80;
    for (const t of this.world.fires) {
      if (!near(t.x, t.y)) continue;
      const size = t.def.r / 18;
      // Strongest in the middle of its burning.
      const life = t.fire / t.def.burns;
      const strength = Math.min(1, Math.sin(Math.PI * Math.min(1, life)) * 1.6 + 0.25);
      for (let k = Math.random() < dt * 22 * size * strength ? 1 + Math.floor(size) : 0; k > 0; k--) {
        const a = Math.random() * 6.28;
        const r = Math.random() * t.def.r * 0.8;
        this.fireEmitter.emitParticleAt(t.x + Math.cos(a) * r, t.y + Math.sin(a) * r, 1);
      }
      if (Math.random() < dt * 5 * size) this.smokeEmitter.emitParticleAt(t.x, t.y, 1);
      this.sprites[t.id]?.image.setTint(Phaser.Display.Color.GetColor(...mixRGB(0xffffff, CHAR, Math.min(1, 1.2 - life))));
    }
    for (const [t, left] of this.smoulder) {
      const rest = left - dt;
      if (rest <= 0) {
        this.smoulder.delete(t);
        continue;
      }
      this.smoulder.set(t, rest);
      if (near(t.x, t.y) && Math.random() < dt * 1.5 * (rest / SMOULDER)) this.smokeEmitter.emitParticleAt(t.x, t.y, 1);
    }
  }
}

/** The areas things are drawn by, px (see drawNear). */
const AREA = 1024;

function areaKey(x: number, y: number): number {
  return Math.floor(y / AREA) * 4096 + Math.floor(x / AREA);
}

function mixRGB(a: number, b: number, t: number): [number, number, number] {
  const ca = Phaser.Display.Color.IntegerToColor(a);
  const cb = Phaser.Display.Color.IntegerToColor(b);
  return [ca.red + (cb.red - ca.red) * t, ca.green + (cb.green - ca.green) * t, ca.blue + (cb.blue - ca.blue) * t];
}
