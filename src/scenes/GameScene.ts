import * as Phaser from 'phaser';
import { CarAudio } from '../audio/CarAudio';
import {
  CAR_LENGTH,
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
import { type GameMap, type Road, VEHICLE_ROADS } from '../map/osm';
import {
  CircleGrid,
  type ContactPoint,
  SegmentGrid,
  collideBodyWithStatic,
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
import { WallLayer } from '../world/WallLayer';
import { type Debris, impactSpeed } from '../world/damage';
import { HudScene, RESET_EVENT, STREET_EVENT } from './HudScene';
import { SkidMarks } from './SkidMarks';

/** Physics runs at a fixed rate so handling feels the same at any frame rate. */
const PHYSICS_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 8;

const DEPTH = {
  ground: 0,
  skids: 1,
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

/** How high the camera is when stopped, px (the lower it is, the more the buildings lean). */
const CAMERA_HEIGHT = 1250;
/** How high traffic lights' heads and Belisha beacons' globes are, px. */
const LIGHT_HEIGHT = 3.5 * 8;
const BEACON_HEIGHT = 2.6 * 8;
/** The view's shorter side, in map px, when the car's stopped (it pulls back as you speed up, as in the old games). */
const VIEW_AT_REST = 430;
const PULL_BACK = 0.38;
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
  private trees: { x: number; y: number; z: number; h: number; image: Phaser.GameObjects.Image }[] = [];
  /** Each traffic light's head, up its pole, with what it's showing. */
  private signalHeads: { x: number; y: number; z: number; controller: number; group: number; light: Light; image: Phaser.GameObjects.Image; gone?: boolean }[] = [];
  /** The Belisha beacons' globes, flashing. */
  private beacons: { x: number; y: number; z: number; image: Phaser.GameObjects.Image; gone?: boolean }[] = [];
  private wreckage!: Wreckage;
  private wallLayer!: WallLayer;
  private loose: { body: LooseProp; image: Phaser.GameObjects.Image }[] = [];
  private looseByChunk = new Map<string, number[]>();
  private effects!: CarEffects;
  private skids!: SkidMarks;
  private audio: CarAudio | null = null;
  private hud!: HudScene;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'space' | 'r', Phaser.Input.Keyboard.Key>;
  private input_: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private accumulator = 0;
  private zoom = 1;
  private lookX = 0;
  private lookY = 0;
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
      audio: () => this.audio,
      weight: () => 1,
    }, DEPTH.props - 0.1, DEPTH.trees);
    this.addProps();
    this.addTrees();
    this.addLights();

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

  /** The camera's zoom with the car stopped: the view's shorter side shows VIEW_AT_REST px of the map. */
  private restZoom(): number {
    const { width, height } = this.scale;
    return Math.min(width, height) / VIEW_AT_REST;
  }

  /** Lamp posts, bollards, benches, bins and the rest. */
  private addProps(): void {
    for (const p of this.world.fixed) {
      // Those on a bridge stand on its deck, and are drawn over it.
      const deck = p.level === 1 ? this.decks.over(p.x, p.y) : null;
      const z = deck ? this.decks.height(deck.deck, deck.along) : this.groundAt(p.x, p.y);
      const image = this.add.image(p.x, p.y, TEX.prop(p.kind)).setScale(1 / ART_SCALE).setDepth(deck ? DEPTH.onDeck : DEPTH.props).setVisible(false);
      this.props.push({ x: p.x, y: p.y, z, image });
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
    for (let i = 0; i < t.length; i += 4) {
      const image = this.add
        .image(t[i], t[i + 1], TEX.tree((i / 4) % TREE_KINDS))
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
      this.step(PHYSICS_DT);
    }
    this.updateSinking(dt);
    this.updateLoose();
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
    this.deckLayer.update(view, this.perspective, this.level === 1 ? DEPTH.deckBelow : DEPTH.deckAbove);
    this.buildings.update(view, this.perspective, this.car.x, this.car.y);
    // Before the trees: it moves the ones coming down.
    this.wreckage.update(view, this.perspective);
    this.updateTrees(view);
    this.updateProps(view);
    this.updateLights(view);
    this.wallLayer.update(view, this.perspective);
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
      if (this.bigHit > 220) this.cameras.main.shake(120, Math.min(0.012, this.bigHit / 40000));
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
    stepCar(car, this.input_, dt, SURFACE_GRIP[SURFACE_KIND[this.surface]], DEFAULT_TUNING, { x: sx, y: sy });

    // Whatever the car's going into hard enough gives way first; then it bounces off what's left.
    this.wreckage.hit(car, this.level);
    const wall = collideCarWithWalls(car, this.walls[this.level], undefined, this.contact);
    if (wall > 0) this.hit(wall);
    const post = collideCarWithStatic(car, this.posts[this.level], undefined, this.contact);
    if (post > 0) this.hit(post);
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
      // Hit hard enough, a bench smashes to pieces.
      if (this.wreckage.smash(body, car, impactSpeed(car, body.x, body.y, body.r + (body.length ?? 0) / 2))) {
        image.destroy();
        continue;
      }
      const knock = collideCarWithBody(car, body);
      if (knock > 0) {
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

  /** Back on the road, where it last was safely. */
  private resetCar(): void {
    Object.assign(this.car, { x: this.safe.x, y: this.safe.y, heading: this.safe.heading, vx: 0, vy: 0, spin: 0 });
    this.sinking = -1;
    this.level = 0;
    this.surface = this.surfaces.at(this.car.x, this.car.y);
    this.effects.reset();
    this.carSprite.setAlpha(1).setTint(0xffffff);
  }

  private drawCar(): void {
    const { x, y, heading } = this.car;
    const s = 1 / ART_SCALE;
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
    this.carShadow.setPosition(x + 2.5, y + 3.5).setRotation(heading);
  }

  /** Follows the car, looking ahead the way it's going, and pulls back the faster it goes. */
  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    const car = this.car;
    const speed = Math.hypot(car.vx, car.vy);
    const rest = this.restZoom();
    const target = rest * (1 - PULL_BACK * Math.min(speed / 400, 1));
    this.zoom += (target - this.zoom) * Math.min(1, dt * 1.5);
    cam.setZoom(this.zoom);
    const ahead = 0.45;
    this.lookX += (car.vx * ahead - this.lookX) * Math.min(1, dt * 3);
    this.lookY += (car.vy * ahead - this.lookY) * Math.min(1, dt * 3);
    cam.centerOn(car.x + this.lookX, car.y + this.lookY);
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
    if (this.loose.length > MAX_LOOSE && (d.kind === 'rubble' || d.kind === 'brick' || d.kind === 'foliage' || d.kind === 'twig' || d.kind === 'glass')) return;
    const body: LooseProp = { ...d, level, moved: true };
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
      case 'fountain':
        break;
      default:
        this.props[post.index].gone = true;
        this.props[post.index].image.setVisible(false);
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
    p.height = CAMERA_HEIGHT * (this.restZoom() / this.zoom);
    p.ground = this.carHeight();
  }

  /** The trees near the view, their crowns lifted towards the camera like the roofs. */
  private updateTrees(view: Phaser.Geom.Rectangle): void {
    const p = this.perspective;
    const pad = 120;
    for (const t of this.trees) {
      const show = t.x > view.left - pad && t.x < view.right + pad && t.y > view.top - pad && t.y < view.bottom + pad;
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
    for (const t of this.props) {
      const show = !t.gone && t.x > view.left - pad && t.x < view.right + pad && t.y > view.top - pad && t.y < view.bottom + pad;
      if (t.image.visible !== show) t.image.setVisible(show);
      if (!show) continue;
      const s = p.lift(t.z);
      t.image.setPosition(p.x(t.x, s), p.y(t.y, s));
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
