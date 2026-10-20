import * as Phaser from 'phaser';
import { CarAudio } from '../audio/CarAudio';
import {
  CAR_LENGTH,
  CAR_WIDTH,
  type CarInput,
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
import { Decks, waterOf } from '../world/decks';
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
import { type Debris, type DebrisKind, debris, impactSpeed, racked } from '../world/damage';
import { ACTION_EVENT, HudScene, PAUSE_EVENT, RESET_EVENT, STREET_EVENT } from './HudScene';
import type { MenuData } from './MenuScene';
import type { Spot } from '../world/overview';
import { WALKER, stepWalker, tuningFor } from '../car/rides';
import { SkidMarks } from './SkidMarks';
import { TrafficLayer } from './TrafficLayer';
import { COLOURS, Traffic, VEHICLES, type Vehicle, type VehicleKind, collideBodies } from '../world/traffic';
import { type Boat, Boats } from '../world/boats';
import { BoatLayer } from './BoatLayer';
import { WaterRipples } from './WaterRipples';
import { GRAVITY, Ledges } from '../world/ledges';
import { LedgeLayer } from '../world/LedgeLayer';
import { type Mover, People } from '../world/people';
import { type Pose, PeopleLayer, SIZE as PERSON_SIZE, personTexture } from './PeopleLayer';
import { type Shape, STIFFNESS, type Wreck, hit as dentAt, newWreck, toBody, toWorld } from '../car/dents';
import { paintWreck } from './dentArt';
import { bodyLayout, busTexture, vehicleShadow, vehicleTexture } from './vehicleArt';

/** Physics runs at a fixed rate so handling feels the same at any frame rate. */
const PHYSICS_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 8;

const DEPTH = {
  ground: 0,
  skids: 1,
  /** The water's ripples, just over it. */
  ripples: 0.5,
  /** On the water, under the bridges. */
  boats: 1.5,
  props: 2,
  /** The drops' faces (quays, retaining walls). */
  ledges: 2.15,
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
/** On foot, the view at rest is this much of what it is in a car (closer in). */
const ON_FOOT_VIEW = 0.6;
/**
 * VIEW_AT_REST is for a phone (its screen's shorter side PHONE_SIDE css px or
 * less): on a bigger screen, the camera's further back at rest, so it doesn't
 * fill the screen with a few cars, by the screen's size (over a phone's) to the
 * power SCREEN_EASE; never further back than REST_MOST of VIEW_AT_SPEED.
 */
const PHONE_SIDE = 390;
const SCREEN_EASE = 0.55;
const REST_MOST = 0.9;
/** Which way the wind sways the trees (and how far, px, at its most): the same way it blows the ripples on the water. */
const WIND_X = Math.cos(0.35) * 0.9;
const WIND_Y = Math.sin(0.35) * 0.9;
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
  private props: Shown[] = [];
  /** What's up high on the fixed things: the cranes' jibs. */
  private raised: { x: number; y: number; z: number; image: Phaser.GameObjects.Image; prop: number; gone?: boolean }[] = [];
  /** What you hit on each level: the ground's, and the bridges' decks'. */
  private walls!: [SegmentGrid, SegmentGrid];
  private posts!: [CircleGrid, CircleGrid];
  private decks!: Decks;
  private ledges!: Ledges;
  private ledgeLayer!: LedgeLayer;
  /** Falling (off a drop, a bridge, a quay): how high above the ground below, px, how fast, px/s (up), and from how high. */
  private air: { z: number; vz: number; drop: number } | null = null;
  private deckLayer!: DeckLayer;
  /** Which level the car's on: 0 the ground, 1 a bridge's deck. */
  private level = 0;
  private car!: CarState;
  private carSprite!: Phaser.GameObjects.Image;
  private carShadow!: Phaser.GameObjects.Image;
  /**
   * The trees: each one's crown (where it is: it moves as the tree falls), and
   * its trunk where it stands (seen through the crown when you're under it),
   * how see-through its crown is.
   */
  private trees: {
    x: number;
    y: number;
    z: number;
    h: number;
    gone?: boolean;
    foot: { x: number; y: number; r: number };
    /** Its pictures, only while it's in or near the view (and its crown's picture, and how big): a big map has many thousands. */
    art: { image: Phaser.GameObjects.Image; trunk: Phaser.GameObjects.Image; bole: Phaser.GameObjects.Image } | null;
    tex: string;
    scale: number;
    alpha: number;
    /** Its crown's turn as it stands (it sways about it), or as it lies, fallen. */
    turn: number;
  }[] = [];
  /** Trees' pictures not in use, to use again. */
  private readonly treeArtPool: { image: Phaser.GameObjects.Image; trunk: Phaser.GameObjects.Image; bole: Phaser.GameObjects.Image }[] = [];
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
  /** What you're driving's damage, and the version of it its picture shows. */
  private wreck: Wreck = newWreck();
  /**
   * On foot (out of anything), or driving; and what you're driving: its kind
   * and colour (and a bus's route, for its picture). Your own car's `own`.
   */
  private onFoot = false;
  private ride: { kind: VehicleKind; colour: number; bus?: { colour: string; ref: string } } = { kind: 'own', colour: 0 };
  /** Your clothes (on foot, and on a bike); how far you've walked (for your steps); seconds left down, knocked over. */
  private readonly look = Math.floor(Math.random() * 48);
  private stride = 0;
  private downFor = 0;
  /** Come off a bike (hit something hard): off it, after this step. */
  private thrown = false;
  /** Seconds till what's within reach to get into is looked for again. */
  private reachTimer = 0;
  private wreckShown = 0;
  private trafficLayer!: TrafficLayer;
  private boats!: Boats;
  private boatLayer!: BoatLayer;
  private ripples!: WaterRipples;
  private people!: People;
  private peopleLayer!: PeopleLayer;
  private loose: { body: LooseProp; image: Phaser.GameObjects.Image }[] = [];
  /** The trees, props and loose things by where they are (so only those round the view are looked at each frame), and those shown last frame. */
  private treeGrid!: Grid;
  private propGrid!: Grid;
  private raisedGrid!: Grid;
  private shownTrees = new Set<number>();
  private shownProps = new Set<number>();
  private shownRaised = new Set<number>();
  private shownLoose = new Set<number>();
  private looseByChunk = new Map<string, number[]>();
  private effects!: CarEffects;
  private skids!: SkidMarks;
  private audio: CarAudio | null = null;
  private hud!: HudScene;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'space' | 'r' | 'f' | 'e' | 'p' | 'esc', Phaser.Input.Keyboard.Key>;
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
  /** When the pause menu was last closed (performance.now(), ms). */
  private menuClosed = -Infinity;
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
    this.terrain = new Terrain(map.terrain, map.pxPerMetre, map.ledges);
    this.ground = new GroundLayer(this, this.world, this.terrain, DEPTH.ground);
    this.skids = new SkidMarks(this, this.terrain, DEPTH.skids);
    this.effects = new CarEffects(this, this.skids, DEPTH.effects);
    this.buildings = new Buildings(this, this.world, this.terrain, DEPTH.buildings);
    this.kerbs = new Kerbs(map);
    this.humps = new Humps(map);
    this.decks = new Decks(map.roads, (x, y) => this.groundAt(x, y), waterOf(map));
    this.ledges = new Ledges(map);
    this.ledgeLayer = new LedgeLayer(this, this.ledges, (x, y) => this.groundAt(x, y), DEPTH.ledges);
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
        if (angle !== undefined) {
          t.turn = angle;
          t.art?.image.setRotation(angle);
        }
      },
      treeHeight: (index) => this.trees[index].h,
      treeRadius: (index) => this.trees[index].foot.r,
      crownGone: (index) => {
        this.trees[index].gone = true;
        this.trees[index].art?.image.setVisible(false);
      },
      audio: () => this.audio,
      weight: () => VEHICLES[this.ride.kind].mass,
      wallBroken: (kind, from, to) => {
        if (kind === 'parapet') this.deckLayer.breakParapet(from, to);
      },
    }, DEPTH.props - 0.1, DEPTH.trees);
    this.addProps();
    this.addTrees();
    this.addLights();
    this.treeGrid = new Grid(this.trees.length, (i) => [this.trees[i].foot.x, this.trees[i].foot.y]);
    this.propGrid = new Grid(this.props.length, (i) => [this.props[i].x, this.props[i].y]);
    this.raisedGrid = new Grid(this.raised.length, (i) => [this.raised[i].x, this.raised[i].y]);
    this.traffic = new Traffic(map);
    this.boats = new Boats(map);
    this.people = new People(map, { seats: this.world.loose });
    this.peopleLayer = new PeopleLayer(this, this.people, (x, y, level) => this.surfaceHeight(x, y, level), { ground: DEPTH.props + 0.05, deck: DEPTH.onDeck });
    this.ripples = new WaterRipples(this, this.surfaces, (x, y) => this.groundAt(x, y), DEPTH.ripples);
    this.boatLayer = new BoatLayer(this, this.boats, (x, y) => this.groundAt(x, y), DEPTH.boats);
    this.trafficLayer = new TrafficLayer(this, this.traffic, (x, y, level) => this.surfaceHeight(x, y, level), (x, y, reach) => this.decks.atEnd(x, y, reach), {
      ground: DEPTH.car - 0.05,
      onDeck: DEPTH.onDeck,
      below: DEPTH.deckBelow - 0.05,
      beside: DEPTH.car - 0.05,
    });

    const { spawn } = map;
    // Your armoured truck.
    this.car = Object.assign(createCar(spawn.x, spawn.y, spawn.heading), { length: VEHICLES.own.length, width: VEHICLES.own.width, invMass: 1 / VEHICLES.own.mass });
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
    const v0 = cam.worldView;
    this.people.populate({ x0: v0.left, y0: v0.top, x1: v0.right, y1: v0.bottom }, true);

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
      f: kb.addKey(K.F),
      e: kb.addKey(K.E),
      p: kb.addKey(K.P),
      esc: kb.addKey(K.ESC),
    };
    this.keys.r.on('down', () => this.resetCar());
    this.keys.f.on('down', () => this.getInOrOut());
    this.keys.e.on('down', () => this.getInOrOut());
    this.events.on(RESET_EVENT, this.resetCar, this);
    this.events.on(ACTION_EVENT, this.getInOrOut, this);
    this.keys.p.on('down', () => this.openMenu());
    this.keys.esc.on('down', () => this.openMenu());
    this.events.on(PAUSE_EVENT, this.openMenu, this);

    this.scene.launch('hud');
    this.hud = this.scene.get('hud') as HudScene;

    // Web Audio only (the old HTML5 audio fallback can't synthesise).
    const sound = this.sound as Phaser.Sound.WebAudioSoundManager;
    if ('context' in sound && sound.context) this.audio = new CarAudio(sound.context, sound.destination);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.audio?.destroy();
      this.audio = null;
      this.events.off(RESET_EVENT, this.resetCar, this);
      this.events.off(ACTION_EVENT, this.getInOrOut, this);
      this.events.off(PAUSE_EVENT, this.openMenu, this);
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
      // Its picture's made as it comes into view (a big map has thousands of them). (A bike rack with the bikes locked to it.)
      const make = () => {
        const image = this.add
          .image(p.x, p.y, p.kind === 'bikes' ? `${TEX.prop('bikes')}-${racked(p.x, p.y)}` : TEX.prop(p.kind))
          .setScale(1 / ART_SCALE)
          .setRotation(p.angle ?? 0)
          .setDepth(deck ? DEPTH.onDeck : DEPTH.props);
        // A ladder runs from the quay's edge down into the water.
        if (p.kind === 'ladder') image.setOrigin(0, 0.5);
        return image;
      };
      this.props.push({ x: p.x, y: p.y, z, image: null, make });
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
        .setDepth(body.level === 1 ? DEPTH.onDeck : DEPTH.props)
        .setVisible(false);
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
      this.trees.push({
        x: t[i],
        y: t[i + 1],
        z: this.groundAt(t[i], t[i + 1]),
        h: t[i + 3],
        foot: { x: t[i], y: t[i + 1], r: t[i + 2] },
        art: null,
        tex: species.has(i / 4) ? TEX.species(species.get(i / 4)!) : TEX.tree((i / 4) % TREE_KINDS),
        scale: t[i + 2] / TREE_RADIUS / ART_SCALE,
        alpha: 1,
        turn: ((i * 1.7) % 6.28) - 3.14,
      });
    }
  }

  /** A tree's pictures, now it's in view: its crown, and its trunk up from its foot into the crown, under it. */
  private treeArt(t: GameScene['trees'][number]): NonNullable<GameScene['trees'][number]['art']> {
    if (t.art) return t.art;
    const art =
      this.treeArtPool.pop() ??
      {
        image: this.add.image(0, 0, t.tex).setDepth(DEPTH.trees),
        trunk: this.add.image(0, 0, TEX.trunk).setDepth(DEPTH.trees - 0.02),
        bole: this.add.image(0, 0, TEX.bole).setScale(1 / ART_SCALE).setDepth(DEPTH.trees - 0.01),
      };
    art.image.setTexture(t.tex).setScale(t.scale).setRotation(t.turn).setAlpha(t.alpha).setVisible(false);
    art.trunk.setVisible(false);
    art.bole.setVisible(false);
    t.art = art;
    return art;
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
    // Come off a bike: on foot, and down.
    if (this.thrown) {
      this.thrown = false;
      this.getOut(true);
    }
    this.interpolate(this.accumulator / PHYSICS_DT);
    this.updateSinking(dt);
    this.updateLoose();
    this.updateTraffic(dt);
    this.hopLeft = Math.max(0, this.hopLeft - dt);
    this.drawCar();
    // No tyre marks on the bridges (they'd be laid on the ground below).
    if (this.sinking < 0 && this.level === 0 && !this.onFoot) this.effects.update(this.car, this.input_, SURFACE_KIND[this.surface], dt);
    this.skids.flush();
    this.updateCamera(dt);
    this.updatePerspective();
    const view = this.cameras.main.worldView;
    this.ground.update(view, this.perspective);
    this.skids.update(view, this.perspective);
    // A bridge is drawn over the car when it's underneath, and under it when it's on top.
    // (And under it at the end of a bridge you're driving onto or off, where the deck meets the road.)
    this.deckLayer.update(view, this.perspective, (i) =>
      this.level === 1 || this.decks.atEnd(this.car.x, this.car.y, this.carLength() / 2 + 4, this.decks.decks[i]) ? DEPTH.deckBelow : DEPTH.deckAbove,
    );
    this.buildings.update(view, this.perspective, this.car.x, this.car.y);
    // Before the trees: it moves the ones coming down.
    this.wreckage.update(view, this.perspective);
    this.updateTrees(view, dt);
    this.updateProps(view);
    this.updateLights(view);
    this.wallLayer.update(view, this.perspective);
    this.ledgeLayer.update(view, this.perspective);
    this.trafficLayer.update(view, this.perspective, this.level, this.time.now / 1000);
    this.boatLayer.update(view, this.perspective, this.time.now / 1000);
    this.ripples.update(view, this.perspective, dt);
    this.peopleLayer.update(view, this.perspective);
    this.updateStreet(dt);
    const speed = Math.hypot(this.car.vx, this.car.vy);
    const kind = this.ride.kind;
    this.audio?.update({
      speed: this.sinking >= 0 || this.onFoot ? 0 : Math.abs(forwardSpeed(this.car)),
      throttle: this.sinking >= 0 || this.onFoot ? 0 : this.input_.throttle,
      slide: this.onFoot ? 0 : Math.max(Math.abs(lateralSpeed(this.car)), this.input_.handbrake ? speed * 0.6 : 0),
      surface: SURFACE_KIND[this.surface],
      // (No engine on foot or on a bike; a deeper one in your truck, a lorry or a bus.)
      engine: this.onFoot || kind === 'bike' ? 0 : kind === 'lorry' || kind === 'bus' || kind === 'double' || kind === 'own' ? 0.7 : kind === 'van' ? 0.85 : 1,
    });
    // The button to get out (slow enough), or in (something within reach).
    this.reachTimer -= dt;
    if (this.reachTimer <= 0) {
      this.reachTimer = 0.15;
      this.hud?.setAction(this.onFoot ? 'GET IN' : 'GET OUT', this.onFoot ? this.reachable() !== null : speed < GET_OUT_SPEED);
    }
    if (this.bigHit > 0) {
      this.audio?.crash(this.bigHit);
      if (this.bigHit > 220) this.shake(0.12, Math.min(7, this.bigHit / 68));
      // A crash: everyone near runs.
      if (this.bigHit > 120) this.people.scareAround(this.car.x, this.car.y, 12 * 8, this.level);
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

  /** Paused: everything stops (and goes quiet) under the pause menu, till you carry on, or jump somewhere off its map. */
  private openMenu(): void {
    // (Not again with the same key press that's just closed it.)
    if (this.scene.isPaused() || performance.now() - this.menuClosed < 250) return;
    const car = this.car;
    const data: MenuData = {
      map: this.world.map,
      you: { x: car.x, y: car.y, heading: car.heading },
      going: this.onFoot ? 'foot' : this.ride.kind === 'bike' ? 'ride' : 'drive',
      done: (to) => {
        if (to) this.jumpTo(to);
        this.menuClosed = performance.now();
        this.scene.resume();
        this.scene.resume('hud');
        this.hud?.release();
        void this.audioContext()?.resume();
      },
    };
    this.scene.pause();
    this.scene.pause('hud');
    this.scene.launch('menu', data);
    this.scene.bringToTop('menu');
    void this.audioContext()?.suspend();
  }

  private audioContext(): AudioContext | null {
    const sound = this.sound as Phaser.Sound.WebAudioSoundManager;
    return 'context' in sound ? sound.context : null;
  }

  /** Put down somewhere else on the map, in what you're driving (or on foot), stopped; the streets there filled. */
  private jumpTo(to: Spot): void {
    const car = this.car;
    Object.assign(car, { x: to.x, y: to.y, heading: to.heading, vx: 0, vy: 0, spin: 0 });
    this.prev = { x: to.x, y: to.y, heading: to.heading };
    this.shown = { ...this.prev };
    this.safe = { ...this.prev };
    this.level = 0;
    this.downFor = 0;
    this.air = null;
    this.surface = this.surfaces.at(to.x, to.y);
    this.effects.reset();
    if (this.sinking >= 0) {
      this.sinking = -1;
      if (!this.onFoot) this.carSprite.setAlpha(1).setTint(0xffffff);
    }
    [this.lookX, this.lookY, this.lookVX, this.lookVY, this.pace] = [0, 0, 0, 0, 0];
    const cam = this.cameras.main;
    cam.centerOn(to.x, to.y);
    this.updatePerspective();
    const v = cam.worldView;
    this.traffic.refill();
    this.people.populate({ x0: v.left, y0: v.top, x1: v.right, y1: v.bottom }, true);
    if (to.name && to.name !== this.street) {
      this.street = to.name;
      this.events.emit(STREET_EVENT, to.name);
    }
  }

  /** One fixed physics step: drive (or walk), then hit things. */
  private step(dt: number): void {
    const car = this.car;
    if (this.onFoot) return this.stepOnFoot(dt);
    if (this.sinking >= 0) {
      // Going down: the water drags the car to a stop.
      car.vx *= Math.exp(-4 * dt);
      car.vy *= Math.exp(-4 * dt);
      car.x += car.vx * dt;
      car.y += car.vy * dt;
      return;
    }
    if (this.air) return this.stepAir(dt);
    const [x0, y0] = [car.x, car.y];
    // Up on a bridge: how high (to fall from, if you go off its side).
    const high = this.level === 1 ? this.carHeight() : 0;
    const before = this.surface;
    // On a bridge, its deck's surface and slope; otherwise the ground's.
    const on = this.level === 1 ? this.decks.over(car.x, car.y) : null;
    this.surface = on ? deckSurface(on.deck.road) : this.surfaces.at(car.x, car.y);
    const [sx, sy] = on ? this.decks.slope(on.deck, on.along) : this.terrain.slope(car.x, car.y);
    const [px, py] = [car.x, car.y];
    stepCar(car, this.input_, dt, SURFACE_GRIP[SURFACE_KIND[this.surface]], tuningFor(this.ride.kind), { x: sx, y: sy });
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
      this.dent(null, car.x + (bvx / sp) * (this.carLength() / 2), car.y + (bvy / sp) * (this.carLength() / 2), lost);
    }
    const wall = collideCarWithWalls(car, this.walls[this.level], undefined, this.contact);
    if (wall > 0) {
      this.hit(wall);
      this.dent(null, this.contact.x, this.contact.y, wall);
    }
    if (this.level === 0) {
      // Over the edge of a drop: falling.
      const over = this.ledges.wentOver(x0, y0, car.x, car.y);
      if (over && over.drop > 0.5 * 8) return this.fall(over.drop);
      // A drop, come at from below: a wall.
      const ledge = (this.ledges.collide(car, this.contact) * 1.3) / (car.invMass ?? 1);
      if (ledge > 0) {
        this.hit(ledge);
        this.dent(null, this.contact.x, this.contact.y, ledge);
      }
    }
    const post = collideCarWithStatic(car, this.posts[this.level], undefined, this.contact);
    if (post > 0) {
      this.hit(post);
      this.dent(null, this.contact.x, this.contact.y, post);
    }
    // The traffic, and the parked cars: knocked about (and it stops a moment).
    for (const v of this.traffic.near(car.x, car.y, this.carLength() + 80)) {
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
      for (const b of this.boats.near(car.x, car.y, this.carLength())) {
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
    // Off the side of a bridge (through its parapet, knocked down): falling.
    if (high && this.level === 0 && high - this.groundAt(car.x, car.y) > 0.5 * 8) return this.fall(high - this.groundAt(car.x, car.y));
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
      // Off the quay: down into the water first (as far as the edge there drops, measured; or a quay's usual 1.5 m).
      this.fall(this.ledges.dropNear(car.x, car.y, 6 * 8) || 1.5 * 8);
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
        { x: car.x, y: car.y, heading: car.heading, vx: car.vx, vy: car.vy, level: this.level, length: this.carLength(), width: this.carWidth() },
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
    this.updatePeople(dt, controllers, signals, time);
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
    // Cyclists knocked off: the bike down on its side, skidding on the way it was going; the rider down by it.
    for (const { bike, impulse } of this.traffic.unseated) {
      const [vx, vy] = [bike.vx, bike.vy];
      this.addDebris({ kind: 'bike', x: bike.x, y: bike.y, vx, vy, angle: bike.angle + (Math.random() - 0.5) * 0.8, spin: (Math.random() - 0.5) * 3, r: 2.4, length: 13, invMass: 12 }, bike.level);
      const speed = Math.hypot(vx, vy);
      const [ux, uy] = speed > 1 ? [vx / speed, vy / speed] : [Math.cos(bike.angle), Math.sin(bike.angle)];
      this.people.unseat(bike.x + ux * 10, bike.y + uy * 10, bike.angle, bike.level, speed, bike.rider ?? 0);
      if (this.hearing(bike.x, bike.y) > 0) this.audio?.crash(Math.min(80, 20 + impulse * 4));
    }
    this.traffic.unseated.length = 0;
    for (const v of this.traffic.vehicles) {
      if (v.annoyed > 2.5 && v.kind !== 'bike') {
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
    if (!this.onFoot && this.wreck.taken.front > 120 && Math.random() < dt * 6) {
      this.effects.smokeAt(this.car.x + Math.cos(this.car.heading) * 12, this.car.y + Math.sin(this.car.heading) * 12);
    }
  }

  /**
   * Damage where a vehicle (or your car, for null) has been hit, at (x, y),
   * this hard: dents and scratches there, and what comes off falls to the
   * ground (a smashed light's glass, a mirror, a hubcap, the bumper).
   */
  private dent(v: Vehicle | null, x: number, y: number, impulse: number): void {
    // (A bike isn't dented: its rider comes off it, see `unseated`; you too, if you hit something hard enough.)
    if (v?.kind === 'bike') return;
    if (!v && this.ride.kind === 'bike') {
      if (impulse > 45) this.thrown = true;
      return;
    }
    const body = v ? { x: v.x, y: v.y, angle: v.angle, vx: v.vx, vy: v.vy, level: v.level } : { x: this.car.x, y: this.car.y, angle: this.car.heading, vx: this.car.vx, vy: this.car.vy, level: this.level };
    const shape = v ? vehicleShape(v) : this.rideShape();
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

  /** The people walk, wait, cross, get on and off the buses; get out of the way, run, and are knocked down. */
  private updatePeople(dt: number, controllers: GameMap['controllers'], signals: GameMap['signals'], time: number): void {
    const view = this.cameras.main.worldView;
    const car = this.car;
    // You and the traffic, each on its level (what's up on a bridge is nowhere near those under it).
    // (On foot, or on a bike, you brush past people.)
    const player: Mover = { x: car.x, y: car.y, angle: car.heading, length: this.carLength(), width: this.carWidth(), vx: car.vx, vy: car.vy, id: -1, level: this.level, bike: this.onFoot || this.ride.kind === 'bike', onFoot: this.onFoot };
    const movers: Mover[] = [];
    for (const v of [...this.traffic.vehicles, ...this.traffic.parked]) {
      if (Math.abs(v.x - car.x) > view.width + 400 || Math.abs(v.y - car.y) > view.height + 400) continue;
      if (v.mode === 'parked' && v.vx === 0 && v.vy === 0) continue;
      movers.push({ x: v.x, y: v.y, angle: v.angle, length: v.length, width: v.r * 2, vx: v.mode === 'drive' ? Math.cos(v.angle) * v.speed : v.vx, vy: v.mode === 'drive' ? Math.sin(v.angle) * v.speed : v.vy, id: v.id, dwelling: !!v.bus && v.bus.dwell > 0, ...(v.bus?.bay && v.bus.dwell > 0 ? { bay: v.bus.bay.platform, fresh: (v.bus.stood ?? 0) < 1 } : {}), level: v.level, bike: v.kind === 'bike' });
    }
    const light = (i: number) => (this.signalHeads[i]?.gone ? 'green' : lightAt(controllers[signals[i].controller], signals[i].controller, signals[i].group, time));
    // Open ground: not the water, not a building's (or a wall's) way; up on a bridge, its deck, inside the parapets.
    const walkable = (x: number, y: number, level: number) => {
      if (level === 1 ? !this.decks.over(x, y) : this.surfaces.at(x, y) === Surface.Deep) return false;
      // Not over the edge of a drop.
      if (level === 0 && this.ledges.by(x, y, 0.6 * 8)) return false;
      return !this.walls[level].near(x, y, 4).some((w) => {
        const [px, py] = nearestOnSegment(x, y, w);
        return Math.hypot(px - x, py - y) < w.r + 2;
      });
    };
    try {
      this.people.update(dt, { x0: view.left, y0: view.top, x1: view.right, y1: view.bottom }, player, movers, light, walkable, (level, x, y) => this.decks.stepAt(level, x, y, this.groundAt(x, y)));
    } catch (e) {
      console.error('people:', e);
    }
    for (const h of this.people.hits) {
      // What hit them (or went over them) loses some speed to it: you feel it.
      if (h.by === -1) {
        const [bvx, bvy] = [car.vx, car.vy];
        // (Less, the heavier it is.)
        const loss = h.loss * Math.sqrt(car.invMass ?? 1);
        car.vx *= 1 - loss;
        car.vy *= 1 - loss;
        if (h.how === 'hit') {
          // A thump: the front dented where they were hit, the car twisted round towards that side
          // (the speed it lost, lost there, off its middle), and a jolt.
          const lost = Math.hypot(bvx - car.vx, bvy - car.vy);
          const [rx, ry] = [h.person.x - car.x, h.person.y - car.y];
          car.spin += (rx * (car.vy - bvy) - ry * (car.vx - bvx)) * 0.0035;
          if (lost > 6) this.dent(null, h.person.x, h.person.y, lost * 2.5);
          this.audio?.knock();
          this.audio?.crash(Math.min(120, lost * 2));
          if (h.speed > 3 * 8) this.shake(0.16, Math.min(2.6, 0.5 + h.speed / 60));
        } else {
          // A wheel over them: a thud and a lurch, like a hump.
          this.audio?.crash(Math.min(60, 12 + h.speed * 0.15));
          this.hopPeak = Math.min(0.5, 0.15 + h.speed / 500);
          this.hopLeft = HOP_TIME;
          this.shake(0.07, Math.min(1.2, 0.3 + h.speed / 160));
        }
      } else {
        const v = h.by === undefined ? undefined : this.traffic.vehicles.find((o) => o.id === h.by);
        if (v?.mode === 'drive') v.speed *= 1 - h.loss;
        if (h.how === 'hit') this.audio?.knock();
      }
      // Everyone near runs from it.
      if (h.how === 'hit') this.people.scareAround(h.person.x, h.person.y, 8 * 8, h.person.level);
    }
    this.people.hits.length = 0;
    // Those out in the road, for the traffic to stop for.
    this.traffic.pedestrians = this.people.inTheRoad().map((p) => ({ id: -100 - p.id, x: p.x, y: p.y, angle: p.angle, r: 0.4 * 8, length: 0.8 * 8, vx: 0, vy: 0, level: p.level }));
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

  /** How long and wide what you're driving is (or you, on foot), px. */
  private carLength(): number {
    return this.car.length ?? CAR_LENGTH;
  }

  private carWidth(): number {
    return this.car.width ?? CAR_WIDTH;
  }

  /** What you're driving, for its damage; and its picture. */
  private rideShape(): Shape {
    return vehicleShape(this.ride);
  }

  private rideTexture(): string {
    const r = this.ride;
    return r.bus ? busTexture(this, r.kind, r.bus.colour, r.bus.ref) : vehicleTexture(this, r.kind, r.colour, this.look);
  }

  /** The button (or F, or E): out of what you're driving, or into what you're by. */
  private getInOrOut(): void {
    if (this.sinking >= 0 || this.downFor > 0 || this.air) return;
    if (!this.onFoot) {
      if (Math.hypot(this.car.vx, this.car.vy) < GET_OUT_SPEED) this.getOut(false);
      return;
    }
    const target = this.reachable();
    if (target) this.getIn(target);
  }

  /** The nearest thing you could get into from where you're standing: a vehicle (driven, or parked), or a bike lying on the ground. */
  private reachable(): Vehicle | { body: LooseProp; image: Phaser.GameObjects.Image } | null {
    if (!this.onFoot) return null;
    const { x, y } = this.car;
    let best: Vehicle | { body: LooseProp; image: Phaser.GameObjects.Image } | null = null;
    let bestD = REACH;
    for (const v of this.traffic.near(x, y, 120)) {
      if (v.level !== this.level) continue;
      // How far from its sides (or ends).
      const [ux, uy] = [Math.cos(v.angle), Math.sin(v.angle)];
      const [dx, dy] = [x - v.x, y - v.y];
      const d = Math.hypot(Math.max(0, Math.abs(dx * ux + dy * uy) - v.length / 2), Math.max(0, Math.abs(-dx * uy + dy * ux) - v.r));
      if (d < bestD) [best, bestD] = [v, d];
    }
    for (const i of this.nearbyLoose(x, y)) {
      const l = this.loose[i];
      if (l.body.kind !== 'bike' || l.body.gone || l.body.level !== this.level) continue;
      const d = Math.max(0, Math.hypot(l.body.x - x, l.body.y - y) - 4);
      if (d < bestD) [best, bestD] = [l, d];
    }
    return best;
  }

  /** Into a vehicle (pulling its driver out, if it's being driven), or onto a bike lying there. */
  private getIn(target: Vehicle | { body: LooseProp; image: Phaser.GameObjects.Image }): void {
    const car = this.car;
    if ('body' in target) {
      const { body, image } = target;
      body.gone = true;
      image.destroy();
      this.ride = { kind: 'bike', colour: Math.floor(Math.random() * COLOURS.bike.length) };
      this.wreck = newWreck();
      Object.assign(car, { x: body.x, y: body.y, heading: body.angle, vx: 0, vy: 0, spin: 0 });
      this.level = body.level;
    } else {
      const v = target;
      if (this.traffic.vehicles.includes(v)) {
        // Pulled out of their seat (the driver's, on the right), and off they run.
        const [rx, ry] = [-Math.sin(v.angle), Math.cos(v.angle)];
        const out = v.r + 0.8 * 8;
        this.people.jumpOut(v.x + rx * out, v.y + ry * out, v.level, v.rider ?? Math.floor(Math.random() * 48), car.x, car.y);
        this.audio?.knock();
      }
      this.traffic.take(v);
      this.ride = { kind: v.kind, colour: v.colour, ...(v.bus ? { bus: { colour: v.bus.colour, ref: v.bus.ref } } : {}) };
      this.wreck = v.wreck ?? newWreck();
      Object.assign(car, { x: v.x, y: v.y, heading: v.angle, vx: v.vx, vy: v.vy, spin: 0 });
      this.level = v.level;
    }
    this.onFoot = false;
    const k = VEHICLES[this.ride.kind];
    Object.assign(car, { length: k.length, width: k.width, invMass: 1 / k.mass });
    this.prev = { x: car.x, y: car.y, heading: car.heading };
    this.wreckShown = -1;
    this.carSprite.setTexture(this.rideTexture());
    this.carShadow.setTexture(vehicleShadow(this, this.ride.kind)).setVisible(true);
    this.effects.reset();
    this.reachTimer = 0;
  }

  /**
   * Out of what you're driving (or off it, thrown, `fell`): out of the
   * driver's door (on the right; the other side, if that's against a wall),
   * on foot; what you were driving left where it is, its damage and all.
   */
  private getOut(fell: boolean): void {
    const car = this.car;
    const h = car.heading;
    const off = this.carWidth() / 2 + 0.7 * 8;
    const free = (x: number, y: number) =>
      (this.level === 1 || this.surfaces.at(x, y) !== Surface.Deep) &&
      !this.walls[this.level].near(x, y, 4).some((w) => {
        const [px, py] = nearestOnSegment(x, y, w);
        return Math.hypot(px - x, py - y) < w.r + 3;
      });
    const spot = ([1, -1] as const).map((side) => [car.x - Math.sin(h) * side * off, car.y + Math.cos(h) * side * off] as const).find(([x, y]) => free(x, y)) ?? (fell ? ([car.x, car.y] as const) : null);
    if (!spot) return;
    const r = this.ride;
    if (r.kind === 'bike') {
      // A bike's left lying on its side (picked up again, ridden off).
      this.addDebris({ kind: 'bike', x: car.x, y: car.y, vx: car.vx * 0.6, vy: car.vy * 0.6, angle: h, spin: fell ? (Math.random() - 0.5) * 4 : 0, r: 2.4, length: 13, invMass: 12 }, this.level);
    } else {
      const bus = r.bus ? { bus: { route: -1, ref: r.bus.ref, colour: r.bus.colour, leg: 0, stops: [], served: new Set<number>(), dwell: -1, yield: false, lost: true } } : {};
      this.traffic.leave(r.kind, car.x, car.y, h, this.level, { colour: r.colour, wreck: this.wreck, ...bus });
    }
    this.onFoot = true;
    Object.assign(car, { x: spot[0], y: spot[1], vx: fell ? car.vx * 0.3 : 0, vy: fell ? car.vy * 0.3 : 0, spin: 0, length: WALKER.size, width: WALKER.size, invMass: WALKER.invMass });
    if (fell) {
      this.downFor = 2;
      this.audio?.knock();
    }
    this.wreck = newWreck();
    this.wreckShown = 0;
    this.prev = { x: car.x, y: car.y, heading: car.heading };
    this.effects.reset();
    this.reachTimer = 0;
  }

  /** On foot: turning and walking (or running); not into the water, nor through walls; knocked over by the traffic. */
  private stepOnFoot(dt: number): void {
    const car = this.car;
    if (this.air) return this.stepAir(dt);
    const [px, py] = [car.x, car.y];
    const high = this.level === 1 ? this.carHeight() : 0;
    if (this.downFor > 0) {
      this.downFor -= dt;
      car.vx *= Math.exp(-5 * dt);
      car.vy *= Math.exp(-5 * dt);
      car.x += car.vx * dt;
      car.y += car.vy * dt;
    } else stepWalker(car, this.input_, dt);
    if (this.level === 0 && this.surfaces.at(car.x, car.y) === Surface.Deep) {
      [car.x, car.y, car.vx, car.vy] = [px, py, 0, 0];
    }
    collideCarWithWalls(car, this.walls[this.level]);
    collideCarWithStatic(car, this.posts[this.level]);
    for (const v of this.traffic.near(car.x, car.y, 80)) {
      if (v.level !== this.level) continue;
      // How fast it's coming at you (not you at it: walking into the side of a car doesn't knock you over).
      const [dx, dy] = [car.x - v.x, car.y - v.y];
      const at = (v.vx * dx + v.vy * dy) / (Math.hypot(dx, dy) || 1);
      const bump = collideCarWithBody(car, v, CAR_BUMP, this.contact);
      // Driven into you: over you go.
      if (bump > 0 && at > 3 * 8 && this.downFor <= 0) {
        this.downFor = 2.5;
        this.audio?.knock();
        this.shake(0.15, 1.5);
      }
    }
    for (const i of this.nearbyLoose(car.x, car.y)) {
      const { body } = this.loose[i];
      if (body.level !== this.level || body.gone) continue;
      if (collideCarWithBody(car, body) > 0) body.moved = true;
    }
    this.stride += Math.hypot(car.x - px, car.y - py);
    this.level = this.decks.stepAt(this.level, car.x, car.y, this.groundAt(car.x, car.y));
    this.surface = this.level === 1 ? Surface.Road : this.surfaces.at(car.x, car.y);
    if (this.level !== 0) return;
    // Off the side of a bridge, or over the edge of a drop: falling (but not off a quay: you can't swim, so that's as far as you go).
    if (high && high - this.groundAt(car.x, car.y) > 0.5 * 8) return this.fall(high - this.groundAt(car.x, car.y));
    const over = this.ledges.wentOver(px, py, car.x, car.y);
    if (over && this.surfaces.at(car.x + over.nx * 16, car.y + over.ny * 16) === Surface.Deep) [car.x, car.y, car.vx, car.vy] = [px, py, 0, 0];
    else if (over) this.fall(over.drop);
    else this.ledges.collide(car);
  }

  /** Off the edge: falling from `drop` px up. */
  private fall(drop: number): void {
    this.air = { z: drop, vz: 0, drop };
    this.hopLeft = 0;
  }

  /** In the air: carrying on the way it was going, faster and faster down; still stopped by a wall or a building alongside. */
  private stepAir(dt: number): void {
    const car = this.car;
    const a = this.air!;
    car.x += car.vx * dt;
    car.y += car.vy * dt;
    car.heading += car.spin * dt;
    a.vz -= GRAVITY * dt;
    a.z += a.vz * dt;
    this.level = 0;
    collideCarWithWalls(car, this.walls[0]);
    if (a.z > 0) return;
    this.air = null;
    this.land(-a.vz, a.drop);
  }

  /**
   * Down: into the water (sinking, or put back, on foot); otherwise a thump,
   * as hard as it fell, the nose into the ground (dented, and slowed); on foot
   * from high enough, knocked flat; on a bike, off it.
   */
  private land(speed: number, drop: number): void {
    const car = this.car;
    this.surface = this.surfaces.at(car.x, car.y);
    this.effects.reset();
    if (this.surface === Surface.Deep) {
      this.effects.splashAt(car.x, car.y, 30);
      this.audio?.splash(Math.hypot(car.vx, car.vy) + 150 + speed);
      if (this.onFoot) return this.resetCar();
      this.sinking = 0;
      this.audio?.sink();
      return;
    }
    this.audio?.crash(Math.min(260, speed * 2.5));
    this.shake(0.22, Math.min(7, speed / 12));
    this.people.scareAround(car.x, car.y, 12 * 8, 0);
    if (this.onFoot) {
      if (drop > 1.5 * 8) {
        this.downFor = Math.min(3, 0.6 + (drop / 8) * 0.4);
        this.audio?.knock();
      }
      return;
    }
    if (this.ride.kind === 'bike') {
      if (speed > 40) this.thrown = true;
      return;
    }
    const half = this.carLength() / 2;
    this.dent(null, car.x + Math.cos(car.heading) * half, car.y + Math.sin(car.heading) * half, speed * 2.2);
    // (A heavy one's slowed less.)
    const k = Math.min(0.6, speed / 200) * Math.sqrt(car.invMass ?? 1);
    car.vx *= 1 - k;
    car.vy *= 1 - k;
    this.hopPeak = Math.min(0.6, speed / 150);
    this.hopLeft = HOP_TIME;
  }

  /** How loud something at (x, y) is, by how far it is from the car: 1 close, 0 out of earshot. */
  private hearing(x: number, y: number): number {
    return Math.max(0, 1 - Math.hypot(x - this.car.x, y - this.car.y) / 600);
  }

  private hit(impulse: number): void {
    // (A heavy vehicle's hits are harder, but not as much harder as its weight.)
    impulse *= Math.sqrt(this.car.invMass ?? 1);
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

  /** Back on the road, where it last was safely, and repaired (on foot, back there). */
  private resetCar(): void {
    Object.assign(this.car, { x: this.safe.x, y: this.safe.y, heading: this.safe.heading, vx: 0, vy: 0, spin: 0 });
    this.air = null;
    if (this.onFoot) {
      this.level = 0;
      this.downFor = 0;
      return;
    }
    this.sinking = -1;
    this.level = 0;
    this.surface = this.surfaces.at(this.car.x, this.car.y);
    this.effects.reset();
    // Good as new.
    Object.assign(this.wreck, newWreck());
    this.wreckShown = this.wreck.version;
    this.carSprite.setTexture(this.rideTexture()).setAlpha(1).setTint(0xffffff);
    this.carShadow.setTexture(vehicleShadow(this, this.ride.kind));
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
    if (this.onFoot) {
      // You: standing, stepping as you walk (and run), or down, knocked over.
      const moving = Math.hypot(this.car.vx, this.car.vy) > 4;
      const pose: Pose = this.downFor > 0 ? 'down' : !moving ? 'stand' : Math.floor(this.stride / (0.75 * 8)) % 2 ? 'step0' : 'step1';
      // (Falling, nearer the camera at first.)
      const up = 1 + ((this.air?.z ?? 0) / 8) * 0.05;
      this.carSprite.setTexture(personTexture(this, this.look, pose)).setScale((PERSON_SIZE / ART_SCALE) * up).setAlpha(1).clearTint().setPosition(x, y).setRotation(heading);
      this.carShadow.setVisible(false);
      return;
    }
    if (this.wreck.version !== this.wreckShown) {
      this.wreckShown = this.wreck.version;
      const k = VEHICLES[this.ride.kind];
      paintWreck(this, 'car-dented', { base: this.rideTexture(), length: k.length, width: k.width, mirror: this.rideShape().mirror }, this.wreck);
      this.carSprite.setTexture('car-dented');
      // Its shadow the shape it is now (crumpled in, parts gone).
      this.carShadow.setTexture('car-dented');
    }
    // Off a speed hump: up and down again, nearer the camera at the top (a little bigger), its shadow further off.
    const phase = this.hopLeft > 0 ? 1 - this.hopLeft / HOP_TIME : 1;
    const hop = this.hopPeak * 4 * phase * (1 - phase);
    // (A bike drawn as big as the people are: see TrafficLayer.)
    // Falling: high up, nearer the camera (a little bigger), its shadow down on the ground below, further off.
    const up = this.air?.z ?? 0;
    const s = ((this.ride.kind === 'bike' ? 1.4 : 1) / ART_SCALE) * (1 + hop * 0.07) * (1 + (up / 8) * 0.04);
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
    this.carShadow.setPosition(x + 2.5 + hop * 3 + up * 0.5, y + 3.5 + hop * 4 + up * 0.6).setRotation(heading);
  }

  /** Follows the car, looking ahead the way it's going, and pulls back the faster it goes. */
  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    const car = this.car;
    // Everything it follows eased in and out (springs, not jumps): a knock, a kerb or a sudden turn doesn't jolt it.
    this.pace += (Math.hypot(car.vx, car.vy) - this.pace) * Math.min(1, dt * 4);
    const t = Math.min(this.pace / FULL_SPEED, 1) ** PULL_EASE;
    const side = Math.min(this.scale.width, this.scale.height);
    // (On foot, closer in.)
    const rest = restView(side) * (this.onFoot ? ON_FOOT_VIEW : 1);
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
        this.props[post.index].image?.setVisible(false);
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
  private updateTrees(view: Phaser.Geom.Rectangle, dt: number): void {
    const p = this.perspective;
    const pad = 120;
    const { x: cx, y: cy } = this.shown;
    const crowns = this.world.map.trees;
    // (Those round the view, by where they stand: a falling one's crown can be its height away.)
    const now = new Set<number>();
    for (const i of this.treeGrid.around(view, pad + 400, this.shownTrees)) {
      const t = this.trees[i];
      const show = !t.gone && t.x > view.left - pad && t.x < view.right + pad && t.y > view.top - pad && t.y < view.bottom + pad;
      // Its trunk, while it stands (once it's down, it's the stump and the trunk lying there instead).
      const standing = crowns[i * 4 + 2] > 0;
      const trunk = standing && t.foot.x > view.left - pad && t.foot.x < view.right + pad && t.foot.y > view.top - pad && t.foot.y < view.bottom + pad;
      if (!show && !trunk) {
        // Out of sight: its pictures go back for another tree.
        if (t.art) {
          t.art.image.setVisible(false);
          t.art.trunk.setVisible(false);
          t.art.bole.setVisible(false);
          this.treeArtPool.push(t.art);
          t.art = null;
        }
        continue;
      }
      now.add(i);
      const { image, trunk: stem, bole } = this.treeArt(t);
      if (image.visible !== show) image.setVisible(show);
      if (stem.visible !== trunk) {
        stem.setVisible(trunk);
        bole.setVisible(trunk);
      }
      if (trunk) {
        // From its foot up to where it goes into the crown, leaning out from the middle of the view as the rest does.
        const s0 = p.lift(t.z);
        const s1 = p.lift(t.z + t.h * 0.6);
        const [ax, ay, bx, by] = [p.x(t.foot.x, s0), p.y(t.foot.y, s0), p.x(t.foot.x, s1), p.y(t.foot.y, s1)];
        const width = Math.min(7, 3 + t.h / 40);
        stem
          .setPosition((ax + bx) / 2, (ay + by) / 2)
          .setRotation(Math.atan2(by - ay, bx - ax))
          .setDisplaySize(Math.max(0.5, Math.hypot(bx - ax, by - ay)), width);
        bole.setPosition(bx, by).setDisplaySize(width * 1.3, width * 1.3);
      }
      if (!show) continue;
      // Under its crown (where it stands), the crown's see-through, so you can see the car and the trunk.
      const under = standing && Math.hypot(cx - t.foot.x, cy - t.foot.y) < t.foot.r + CAR_LENGTH * 0.25;
      const target = under ? 0.3 : 1;
      if (t.alpha !== target) {
        t.alpha += Math.sign(target - t.alpha) * Math.min(Math.abs(target - t.alpha), dt * 4);
        image.setAlpha(t.alpha);
      }
      // The crown's a little below the treetop.
      const s = p.lift(t.z + t.h * 0.85);
      let [x, y] = [p.x(t.x, s), p.y(t.y, s)];
      if (standing) {
        // Swaying in the wind: each in its own time (the bigger, the slower), more in the gusts that roll across.
        const time = this.time.now / 1000;
        const slow = 0.9 / Math.sqrt(1 + t.h / 60);
        const phase = i * 2.399;
        const gust = 0.55 + 0.45 * Math.max(0, Math.sin(time * 0.23 - (t.foot.x * 0.6 + t.foot.y * 0.25) * 0.0025));
        const sway = Math.sin(time * slow * 2.1 + phase) * 0.6 + Math.sin(time * slow * 3.7 + phase * 1.7) * 0.4;
        x += WIND_X * sway * gust * (0.6 + t.h / 120);
        y += WIND_Y * sway * gust * (0.6 + t.h / 120);
        image.setRotation(t.turn + sway * gust * 0.025);
      }
      image.setPosition(x, y);
    }
    this.shownTrees = now;
  }

  /** The street furniture near the view, standing on the hills. */
  private updateProps(view: Phaser.Geom.Rectangle): void {
    const p = this.perspective;
    const pad = 120;
    // (A crane's jib reaches out from its foot: looked for further round.)
    for (const [list, grid, shown, reach] of [
      [this.props, this.propGrid, this.shownProps, pad],
      [this.raised, this.raisedGrid, this.shownRaised, pad + 600],
    ] as [Shown[], Grid, Set<number>, number][]) {
      const now = new Set<number>();
      for (const i of grid.around(view, reach, shown)) {
        const t = list[i];
        const show = !t.gone && t.x > view.left - pad && t.x < view.right + pad && t.y > view.top - pad && t.y < view.bottom + pad;
        // Made as it comes into view, and let go once it's out of it (if it can be made again).
        if (show && !t.image && t.make) t.image = t.make();
        if (!show && t.image && t.make) {
          t.image.destroy();
          t.image = null;
        }
        if (!t.image) continue;
        if (t.image.visible !== show) t.image.setVisible(show);
        if (!show) continue;
        now.add(i);
        const s = p.lift(t.z);
        t.image.setPosition(p.x(t.x, s), p.y(t.y, s));
      }
      shown.clear();
      for (const i of now) shown.add(i);
    }
    // The loose things, from the chunks round the view (and those shown, or moving, already).
    const loose = new Set(this.shownLoose);
    for (let cx = Math.floor((view.left - pad) / CHUNK); cx <= Math.floor((view.right + pad) / CHUNK); cx++) {
      for (let cy = Math.floor((view.top - pad) / CHUNK); cy <= Math.floor((view.bottom + pad) / CHUNK); cy++) for (const i of this.looseByChunk.get(chunkKey(cx, cy)) ?? []) loose.add(i);
    }
    this.shownLoose.clear();
    for (const i of loose) {
      const { body, image } = this.loose[i];
      if (body.gone) continue;
      const show = body.x > view.left - pad && body.x < view.right + pad && body.y > view.top - pad && body.y < view.bottom + pad;
      if (image.visible !== show) image.setVisible(show);
      if (!show && !body.moved) continue;
      this.shownLoose.add(i);
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


const shapes = new Map<string, Shape>();

/** Out of what you're driving only going slower than this, px/s (a fast walk). */
const GET_OUT_SPEED = 3 * 8;
/** Into something only from within this of it, px. */
const REACH = 1.3 * 8;

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

function vehicleShape(v: { kind: VehicleKind }): Shape {
  let shape = shapes.get(v.kind);
  if (!shape) {
    const k = VEHICLES[v.kind];
    shape = { length: k.length, width: k.width, stiffness: STIFFNESS[v.kind], ...bodyLayout(v.kind) };
    shapes.set(v.kind, shape);
  }
  return shape;
}

/**
 * Things (by their index in a list) by where they stand, in squares of CHUNK
 * px: so only those round the view are looked at each frame, not all of
 * them, however big the map.
 */
class Grid {
  private readonly cells = new Map<number, number[]>();

  constructor(n: number, at: (i: number) => [number, number]) {
    for (let i = 0; i < n; i++) {
      const [x, y] = at(i);
      const k = Grid.key(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
      const list = this.cells.get(k);
      if (list) list.push(i);
      else this.cells.set(k, [i]);
    }
  }

  private static key(cx: number, cy: number): number {
    return (cx + 1024) * 4096 + (cy + 1024);
  }

  /** Those within `pad` px of the view, and any of `also` (those shown last time, to hide again). */
  around(view: Phaser.Geom.Rectangle, pad: number, also: Set<number>): Set<number> {
    const out = new Set(also);
    for (let cx = Math.floor((view.left - pad) / CHUNK); cx <= Math.floor((view.right + pad) / CHUNK); cx++) {
      for (let cy = Math.floor((view.top - pad) / CHUNK); cy <= Math.floor((view.bottom + pad) / CHUNK); cy++) {
        for (const i of this.cells.get(Grid.key(cx, cy)) ?? []) out.add(i);
      }
    }
    return out;
  }
}

/** Something fixed, drawn when it's in view: its picture (made as it comes into view, by `make`, if it has that), how high it stands. */
interface Shown {
  x: number;
  y: number;
  z: number;
  image: Phaser.GameObjects.Image | null;
  make?: () => Phaser.GameObjects.Image;
  gone?: boolean;
}
