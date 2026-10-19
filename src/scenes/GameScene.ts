import * as Phaser from 'phaser';
import { CarAudio } from '../audio/CarAudio';
import {
  CAR_LENGTH,
  CAR_WIDTH,
  type CarInput,
  DEFAULT_TUNING,
  type CarState,
  SURFACE_GRIP,
  createCar,
  forwardSpeed,
  lateralSpeed,
  stepCar,
} from '../car/CarPhysics';
import mapData from '../map/bristol.json';
import { TREE_SPECIES } from '../map/osm';
import { type GameMap, type Road, VEHICLE_ROADS } from '../map/osm';
import {
  CircleGrid,
  type ContactPoint,
  CAR_BUMP,
  SegmentGrid,
  collideBodyWithStatic,
  collideBodyWithWalls,
  collideCarWithBody,
  collideCarWithStatic,
  collideCarWithWalls,
  nearestOnSegment,
  stepBody,
} from '../physics/collisions';
import { Buildings } from '../world/Buildings';
import { DeckLayer } from '../world/DeckLayer';
import { Decks } from '../world/decks';
import { GroundLayer, paintSurfaces } from '../world/GroundLayer';
import { Perspective } from '../world/perspective';
import { Terrain } from '../world/terrain';
import { SURFACE_KIND, Surface, type SurfaceGrid } from '../world/surface';
import { type Light, lightAt } from '../world/lights';
import { CHUNK, type LooseProp, type Post, type World, beacons, buildWorld, chunkKey } from '../world/world';
import { ART_SCALE, TEX, TREE_KINDS, TREE_RADIUS, createArt } from './art';
import { CarEffects } from './CarEffects';
import { Wreckage } from './Wreckage';
import { Kerbs } from '../world/kerbs';
import { Humps } from '../world/humps';
import { WallLayer } from '../world/WallLayer';
import { type Debris, type DebrisKind, debris, impactSpeed } from '../world/damage';
import { HudScene, RESET_EVENT, STREET_EVENT } from './HudScene';
import { SkidMarks } from './SkidMarks';
import { TrafficLayer } from './TrafficLayer';
import { Traffic, VEHICLES, type Vehicle, collideBodies } from '../world/traffic';
import { type Boat, Boats } from '../world/boats';
import { BoatLayer } from './BoatLayer';
import { type Shape, STIFFNESS, type Wreck, hit as dentAt, newWreck, toBody, toWorld } from '../car/dents';
import { paintWreck } from './dentArt';
import { bodyLayout } from './vehicleArt';

/** Physics runs at a fixed rate so handling feels the same at any frame rate. */
const PHYSICS_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 8;

const DEPTH = {
  ground: 0,
  skids: 1,
  /** On the water, under the bridges. */
  boats: 1.5,
  props: 2,
  /** Garden walls, hedges, fences and railings. */
  walls: 2.2,
  /** A bridge's deck, with the car on it. */
  deckBelow: 2.5,
  carShadow: 3,
  car: 4,
  /** A bridge's deck, with the car below it, and what stands on the decks. */
  deckAbove: 4.5,
  onDeck: 4.6,
  effects: 5,
  trees: 6,
  buildings: 7,
};

/** How high the camera is when the view's shorter side is CAMERA_VIEW px, px (higher as it pulls back; the lower it is, the more the buildings lean). */
const CAMERA_HEIGHT = 1250;
const CAMERA_VIEW = 430;
/** How high traffic lights' heads and Belisha beacons' globes are, px. */
const LIGHT_HEIGHT = 3.5 * 8;
const BEACON_HEIGHT = 2.6 * 8;
/**
 * The view's shorter side, in map px: close in when the car's stopped or going
 * slowly, pulling back as you speed up (more and more quickly, the faster you
 * go), to the furthest at FULL_SPEED px/s, as in the old games.
 */
const VIEW_AT_REST = 270;
const VIEW_AT_SPEED = 620;
const FULL_SPEED = 400;
const PULL_EASE = 1.7;
/**
 * VIEW_AT_REST is for a phone (its screen's shorter side PHONE_SIDE css px or
 * less): on a bigger screen, the camera's further back at rest, so it doesn't
 * fill the screen with a few cars, by the screen's size (over a phone's) to the
 * power SCREEN_EASE; never further back than REST_MOST of VIEW_AT_SPEED.
 */
const PHONE_SIDE = 390;
const SCREEN_EASE = 0.55;
const REST_MOST = 0.9;
/** How long a hop off a speed hump lasts, seconds. */
const HOP_TIME = 0.35;
/** How many loose things (benches, bins, and the bits of what's been broken) before the smallest bits stop being kept. */
const MAX_LOOSE = 1500;

/**
 * Driving round Bristol: the map from OpenStreetMap, the car, the camera
 * that pulls back the faster you go, and everything you can hit.
 */
export class GameScene extends Phaser.Scene {
  private world!: World;
  private surfaces!: SurfaceGrid;
  private ground!: GroundLayer;
  private buildings!: Buildings;
  private terrain!: Terrain;
  private readonly perspective = new Perspective();
  /** The street furniture that never moves, and the height of the ground under each, px. */
  private props: { x: number; y: number; z: number; image: Phaser.GameObjects.Image; gone?: boolean }[] = [];
  /** What's up high on the fixed things: the cranes' jibs. */
  private raised: { x: number; y: number; z: number; image: Phaser.GameObjects.Image; prop: number; gone?: boolean }[] = [];
  /** What you hit on each level: the ground's, and the bridges' decks'. */
  private walls!: [SegmentGrid, SegmentGrid];
  private posts!: [CircleGrid, CircleGrid];
  private decks!: Decks;
  private deckLayer!: DeckLayer;
  /** Which level the car's on: 0 the ground, 1 a bridge's deck. */
  private level = 0;
  private car!: CarState;
  private carSprite!: Phaser.GameObjects.Image;
  private carShadow!: Phaser.GameObjects.Image;
  private trees: { x: number; y: number; z: number; h: number; image: Phaser.GameObjects.Image; gone?: boolean }[] = [];
  /** Each traffic light's head, up its pole, with what it's showing. */
  private signalHeads: { x: number; y: number; z: number; controller: number; group: number; light: Light; image: Phaser.GameObjects.Image; gone?: boolean }[] = [];
  /** The Belisha beacons' globes, flashing. */
  private beacons: { x: number; y: number; z: number; image: Phaser.GameObjects.Image; gone?: boolean }[] = [];
  private wreckage!: Wreckage;
  private kerbs!: Kerbs;
  private humps!: Humps;
  /** A little hop off a speed hump: how high at most (0 to 1), and how long it has left, seconds. */
  private hopPeak = 0;
  private hopLeft = 0;
  private wallLayer!: WallLayer;
  private traffic!: Traffic;
  /** Your car's damage, and the version of it its picture shows. */
  private readonly wreck: Wreck = newWreck();
  private wreckShown = 0;
  private trafficLayer!: TrafficLayer;
  private boats!: Boats;
  private boatLayer!: BoatLayer;
  private loose: { body: LooseProp; image: Phaser.GameObjects.Image }[] = [];
  private looseByChunk = new Map<string, number[]>();
  private effects!: CarEffects;
  private skids!: SkidMarks;
  private audio: CarAudio | null = null;
  private hud!: HudScene;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'space' | 'r', Phaser.Input.Keyboard.Key>;
  private input_: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private accumulator = 0;
  /** Where the car was before the last physics step: it's drawn (and followed) between that and where it is now, by how far into the next step the frame is, so it moves smoothly whatever the screen's refresh rate. */
  private prev = { x: 0, y: 0, heading: 0 };
  /** Where it's drawn this frame. */
  private shown = { x: 0, y: 0, heading: 0 };
  private zoom = 1;
  private zoomRate = 0;
  /** How far ahead of the car the camera looks (and how fast that's changing), and the car's speed the zoom goes by, smoothed. */
  private lookX = 0;
  private lookY = 0;
  private lookVX = 0;
  private lookVY = 0;
  private pace = 0;
  /** The camera shaken by a jolt: for how long (s), how long it's been, and how far, map px. */
  private shaking = { for: 0, t: 0, size: 0 };
  private surface: Surface = Surface.Road;
  /** Seconds since the car went into the harbour, or -1. */
  private sinking = -1;
  private safe = { x: 0, y: 0, heading: 0 };
  private safeTimer = 0;
  private streetTimer = 0;
  private street = '';
  private bigHit = 0;
  private readonly contact: ContactPoint = { x: 0, y: 0 };

  constructor() {
    super('game');
  }

  create(): void {
    // Its own copy of the trees: knocking one down changes it.
    const map = { ...(mapData as unknown as GameMap), trees: [...(mapData as unknown as GameMap).trees] };
    this.world = buildWorld(map);
    this.surfaces = paintSurfaces(this.world);
    createArt(this);
    this.walls = [new SegmentGrid(this.world.walls[0]), new SegmentGrid(this.world.walls[1])];
    this.posts = [new CircleGrid(this.world.posts[0]), new CircleGrid(this.world.posts[1])];
    this.terrain = new Terrain(map.terrain, map.pxPerMetre);
    this.ground = new GroundLayer(this, this.world, this.terrain, DEPTH.ground);
    this.skids = new SkidMarks(this, this.terrain, DEPTH.skids);
    this.effects = new CarEffects(this, this.skids, DEPTH.effects);
    this.buildings = new Buildings(this, this.world, this.terrain, DEPTH.buildings);
    this.kerbs = new Kerbs(map);
    this.humps = new Humps(map);
    this.decks = new Decks(map.roads, (x, y) => this.groundAt(x, y));
    this.deckLayer = new DeckLayer(this, this.decks);
    this.wallLayer = new WallLayer(this, this.walls, (x, y, level) => this.surfaceHeight(x, y, level), DEPTH.walls);
    this.wreckage = new Wreckage(this, this.walls, this.posts, this.effects, {
      groundAt: (x, y) => this.groundAt(x, y),
      addDebris: (d, level) => this.addDebris(d, level),
      knockedDown: (post) => this.knockedDown(post),
      treeFell: (index, x, y, h, angle) => {
        const t = this.trees[index];
        const map = this.world.map;
        // It's going over: its shadow's gone from the ground.
        if (map.trees[index * 4 + 2] > 0) {
          map.trees[index * 4 + 2] = 0;
          this.ground.repaint(t.x, t.y, map.trees[index * 4 + 3] + 64);
        }
        Object.assign(t, { x, y, h });
        if (angle !== undefined) t.image.setRotation(angle);
      },
      treeHeight: (index) => this.trees[index].h,
      treeRadius: (index) => this.trees[index].image.displayWidth / 2,
      crownGone: (index) => {
        this.trees[index].gone = true;
        this.trees[index].image.setVisible(false);
      },
      audio: () => this.audio,
      weight: () => 1,
      wallBroken: (kind, from, to) => {
        if (kind === 'parapet') this.deckLayer.breakParapet(from, to);
      },
    }, DEPTH.props - 0.1, DEPTH.trees);
    this.addProps();
    this.addTrees();
    this.addLights();
    this.traffic = new Traffic(map);
    this.boats = new Boats(map);
    this.boatLayer = new BoatLayer(this, this.boats, (x, y) => this.groundAt(x, y), DEPTH.boats);
    this.trafficLayer = new TrafficLayer(this, this.traffic, (x, y, level) => this.surfaceHeight(x, y, level), (x, y, reach) => this.decks.atEnd(x, y, reach), {
      ground: DEPTH.car - 0.05,
      onDeck: DEPTH.onDeck,
      below: DEPTH.deckBelow - 0.05,
      beside: DEPTH.car - 0.05,
    });

    const { spawn } = map;
    this.car = createCar(spawn.x, spawn.y, spawn.heading);
    this.safe = { ...spawn };
    this.carShadow = this.add.image(0, 0, TEX.carShadow).setScale(1 / ART_SCALE).setTint(0x000000).setAlpha(0.35).setDepth(DEPTH.carShadow);
    this.carSprite = this.add.image(0, 0, TEX.car).setScale(1 / ART_SCALE).setDepth(DEPTH.car);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, map.width, map.height);
    cam.setBackgroundColor('#2b5c78');
    this.zoom = this.restZoom();
    cam.setZoom(this.zoom);
    cam.centerOn(this.car.x, this.car.y);
    this.updatePerspective();
    this.ground.update(cam.worldView, this.perspective, true);

    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: kb.addKey(K.UP),
      down: kb.addKey(K.DOWN),
      left: kb.addKey(K.LEFT),
      right: kb.addKey(K.RIGHT),
      w: kb.addKey(K.W),
      a: kb.addKey(K.A),
      s: kb.addKey(K.S),
      d: kb.addKey(K.D),
      space: kb.addKey(K.SPACE),
      r: kb.addKey(K.R),
    };
    this.keys.r.on('down', () => this.resetCar());
    this.events.on(RESET_EVENT, this.resetCar, this);

    this.scene.launch('hud');
    this.hud = this.scene.get('hud') as HudScene;

    // Web Audio only (the old HTML5 audio fallback can't synthesise).
    const sound = this.sound as Phaser.Sound.WebAudioSoundManager;
    if ('context' in sound && sound.context) this.audio = new CarAudio(sound.context, sound.destination);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.audio?.destroy();
      this.audio = null;
      this.events.off(RESET_EVENT, this.resetCar, this);
    });
  }

  /** The camera's zoom with the car stopped. */
  private restZoom(): number {
    const side = Math.min(this.scale.width, this.scale.height);
    return side / restView(side);
  }

  /** Lamp posts, bollards, benches, bins and the rest. */
  private addProps(): void {
    for (const p of this.world.fixed) {
      // Those on a bridge stand on its deck, and are drawn over it.
      const deck = p.level === 1 ? this.decks.over(p.x, p.y) : null;
      const z = deck ? this.decks.height(deck.deck, deck.along) : this.groundAt(p.x, p.y);
      const image = this.add
        .image(p.x, p.y, TEX.prop(p.kind))
        .setScale(1 / ART_SCALE)
        .setRotation(p.angle ?? 0)
        .setDepth(deck ? DEPTH.onDeck : DEPTH.props)
        .setVisible(false);
      // A ladder runs from the quay's edge down into the water.
      if (p.kind === 'ladder') image.setOrigin(0, 0.5);
      this.props.push({ x: p.x, y: p.y, z, image });
      if (p.kind === 'crane' && p.height) {
        // Its jib, up high, reaching out over the water from where it's pinned.
        const jib = this.add
          .image(p.x, p.y, TEX.jib)
          .setOrigin(0.04, 0.5)
          .setRotation(p.angle ?? 0)
          .setDepth(DEPTH.buildings + 0.5)
          .setVisible(false);
        jib.setDisplaySize(p.height * 1.25, 1.4 * 8);
        this.raised.push({ x: p.x, y: p.y, z: z + p.height, image: jib, prop: this.props.length - 1 });
      }
    }
    this.world.loose.forEach((body, i) => {
      const image = this.add
        .image(body.x, body.y, TEX.prop(body.kind))
        .setScale(1 / ART_SCALE)
        .setRotation(body.angle)
        .setDepth(body.level === 1 ? DEPTH.onDeck : DEPTH.props);
      this.loose.push({ body, image });
      const key = chunkKey(Math.floor(body.x / CHUNK), Math.floor(body.y / CHUNK));
      const list = this.looseByChunk.get(key);
      if (list) list.push(i);
      else this.looseByChunk.set(key, [i]);
    });
  }

  /** The traffic lights and Belisha beacons, up on their poles. */
  private addLights(): void {
    const { signals } = this.world.map;
    for (const s of signals) {
      const image = this.add.image(s.x, s.y, TEX.light('red')).setScale(1.3 / ART_SCALE).setRotation(s.angle).setDepth(DEPTH.trees).setVisible(false);
      this.signalHeads.push({ x: s.x, y: s.y, z: this.groundAt(s.x, s.y) + LIGHT_HEIGHT, controller: s.controller, group: s.group, light: 'red', image });
    }
    for (const b of beacons(this.world.map)) {
      const image = this.add.image(b.x, b.y, TEX.beacon(true)).setScale(1.3 / ART_SCALE).setDepth(DEPTH.trees).setVisible(false);
      this.beacons.push({ x: b.x, y: b.y, z: this.groundAt(b.x, b.y) + BEACON_HEIGHT, image });
    }
  }

  /** Sets each light near the view to what its controller says, and the beacons flashing. */
  private updateLights(view: Phaser.Geom.Rectangle): void {
    const p = this.perspective;
    const time = this.time.now / 1000;
    const { controllers } = this.world.map;
    const near = (x: number, y: number) => x > view.left - 120 && x < view.right + 120 && y > view.top - 120 && y < view.bottom + 120;
    for (const l of this.signalHeads) {
      const show = !l.gone && near(l.x, l.y);
      if (l.image.visible !== show) l.image.setVisible(show);
      if (!show) continue;
      const light = lightAt(controllers[l.controller], l.controller, l.group, time);
      if (light !== l.light) {
        l.light = light;
        l.image.setTexture(TEX.light(light));
      }
      const s = p.lift(l.z);
      l.image.setPosition(p.x(l.x, s), p.y(l.y, s));
    }
    const on = time % 1 < 0.5;
    for (const b of this.beacons) {
      const show = !b.gone && near(b.x, b.y);
      if (b.image.visible !== show) b.image.setVisible(show);
      if (!show) continue;
      b.image.setTexture(TEX.beacon(on));
      const s = p.lift(b.z);
      b.image.setPosition(p.x(b.x, s), p.y(b.y, s));
    }
  }

  private addTrees(): void {
    const t = this.world.map.trees;
    // Those whose species is known, drawn as that.
    const species = new Map<number, string>();
    const known = this.world.map.treeSpecies ?? [];
    for (let k = 0; k + 1 < known.length; k += 2) species.set(known[k], TREE_SPECIES[known[k + 1]]);
    for (let i = 0; i < t.length; i += 4) {
      const image = this.add
        .image(t[i], t[i + 1], species.has(i / 4) ? TEX.species(species.get(i / 4)!) : TEX.tree((i / 4) % TREE_KINDS))
        .setScale(t[i + 2] / TREE_RADIUS / ART_SCALE)
        .setRotation(((i * 1.7) % 6.28) - 3.14)
        .setDepth(DEPTH.trees)
        .setVisible(false);
      this.trees.push({ x: t[i], y: t[i + 1], z: this.groundAt(t[i], t[i + 1]), h: t[i + 3], image });
    }
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.1);
    this.readInput();
    this.accumulator = Math.min(this.accumulator + dt, PHYSICS_DT * MAX_STEPS_PER_FRAME);
    while (this.accumulator >= PHYSICS_DT) {
      this.accumulator -= PHYSICS_DT;
      this.prev = { x: this.car.x, y: this.car.y, heading: this.car.heading };
      this.step(PHYSICS_DT);
    }
    this.interpolate(this.accumulator / PHYSICS_DT);
    this.updateSinking(dt);
    this.updateLoose();
    this.updateTraffic(dt);
    this.hopLeft = Math.max(0, this.hopLeft - dt);
    this.drawCar();
    // No tyre marks on the bridges (they'd be laid on the ground below).
    if (this.sinking < 0 && this.level === 0) this.effects.update(this.car, this.input_, SURFACE_KIND[this.surface], dt);
    this.skids.flush();
    this.updateCamera(dt);
    this.updatePerspective();
    const view = this.cameras.main.worldView;
    this.ground.update(view, this.perspective);
    this.skids.update(view, this.perspective);
    // A bridge is drawn over the car when it's underneath, and under it when it's on top.
    // (And under it at the end of a bridge you're driving onto or off, where the deck meets the road.)
    this.deckLayer.update(view, this.perspective, (i) =>
      this.level === 1 || this.decks.atEnd(this.car.x, this.car.y, CAR_LENGTH / 2 + 4, this.decks.decks[i]) ? DEPTH.deckBelow : DEPTH.deckAbove,
    );
    this.buildings.update(view, this.perspective, this.car.x, this.car.y);
    // Before the trees: it moves the ones coming down.
    this.wreckage.update(view, this.perspective);
    this.updateTrees(view);
    this.updateProps(view);
    this.updateLights(view);
    this.wallLayer.update(view, this.perspective);
    this.trafficLayer.update(view, this.perspective, this.level, this.time.now / 1000);
    this.boatLayer.update(view, this.perspective, this.time.now / 1000);
    this.updateStreet(dt);
    const speed = Math.hypot(this.car.vx, this.car.vy);
    this.audio?.update({
      speed: this.sinking >= 0 ? 0 : Math.abs(forwardSpeed(this.car)),
      throttle: this.sinking >= 0 ? 0 : this.input_.throttle,
      slide: Math.max(Math.abs(lateralSpeed(this.car)), this.input_.handbrake ? speed * 0.6 : 0),
      surface: SURFACE_KIND[this.surface],
    });
    if (this.bigHit > 0) {
      this.audio?.crash(this.bigHit);
      if (this.bigHit > 220) this.shake(0.12, Math.min(7, this.bigHit / 68));
      this.bigHit = 0;
    }
  }

  private readInput(): void {
    const k = this.keys;
    const touch = this.hud?.drive;
    const left = k.left.isDown || k.a.isDown;
    const right = k.right.isDown || k.d.isDown;
    const keySteer = (right ? 1 : 0) - (left ? 1 : 0);
    const steer = keySteer !== 0 ? keySteer : (touch?.steer ?? 0);
    const throttle = k.up.isDown || k.w.isDown || touch?.gas ? 1 : 0;
    const brake = k.down.isDown || k.s.isDown || touch?.brake ? 1 : 0;
    const handbrake = k.space.isDown || !!touch?.handbrake;
    if (this.sinking >= 0) Object.assign(this.input_, { throttle: 0, brake: 0, steer: 0, handbrake: false });
    else Object.assign(this.input_, { throttle, brake, steer, handbrake });
  }

  /** One fixed physics step: drive, then hit things. */
  private step(dt: number): void {
    const car = this.car;
    if (this.sinking >= 0) {
      // Going down: the water drags the car to a stop.
      car.vx *= Math.exp(-4 * dt);
      car.vy *= Math.exp(-4 * dt);
      car.x += car.vx * dt;
      car.y += car.vy * dt;
      return;
    }
    const before = this.surface;
    // On a bridge, its deck's surface and slope; otherwise the ground's.
    const on = this.level === 1 ? this.decks.over(car.x, car.y) : null;
    this.surface = on ? deckSurface(on.deck.road) : this.surfaces.at(car.x, car.y);
    const [sx, sy] = on ? this.decks.slope(on.deck, on.along) : this.terrain.slope(car.x, car.y);
    const [px, py] = [car.x, car.y];
    stepCar(car, this.input_, dt, SURFACE_GRIP[SURFACE_KIND[this.surface]], DEFAULT_TUNING, { x: sx, y: sy });
    // Over a speed hump: a jolt, and a little hop.
    if (this.level === 0) {
      const hump = this.humps.over(car, px, py);
      if (hump > 0) {
        this.audio?.crash(hump * 1.5);
        if (hump > 25) this.shake(0.09, Math.min(2.4, hump / 20));
        this.hopPeak = Math.min(1, hump / 60);
        this.hopLeft = HOP_TIME;
      }
    }
    // Up or down a kerb: a jolt.
    if (this.level === 0 && before !== this.surface) {
      const up = before === Surface.Road && this.surface === Surface.Pavement;
      const down = before === Surface.Pavement && this.surface === Surface.Road;
      const jolt = up || down ? this.kerbs.bump(car, up) : 0;
      if (jolt > 0) {
        this.audio?.crash(jolt * 2);
        if (up && jolt > 16) this.shake(0.07, Math.min(1.8, jolt / 17));
      }
    }

    // Whatever the car's going into hard enough gives way first; then it bounces off what's left.
    const [bvx, bvy] = [car.vx, car.vy];
    this.wreckage.hit(car, this.level);
    // What gave way took speed off the car: a hit on its front, as hard as that.
    const lost = Math.hypot(car.vx - bvx, car.vy - bvy);
    if (lost > 0) {
      const sp = Math.hypot(bvx, bvy) || 1;
      this.dent(null, car.x + (bvx / sp) * (CAR_LENGTH / 2), car.y + (bvy / sp) * (CAR_LENGTH / 2), lost);
    }
    const wall = collideCarWithWalls(car, this.walls[this.level], undefined, this.contact);
    if (wall > 0) {
      this.hit(wall);
      this.dent(null, this.contact.x, this.contact.y, wall);
    }
    const post = collideCarWithStatic(car, this.posts[this.level], undefined, this.contact);
    if (post > 0) {
      this.hit(post);
      this.dent(null, this.contact.x, this.contact.y, post);
    }
    // The traffic, and the parked cars: knocked about (and it stops a moment).
    for (const v of this.traffic.near(car.x, car.y, CAR_LENGTH + 80)) {
      if (v.level !== this.level) continue;
      const bump = collideCarWithBody(car, v, CAR_BUMP, this.contact);
      if (bump <= 0) continue;
      const fresh = v.mode === 'drive';
      this.traffic.knock(v, bump);
      this.hit(bump);
      // Both dented where they met.
      this.dent(v, this.contact.x, this.contact.y, bump);
      this.dent(null, this.contact.x, this.contact.y, bump);
      // A good knock: a long blast of its horn, once it's stopped.
      if (fresh && bump > 120) this.time.delayedCall(700, () => this.audio?.horn(this.hearing(v.x, v.y), true));
    }
    // The boats (moored, under way, or adrift), on the water under the bridges: knocked adrift, and dented.
    if (this.level === 0) {
      for (const b of this.boats.near(car.x, car.y, CAR_LENGTH)) {
        const bump = collideCarWithBody(car, b, CAR_BUMP, this.contact);
        if (bump <= 0) continue;
        this.boats.knock(b, bump);
        this.hit(bump);
        this.dentBoat(b, this.contact.x, this.contact.y, bump);
        this.dent(null, this.contact.x, this.contact.y, bump);
      }
    }
    // Up onto a bridge at its end, or down off it.
    const level = this.decks.levelAt(this.level, car.x, car.y);
    if (level !== this.level) {
      this.level = level;
      // So no tyre mark joins one level to the other.
      this.effects.reset();
    }
    for (const i of this.nearbyLoose(car.x, car.y)) {
      const { body, image } = this.loose[i];
      if (body.level !== this.level || body.gone) continue;
      // Hit hard enough, a bench smashes to pieces, and what's already broken breaks up further.
      if (this.wreckage.smash(body, car, impactSpeed(car, body.x, body.y, body.r + (body.length ?? 0) / 2, body.vx, body.vy))) {
        image.destroy();
        continue;
      }
      const knock = collideCarWithBody(car, body, undefined, this.contact);
      if (knock > 0) {
        this.dent(null, this.contact.x, this.contact.y, knock);
        body.moved = true;
        if (knock > 60) this.audio?.knock();
      }
    }

    if (this.surface === Surface.Deep && this.level === 0) {
      this.sinking = 0;
      this.audio?.splash(Math.hypot(car.vx, car.vy) + 150);
      this.audio?.sink();
      this.effects.splashAt(car.x, car.y, 30);
    } else if (this.surface === Surface.Pool && before !== Surface.Pool) {
      this.audio?.splash(Math.hypot(car.vx, car.vy));
      this.effects.splashAt(car.x, car.y, 12);
    }
  }

  /** The traffic drives on; what's been knocked about hits the walls and posts; and anyone held up by you honks. */
  private updateTraffic(dt: number): void {
    const view = this.cameras.main.worldView;
    const { controllers, signals } = this.world.map;
    const time = this.time.now / 1000;
    const car = this.car;
    // The game mustn't stop for the traffic: anything going wrong in it is logged, and the game goes on.
    try {
      this.traffic.update(
        dt,
        { x: car.x, y: car.y, heading: car.heading, vx: car.vx, vy: car.vy, level: this.level, length: CAR_LENGTH, width: CAR_WIDTH },
        { x0: view.left, y0: view.top, x1: view.right, y1: view.bottom },
        (i) => (this.signalHeads[i]?.gone ? 'green' : lightAt(controllers[signals[i].controller], signals[i].controller, signals[i].group, time)),
      );
    } catch (e) {
      console.error('traffic:', e);
    }
    try {
      this.boats.update(dt);
    } catch (e) {
      console.error('boats:', e);
    }
    // Boats knocked into each other, or into the side of the harbour; and cars knocked into the boats.
    for (const h of this.boats.hits) {
      this.dentBoat(h.a, h.x, h.y, h.impulse);
      this.dentBoat(h.b, h.x, h.y, h.impulse);
    }
    this.boats.hits.length = 0;
    for (const g of this.boats.grounded) this.dentBoat(g.boat, g.x, g.y, g.impulse);
    this.boats.grounded.length = 0;
    for (const v of this.traffic.loose()) {
      if (v.level !== 0) continue;
      for (const b of this.boats.near(v.x, v.y, v.length)) {
        const hit = collideBodies(v, b, 0.3, this.contact);
        if (hit <= 0) continue;
        this.boats.knock(b, hit);
        this.dent(v, this.contact.x, this.contact.y, hit);
        this.dentBoat(b, this.contact.x, this.contact.y, hit);
      }
    }
    for (const v of this.traffic.loose()) {
      const wall = collideBodyWithWalls(v, this.walls[v.level], 0.4, this.contact);
      if (wall > 0) this.dent(v, this.contact.x, this.contact.y, wall / v.invMass);
      collideBodyWithStatic(v, this.posts[v.level]);
    }
    // Vehicles shunted into each other: both dented.
    for (const h of this.traffic.hits) {
      this.dent(h.a, h.x, h.y, h.impulse);
      this.dent(h.b, h.x, h.y, h.impulse);
    }
    this.traffic.hits.length = 0;
    for (const v of this.traffic.vehicles) {
      if (v.annoyed > 2.5) {
        this.audio?.horn(this.hearing(v.x, v.y), Math.random() < 0.3);
        v.annoyed = -3 - Math.random() * 3;
      }
    }
    // Smoke from wrecked engines (yours too); car alarms beeping.
    const seen = (x: number, y: number) => x > view.left - 40 && x < view.right + 40 && y > view.top - 40 && y < view.bottom + 40;
    for (const v of [...this.traffic.vehicles, ...this.traffic.parked]) {
      if (!seen(v.x, v.y)) continue;
      if ((v.broken || (v.limping && v.wreck && v.wreck.taken.front > 60)) && Math.random() < dt * (v.broken ? 9 : 4)) {
        this.effects.smokeAt(v.x + Math.cos(v.angle) * v.length * 0.35, v.y + Math.sin(v.angle) * v.length * 0.35);
      }
      if (v.alarm > 0 && Math.floor(v.alarm * 2.2) !== Math.floor((v.alarm + dt) * 2.2)) this.audio?.beep(this.hearing(v.x, v.y));
    }
    for (const b of this.boats.boats) {
      if (!(b.broken || b.limping) || !seen(b.x, b.y) || Math.random() > dt * (b.broken ? 9 : 4)) continue;
      // From its engine, at the back.
      this.effects.smokeAt(b.x - Math.cos(b.angle) * b.length * 0.3, b.y - Math.sin(b.angle) * b.length * 0.3);
    }
    if (this.wreck.taken.front > 120 && Math.random() < dt * 6) {
      this.effects.smokeAt(this.car.x + Math.cos(this.car.heading) * 12, this.car.y + Math.sin(this.car.heading) * 12);
    }
  }

  /**
   * Damage where a vehicle (or your car, for null) has been hit, at (x, y),
   * this hard: dents and scratches there, and what comes off falls to the
   * ground (a smashed light's glass, a mirror, a hubcap, the bumper).
   */
  private dent(v: Vehicle | null, x: number, y: number, impulse: number): void {
    const body = v ? { x: v.x, y: v.y, angle: v.angle, vx: v.vx, vy: v.vy, level: v.level } : { x: this.car.x, y: this.car.y, angle: this.car.heading, vx: this.car.vx, vy: this.car.vy, level: this.level };
    const shape = v ? vehicleShape(v) : PLAYER_SHAPE;
    const wreck = v ? (v.wreck ??= newWreck()) : this.wreck;
    const [u, w] = toBody(x, y, body.x, body.y, body.angle);
    const out = dentAt(wreck, shape, u, w, impulse, this.time.now / 1000, Math.random);
    if (v) {
      this.traffic.hurt(v);
      // A parked car knocked hard enough sets its alarm off.
      if (v.space && impulse > ALARM_AT && v.alarm <= 0) v.alarm = ALARM_FOR;
    }
    for (const lost of out.lost) {
      const [px, py] = toWorld(lost.u, lost.v, body.x, body.y, body.angle);
      // Thrown off outwards a little, and on the way it was going.
      const [ox, oy] = [(px - body.x) * 2, (py - body.y) * 2];
      const drop = (kind: DebrisKind, count: number, spread: number) => {
        for (const d of debris(kind, count, px, py, body.vx * 0.5 + ox, body.vy * 0.5 + oy, Math.random, spread)) this.addDebris(d, body.level);
      };
      switch (lost.part) {
        case 'bumperFront':
        case 'bumperRear':
          drop('bumper', 1, 4);
          drop('plastic', 3, 6);
          break;
        case 'mirrorLeft':
        case 'mirrorRight':
          drop('mirror', 1, 3);
          drop('glass', 2, 3);
          break;
        case 'hubcap':
          drop('hubcap', 1, 3);
          break;
        default:
          drop('glass', 4, 4);
          if (lost.part.startsWith('lightRear')) drop('lens', 3, 4);
          this.effects.burst('glass', px, py, 6);
          this.audio?.shatter('glass', impulse);
      }
    }
  }

  /**
   * Damage where a boat's been hit, at (x, y), this hard: dents, scratches and
   * the hull stove in (nothing comes off it), and a splash, hit hard.
   */
  private dentBoat(b: Boat, x: number, y: number, impulse: number): void {
    const shape: Shape = { length: b.length, width: b.beam, stiffness: BOAT_STIFFNESS[b.kind], mirror: 1e6, screen: 1e6 };
    const wreck = (b.wreck ??= newWreck());
    const [u, w] = toBody(x, y, b.x, b.y, b.angle);
    const before = wreck.version;
    dentAt(wreck, shape, u, w, impulse, this.time.now / 1000, Math.random);
    if (wreck.version === before) return;
    // No lights, mirrors, bumpers or windscreen to lose.
    wreck.lost.length = 0;
    wreck.marks = wreck.marks.filter((m) => m.kind !== 'crack');
    this.boats.hurt(b);
    if (impulse > 40) this.effects.splashAt(x, y, Math.min(14, Math.round(impulse / 25)));
  }

  /** How loud something at (x, y) is, by how far it is from the car: 1 close, 0 out of earshot. */
  private hearing(x: number, y: number): number {
    return Math.max(0, 1 - Math.hypot(x - this.car.x, y - this.car.y) / 600);
  }

  private hit(impulse: number): void {
    this.bigHit = Math.max(this.bigHit, impulse);
    if (impulse > 90) this.effects.sparksAt(this.contact.x, this.contact.y, impulse);
  }

  /** Loose things in the chunks round (x, y). */
  private nearbyLoose(x: number, y: number): number[] {
    const out: number[] = [];
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cy - 1; j <= cy + 1; j++) {
        for (const k of this.looseByChunk.get(chunkKey(i, j)) ?? []) {
          const b = this.loose[k].body;
          if (Math.abs(b.x - x) < 60 && Math.abs(b.y - y) < 60) out.push(k);
        }
      }
    }
    return out;
  }

  /** Moves whatever's been knocked, until it settles. */
  private updateLoose(): void {
    const dt = 1 / 60;
    for (const { body } of this.loose) {
      if (!body.moved || body.gone) continue;
      stepBody(body, dt, 3);
      collideBodyWithStatic(body, this.posts[body.level]);
      for (const s of this.walls[body.level].near(body.x, body.y, body.r + 8)) {
        const [px, py] = nearestOnSegment(body.x, body.y, s);
        const dx = body.x - px;
        const dy = body.y - py;
        const d = Math.hypot(dx, dy);
        const min = body.r + s.r;
        if (d >= min || d < 1e-6) continue;
        const nx = dx / d;
        const ny = dy / d;
        body.x += nx * (min - d);
        body.y += ny * (min - d);
        const vn = body.vx * nx + body.vy * ny;
        if (vn < 0) {
          body.vx -= 1.4 * vn * nx;
          body.vy -= 1.4 * vn * ny;
        }
      }
      if (Math.hypot(body.vx, body.vy) < 2 && Math.abs(body.spin) < 0.05) {
        body.vx = body.vy = body.spin = 0;
        // Settled, wherever it ended up: it's still loose for the next time it's hit.
        body.moved = false;
        this.reindexLoose();
      }
    }
  }

  private reindexLoose(): void {
    this.looseByChunk.clear();
    this.loose.forEach(({ body }, i) => {
      const key = chunkKey(Math.floor(body.x / CHUNK), Math.floor(body.y / CHUNK));
      const list = this.looseByChunk.get(key);
      if (list) list.push(i);
      else this.looseByChunk.set(key, [i]);
    });
  }

  private updateSinking(dt: number): void {
    if (this.sinking < 0) {
      // Remember the last place on a road clear of the water, to put the car back.
      this.safeTimer -= dt;
      if (this.safeTimer <= 0) {
        this.safeTimer = 0.4;
        const { x, y, heading } = this.car;
        const clear = [0, 1, 2, 3, 4, 5, 6, 7].every((k) => this.surfaces.at(x + Math.cos(k * 0.785) * 48, y + Math.sin(k * 0.785) * 48) !== Surface.Deep);
        if (this.surface === Surface.Road && clear && this.level === 0) this.safe = { x, y, heading };
      }
      return;
    }
    this.sinking += dt;
    if (Math.random() < dt * 12) this.effects.splashAt(this.car.x + (Math.random() - 0.5) * 20, this.car.y + (Math.random() - 0.5) * 20, 2);
    if (this.sinking > 2.2) this.resetCar();
  }

  /** Back on the road, where it last was safely, and repaired. */
  private resetCar(): void {
    Object.assign(this.car, { x: this.safe.x, y: this.safe.y, heading: this.safe.heading, vx: 0, vy: 0, spin: 0 });
    this.sinking = -1;
    this.level = 0;
    this.surface = this.surfaces.at(this.car.x, this.car.y);
    this.effects.reset();
    // Good as new.
    Object.assign(this.wreck, newWreck());
    this.wreckShown = this.wreck.version;
    this.carSprite.setTexture(TEX.car).setAlpha(1).setTint(0xffffff);
    this.carShadow.setTexture(TEX.carShadow);
  }

  /** A jolt shakes the camera this long (s), this far (map px); a harder one takes over from a weaker. */
  private shake(seconds: number, size: number): void {
    const sh = this.shaking;
    const left = sh.t < sh.for ? sh.size * (1 - sh.t / sh.for) ** 2 : 0;
    if (size < left) return;
    Object.assign(sh, { for: seconds, t: 0, size });
  }

  /** Where the car's drawn: between where it was and where it is (straight there if it's jumped, put back after sinking, say). */
  private interpolate(f: number): void {
    const { car, prev } = this;
    if (Math.hypot(car.x - prev.x, car.y - prev.y) > 60) this.prev = { x: car.x, y: car.y, heading: car.heading };
    const p = this.prev;
    let turn = car.heading - p.heading;
    turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
    this.shown = { x: p.x + (car.x - p.x) * f, y: p.y + (car.y - p.y) * f, heading: p.heading + turn * f };
  }

  private drawCar(): void {
    const { x, y, heading } = this.shown;
    if (this.wreck.version !== this.wreckShown) {
      this.wreckShown = this.wreck.version;
      paintWreck(this, 'car-dented', { base: TEX.car, length: CAR_LENGTH, width: CAR_WIDTH, mirror: PLAYER_SHAPE.mirror }, this.wreck);
      this.carSprite.setTexture('car-dented');
      // Its shadow the shape it is now (crumpled in, parts gone).
      this.carShadow.setTexture('car-dented');
    }
    // Off a speed hump: up and down again, nearer the camera at the top (a little bigger), its shadow further off.
    const phase = this.hopLeft > 0 ? 1 - this.hopLeft / HOP_TIME : 1;
    const hop = this.hopPeak * 4 * phase * (1 - phase);
    const s = (1 / ART_SCALE) * (1 + hop * 0.07);
    if (this.sinking >= 0) {
      // Sinking: smaller, darker and fading under the water.
      const k = Math.min(this.sinking / 1.6, 1);
      this.carSprite.setScale(s * (1 - k * 0.25)).setAlpha(1 - k * 0.85).setTint(Phaser.Display.Color.GetColor(255 - k * 160, 255 - k * 120, 255 - k * 80));
      this.carShadow.setVisible(false);
    } else {
      this.carSprite.setScale(s);
      this.carShadow.setVisible(true);
    }
    this.carSprite.setPosition(x, y).setRotation(heading);
    this.carShadow.setPosition(x + 2.5 + hop * 3, y + 3.5 + hop * 4).setRotation(heading);
  }

  /** Follows the car, looking ahead the way it's going, and pulls back the faster it goes. */
  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    const car = this.car;
    // Everything it follows eased in and out (springs, not jumps): a knock, a kerb or a sudden turn doesn't jolt it.
    this.pace += (Math.hypot(car.vx, car.vy) - this.pace) * Math.min(1, dt * 4);
    const t = Math.min(this.pace / FULL_SPEED, 1) ** PULL_EASE;
    const side = Math.min(this.scale.width, this.scale.height);
    const rest = restView(side);
    const target = side / (rest + (VIEW_AT_SPEED - rest) * t);
    [this.zoom, this.zoomRate] = spring(this.zoom, this.zoomRate, target, 2, dt);
    cam.setZoom(this.zoom);
    const ahead = 0.45;
    [this.lookX, this.lookVX] = spring(this.lookX, this.lookVX, car.vx * ahead, 3.5, dt);
    [this.lookY, this.lookVY] = spring(this.lookY, this.lookVY, car.vy * ahead, 3.5, dt);
    // Shaken by a jolt: a quick, smooth wobble dying away, the same distance on the map whatever the screen.
    let [sx, sy] = [0, 0];
    const sh = this.shaking;
    if (sh.t < sh.for) {
      sh.t += dt;
      const fade = Math.max(0, 1 - sh.t / sh.for) ** 2;
      const w = sh.t * Math.PI * 2;
      sx = sh.size * fade * (Math.sin(w * 13) * 0.65 + Math.sin(w * 21 + 1.3) * 0.35);
      sy = sh.size * fade * (Math.sin(w * 15 + 2.1) * 0.65 + Math.sin(w * 23 + 0.4) * 0.35);
    }
    cam.centerOn(this.shown.x + this.lookX + sx, this.shown.y + this.lookY + sy);
  }

  /** How high the car is, px: on the ground, or on the deck of the bridge it's on. */
  private carHeight(): number {
    const { x, y } = this.car;
    const on = this.level === 1 ? this.decks.over(x, y) : null;
    return on ? this.decks.height(on.deck, on.along) : this.groundAt(x, y);
  }

  /** The height of what's underfoot at (x, y) on a level, px: the ground, or a bridge's deck. */
  private surfaceHeight(x: number, y: number, level: number): number {
    const deck = level === 1 ? this.decks.over(x, y) : null;
    return deck ? this.decks.height(deck.deck, deck.along) : this.groundAt(x, y);
  }

  /** A piece of something broken, flying off loose: it ends up in the way. */
  private addDebris(d: Debris, level: number): void {
    // Enough is enough: past this, the smallest bits are left out.
    if (this.loose.length > MAX_LOOSE && (d.kind === 'rubble' || d.kind === 'brick' || d.kind === 'foliage' || d.kind === 'twig' || d.kind === 'glass' || d.kind === 'splinter')) return;
    const body: LooseProp = { ...d, level, moved: true, born: this.time.now / 1000 };
    const image = this.add
      .image(d.x, d.y, TEX.debris(d.kind))
      .setScale(1 / ART_SCALE)
      .setRotation(d.angle)
      .setDepth(level === 1 ? DEPTH.onDeck : DEPTH.props);
    this.loose.push({ body, image });
    const key = chunkKey(Math.floor(d.x / CHUNK), Math.floor(d.y / CHUNK));
    const list = this.looseByChunk.get(key);
    if (list) list.push(this.loose.length - 1);
    else this.looseByChunk.set(key, [this.loose.length - 1]);
  }

  /** What showed a knocked-down post goes: a lamp, a traffic light's head, a beacon (a tree's crown falls instead). */
  private knockedDown(post: Post): void {
    switch (post.thing) {
      case 'signal':
        this.signalHeads[post.index].gone = true;
        this.signalHeads[post.index].image.setVisible(false);
        break;
      case 'beacon':
        this.beacons[post.index].gone = true;
        this.beacons[post.index].image.setVisible(false);
        break;
      case 'tree':
      case 'stump':
        break;
      default:
        this.props[post.index].gone = true;
        this.props[post.index].image.setVisible(false);
        // A crane's jib comes down with it.
        for (const r of this.raised) if (r.prop === post.index) r.gone = true;
    }
  }

  /** The ground's height at (x, y), px. */
  private groundAt(x: number, y: number): number {
    return this.terrain.at(x, y) * this.terrain.px;
  }

  /** The camera's over the car, looking down from high above the ground it's on. */
  private updatePerspective(): void {
    const view = this.cameras.main.worldView;
    const p = this.perspective;
    p.cx = view.centerX;
    p.cy = view.centerY;
    // Lower as it closes in: the camera coming down, not just magnifying.
    p.height = CAMERA_HEIGHT * (Math.min(this.scale.width, this.scale.height) / this.zoom / CAMERA_VIEW);
    p.ground = this.carHeight();
  }

  /** The trees near the view, their crowns lifted towards the camera like the roofs. */
  private updateTrees(view: Phaser.Geom.Rectangle): void {
    const p = this.perspective;
    const pad = 120;
    for (const t of this.trees) {
      const show = !t.gone && t.x > view.left - pad && t.x < view.right + pad && t.y > view.top - pad && t.y < view.bottom + pad;
      if (t.image.visible !== show) t.image.setVisible(show);
      if (!show) continue;
      // The crown's a little below the treetop.
      const s = p.lift(t.z + t.h * 0.85);
      t.image.setPosition(p.x(t.x, s), p.y(t.y, s));
    }
  }

  /** The street furniture near the view, standing on the hills. */
  private updateProps(view: Phaser.Geom.Rectangle): void {
    const p = this.perspective;
    const pad = 120;
    for (const list of [this.props, this.raised] as { x: number; y: number; z: number; image: Phaser.GameObjects.Image; gone?: boolean }[][]) {
      for (const t of list) {
        const show = !t.gone && t.x > view.left - pad && t.x < view.right + pad && t.y > view.top - pad && t.y < view.bottom + pad;
        if (t.image.visible !== show) t.image.setVisible(show);
        if (!show) continue;
        const s = p.lift(t.z);
        t.image.setPosition(p.x(t.x, s), p.y(t.y, s));
      }
    }
    for (const { body, image } of this.loose) {
      if (body.gone) continue;
      const show = body.x > view.left - pad && body.x < view.right + pad && body.y > view.top - pad && body.y < view.bottom + pad;
      if (image.visible !== show) image.setVisible(show);
      if (!show) continue;
      const deck = body.level === 1 ? this.decks.over(body.x, body.y) : null;
      const s = p.lift(deck ? this.decks.height(deck.deck, deck.along) : this.groundAt(body.x, body.y));
      image.setPosition(p.x(body.x, s), p.y(body.y, s)).setRotation(body.angle);
    }
  }

  /** Puts up the street's name when the car turns into a new one. */
  private updateStreet(dt: number): void {
    this.streetTimer -= dt;
    if (this.streetTimer > 0) return;
    this.streetTimer = 0.3;
    const { x, y } = this.car;
    const index = this.world.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)));
    if (!index) return;
    let best = '';
    let bestD = Infinity;
    for (const i of index.roads) {
      const r = this.world.map.roads[i];
      if (!r.name || !(VEHICLE_ROADS.has(r.kind) || r.kind === 'pedestrian')) continue;
      for (let k = 0; k + 3 < r.pts.length; k += 2) {
        const [px, py] = nearestOnSegment(x, y, { ax: r.pts[k], ay: r.pts[k + 1], bx: r.pts[k + 2], by: r.pts[k + 3], r: 0 });
        const d = Math.hypot(px - x, py - y) - r.width / 2;
        if (d < bestD) {
          bestD = d;
          best = r.name;
        }
      }
    }
    if (best && bestD < CAR_LENGTH / 2 && best !== this.street) {
      this.street = best;
      this.events.emit(STREET_EVENT, best);
    }
  }
}

/** What a bridge's deck is to drive on: tarmac for a road bridge, paving or planks for a footbridge or jetty. */
function deckSurface(road: Road): Surface {
  return VEHICLE_ROADS.has(road.kind) && road.kind !== 'track' ? Surface.Road : Surface.Pavement;
}

/** Your car, for its damage: its mirrors 15.75 px back from its nose, its windscreen 13.25. */
/** A parked car's alarm: knocked this hard, it goes off for this long, seconds. */
const ALARM_AT = 15;
const ALARM_FOR = 12;

const PLAYER_SHAPE: Shape = { length: CAR_LENGTH, width: CAR_WIDTH, stiffness: STIFFNESS.player, mirror: CAR_LENGTH / 2 - 15.75, screen: CAR_LENGTH / 2 - 13.25 };

const shapes = new Map<string, Shape>();

/** A kind of vehicle, for its damage. */
/** How sturdy each kind of boat is (a car's 1): a dinghy's thin plastic, a narrowboat's steel, an old tug's heavy plate. */
const BOAT_STIFFNESS: Record<Boat['kind'], number> = { dinghy: 0.7, cruiser: 1.1, yacht: 1.2, narrowboat: 2.4, barge: 3, ferry: 2, tug: 4 };

/** A critically damped spring: `value` (moving at `rate`) eased towards `target`, about 1/`omega` s to get most of the way, never overshooting. */
function spring(value: number, rate: number, target: number, omega: number, dt: number): [number, number] {
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = value - target;
  const temp = (rate + omega * change) * dt;
  return [target + (change + temp) * decay, (rate - omega * temp) * decay];
}

/** How much of the map the view's shorter side (`side` css px) shows with the car stopped, px: VIEW_AT_REST on a phone, more on a bigger screen. */
function restView(side: number): number {
  return Math.min(VIEW_AT_SPEED * REST_MOST, VIEW_AT_REST * Math.max(1, side / PHONE_SIDE) ** SCREEN_EASE);
}

function vehicleShape(v: Vehicle): Shape {
  let shape = shapes.get(v.kind);
  if (!shape) {
    const k = VEHICLES[v.kind];
    shape = { length: k.length, width: k.width, stiffness: STIFFNESS[v.kind], ...bodyLayout(v.kind) };
    shapes.set(v.kind, shape);
  }
  return shape;
}
