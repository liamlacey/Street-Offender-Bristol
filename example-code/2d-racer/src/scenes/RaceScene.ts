import * as Phaser from 'phaser';
import {
  type CarInput,
  type CarState,
  CAR_LENGTH,
  DEFAULT_TUNING,
  NO_INPUT,
  SURFACE_GRIP,
  type SurfaceKind,
  createCar,
  lateralSpeed,
  stepCar,
} from '../car/CarPhysics';
import { AiDriver, type DriverProfile } from '../ai/AiDriver';
import { type EngineState, RaceAudio } from '../audio/RaceAudio';
import { DIFFICULTY, driversFor } from '../ai/drivers';
import { type Difficulty, loadDifficulty } from '../settings';
import { DEFAULT_LINE, type RacingLine, buildRacingLine } from '../ai/racingLine';
import type { TouchState } from '../input/TouchControls';
import {
  type Body,
  type Circle,
  CircleGrid,
  collideBodyWithStatic,
  collideCarWithBody,
  collideCarWithStatic,
  collideCars,
  type ContactPoint,
  stepBody,
} from '../physics/collisions';
import { type LapResult, LapTracker } from '../race/LapTracker';
import { WrongWayDetector } from '../race/WrongWayDetector';
import { loadBestLap, saveBestLap } from '../race/bestLaps';
import { gridSlots } from '../race/grid';
import { raceOrder } from '../race/standings';
import { CONE_RADIUS, TYRE_RADIUS, buildBarriers, obstaclePieces, placeCones } from '../track/barriers';
import { type Decoration, drivingSurface, planDecoration } from '../track/decoration';
import { inWater } from '../track/water';
import { type Pose, type Track, type Vec2, buildTrack, locateOnTrack, poseAt } from '../track/Track';
import { LOCATIONS, type LocationId, type Location, cornerScale } from '../locations/locations';
import { CLASSIC, saveTrack } from '../race/savedTracks';
import { type TrackDifficulty, type TrackLength, generateTrack, randomSeed } from '../track/generate';
import type { TrackDefinition } from '../track/Track';
import { drawCheckpointGate, drawTrack } from './drawTrack';
import { CarEffects } from './CarEffects';
import { Decorations } from './Decorations';
import { SkidMarks } from './SkidMarks';
import { CIRCUIT_TEX, createCircuitTextures, mownGrassTexture } from '../circuit/art';
import { pavementTexture } from '../downtown/art';
import { WINTER_VARIANTS, snowTexture } from '../winter/art';
import { DESERT_VARIANTS, desertTexture } from '../desert/art';
import { inRect, streetRect } from '../downtown/city';
import { type StreetThing, StreetScenery } from '../downtown/StreetScenery';
import { TEX, carTexture, createPlaceholderTextures, groundTexture } from './textures';
import { DECO_TEXTURE } from './decorationArt';
import { WOODS_VARIANTS } from './woodsArt';

/** Grass around the track's outermost points before the world edge. */
const WORLD_MARGIN = 600;
/** How far ahead (in seconds of travel) the camera looks in the direction the car is moving. */
const LOOK_AHEAD_TIME = 0.3;
/** Most the camera can lead the car by, as a fraction of the visible width/height. */
const LOOK_AHEAD_MAX = 0.18;
/** How quickly the look-ahead catches up with changes of direction (per second). */
const LOOK_AHEAD_RESPONSE = 2.5;
const PLAYER_COLOR = 0xd7263d;
/** Seconds of 3-2-1 before the lights go green. */
const COUNTDOWN = 3;
/** Physics runs at a fixed rate so handling feels the same at any frame rate. */
const PHYSICS_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 8;
export const TELEMETRY_EVENT = 'telemetry';
export const RESET_EVENT = 'reset-car';
/** Emitted with a LapEvent each time the player completes a lap. */
export const LAP_EVENT = 'lap-complete';
/** Emitted (by the HUD) to start the same race again. */
export const RESTART_EVENT = 'restart';
/** Emitted (by the HUD) to race again on a freshly generated track with the same settings. */
export const NEW_TRACK_EVENT = 'new-track';
/** Emitted (by the HUD) with a name to save this race's track. */
export const SAVE_TRACK_EVENT = 'save-track';
/** Emitted (by the HUD) with true/false to pause or resume. */
export const PAUSE_EVENT = 'pause';
/** Emitted (by the HUD) to leave the race for the start menu. */
export const MENU_EVENT = 'menu';

/** Everything that defines a race. The menu builds it; restarts reuse it. */
export interface RaceSettings {
  track: TrackDefinition;
  location: LocationId;
  length: TrackLength;
  /** How hard the track was generated (NEW TRACK makes another like it). */
  trackDifficulty: TrackDifficulty;
  /** The saved track's id, or null for a new track that hasn't been saved. */
  trackId: string | null;
  trackName: string;
  mode: RaceMode;
  difficulty: Difficulty;
  laps: number;
  /** AI cars in a race (not used in time trial). */
  opponents: number;
  /** Best lap so far on an unsaved track, carried over "Race again". */
  bestLap?: number | null;
}

/** A race on the built-in classic track, for when no settings are given. */
function classicSettings(): RaceSettings {
  return {
    track: CLASSIC.definition,
    location: CLASSIC.location,
    length: CLASSIC.length,
    trackDifficulty: CLASSIC.definition.difficulty ?? 'easy',
    trackId: CLASSIC.id,
    trackName: CLASSIC.name,
    mode: 'race',
    difficulty: loadDifficulty(),
    laps: 3,
    opponents: 3,
  };
}

/** Settings for a brand-new generated track at a location and length. */
export function newTrackSettings(
  location: Location,
  length: TrackLength,
  trackDifficulty: TrackDifficulty,
  race: Pick<RaceSettings, 'mode' | 'difficulty' | 'laps' | 'opponents'>,
): RaceSettings {
  return {
    ...race,
    track: generateTrack(location, length, randomSeed(), trackDifficulty),
    location: location.id,
    length,
    trackDifficulty,
    trackId: null,
    trackName: `New ${location.name} track`,
  };
}

export type RaceMode = 'race' | 'timeTrial';

export interface LapEvent extends LapResult {
  /** Laps in the race, or null in time trial. */
  totalLaps: number | null;
}

export interface Standing {
  name: string;
  color: number;
  isPlayer: boolean;
  /** Race time at the finish, or null if still racing. */
  finishTime: number | null;
  bestLap: number | null;
  lap: number;
}
/** Registry key under which the HUD shares its on-screen button state. */
export const TOUCH_STATE_KEY = 'touch-state';
/** Registry key for the current Track, read by the HUD minimap. */
export const TRACK_KEY = 'track';
/** Registry key for the current RaceMode, read by the HUD when it starts. */
export const MODE_KEY = 'mode';

export interface Telemetry {
  /** px/s */
  speed: number;
  drifting: boolean;
  x: number;
  y: number;
  /** Current lap number, 0 before crossing the start line. */
  lap: number;
  /** Seconds into the current lap. */
  lapTime: number;
  lastLap: number | null;
  bestLap: number | null;
  wrongWay: boolean;
  missedCheckpoint: boolean;
  /** Where the next checkpoint is and which way the track runs there, for the minimap. */
  nextCheckpoint: { x: number; y: number; heading: number };
  /** The other cars, for the minimap. */
  opponents: { x: number; y: number; color: number }[];
  mode: RaceMode;
  /** Seconds left before the start (0 once racing). */
  countdown: number;
  /** Seconds since the start, for the "GO!" message. */
  raceTime: number;
  /** Race only: the player's position (1 = leading) out of `racers`. */
  position: number;
  racers: number;
  totalLaps: number | null;
  /** Race only: everyone in race order, once the player has finished. */
  results: Standing[] | null;
  paused: boolean;
  trackName: string;
  locationName: string;
  /** Whether this track is saved (if not, the HUD offers to save it). */
  trackSaved: boolean;
}

/** Time trial: how far behind the start line the car starts. */
const TIME_TRIAL_START = 120;
/** Drives the player's car round gently after they cross the finish line. */
const COOL_DOWN: DriverProfile = { name: 'You', color: PLAYER_COLOR, pace: 0.75, wobble: 0 };

/** Lateral speed (px/s) above which we call it a drift in the HUD. */
const DRIFT_THRESHOLD = 90;
/** Cone mass relative to the car's: light enough to send flying, heavy enough to notice. */
const CONE_INV_MASS = 12.5;
/** Loose tyres on the road weigh more than cones: they slow you more and move less, but still move. */
const LOOSE_TYRE_INV_MASS = 2.5;
/** Collision impulses (≈ speed lost, px/s) above this shake the camera. */
const SHAKE_THRESHOLD = 200;
/** Collision impulses above this throw sparks. */
const SPARK_THRESHOLD = 90;
/** Where the car's shadow falls, as if lit from the top left. */
const SHADOW_OFFSET = { x: 4, y: 5 };

/** Draw order, back to front. */
const DEPTH = {
  ground: 0.9,
  track: 1,
  overRoad: 1.5,
  ripples: 1.6,
  skidMarks: 2,
  roadShadow: 2.5,
  gate: 3,
  propShadows: 3.5,
  props: 4,
  shadows: 5,
  cars: 6,
  effects: 7,
  overhead: 8,
  sky: 9,
};

/** Something loose that cars knock about: a cone, a tyre lying on the road, or (downtown) the street's life. */
interface Loose {
  body: Body;
  sprite: Phaser.GameObjects.Image;
  kind: 'cone' | 'tyre' | StreetThing;
}

/** A car in the race: the player's (no driver) or an AI's. */
interface Racer {
  name: string;
  color: number;
  car: CarState;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  laps: LapTracker;
  driver: AiDriver | null;
  finishTime: number | null;
  /** This step's controls and surface, for tyre marks and smoke. */
  input: CarInput;
  surface: SurfaceKind;
}

interface Controls {
  up: Phaser.Input.Keyboard.Key[];
  down: Phaser.Input.Keyboard.Key[];
  left: Phaser.Input.Keyboard.Key[];
  right: Phaser.Input.Keyboard.Key[];
  handbrake: Phaser.Input.Keyboard.Key;
  reset: Phaser.Input.Keyboard.Key;
}

export class RaceScene extends Phaser.Scene {
  private settings!: RaceSettings;
  private location!: Location;
  private mode: RaceMode = 'race';
  private paused = false;
  private countdown = 0;
  private racingLine!: RacingLine;
  private track!: Track;
  private world!: Phaser.Geom.Rectangle;
  private racers: Racer[] = [];
  private player!: Racer;
  private controls!: Controls;
  private accumulator = 0;
  /** Race clock in seconds, advanced in fixed physics steps so lap times don't depend on frame rate. */
  private raceTime = 0;
  private wrongWay!: WrongWayDetector;
  private lookAhead = { x: 0, y: 0 };
  private gate!: Phaser.GameObjects.Graphics;
  /** The checkpoint the gate is currently drawn at, so it's only redrawn when that changes. */
  private gateAlong = -1;
  private barriers!: CircleGrid;
  private loose: Loose[] = [];
  /** Downtown: parked cars, people and street furniture along the race's streets. */
  private street: StreetScenery | null = null;
  private decoration!: Decoration;
  private decorations!: Decorations;
  private effects!: CarEffects;
  private audio: RaceAudio | null = null;
  /** Start lamps lit last frame (4 = green), so each change beeps once. */
  private lampsLit = -1;
  /** Race time of the last cone "tock", so a long brush doesn't machine-gun it. */
  private lastConeSound = -1;

  constructor() {
    super('race');
  }

  /** Runs before every create(), including restarts, so per-race state starts fresh. */
  init(data: Partial<RaceSettings>): void {
    this.settings = data.track ? (data as RaceSettings) : classicSettings();
    this.location = LOCATIONS[this.settings.location];
    this.mode = this.settings.mode;
    this.paused = false;
    this.countdown = this.mode === 'race' ? COUNTDOWN : 0;
    this.accumulator = 0;
    this.raceTime = 0;
    this.racers = [];
    this.loose = [];
    this.street = null;
    this.lookAhead = { x: 0, y: 0 };
    this.gateAlong = -1;
    this.lampsLit = -1;
    this.lastConeSound = -1;
  }

  create(): void {
    createPlaceholderTextures(this);
    if (this.location.circuit) createCircuitTextures(this);

    this.track = buildTrack(this.settings.track);
    const { minX, minY, maxX, maxY } = this.track.bounds;
    this.world = new Phaser.Geom.Rectangle(
      minX - WORLD_MARGIN,
      minY - WORLD_MARGIN,
      maxX - minX + WORLD_MARGIN * 2,
      maxY - minY + WORLD_MARGIN * 2,
    );
    this.registry.set(TRACK_KEY, this.track);
    this.registry.set(MODE_KEY, this.mode);
    this.wrongWay = new WrongWayDetector();

    // At the docks the ground is laid out plot by plot over the harbour water (see PortScenery).
    if (!this.location.decoration.port) {
      const ground = this.location.circuit
        ? mownGrassTexture(this, this.location)
        : this.location.decoration.city
          ? pavementTexture(this, this.location)
          : this.location.decoration.winter
            ? snowTexture(this, this.location)
            : this.location.decoration.desert
              ? desertTexture(this, this.location)
              : groundTexture(this, this.location);
      this.add.tileSprite(this.world.x, this.world.y, this.world.width, this.world.height, ground).setOrigin(0, 0);
    }
    const tyres = buildBarriers(this.track);
    const difficulty = this.settings.track.difficulty ?? 'medium';
    const decoration = planDecoration(this.track, tyres, this.location.decoration, WORLD_MARGIN, difficulty, this.location.circuit ?? null);
    this.decoration = decoration;
    this.decorations = new Decorations(this, this.track, decoration, this.location, {
      ground: DEPTH.ground,
      overRoad: DEPTH.overRoad,
      ripples: DEPTH.ripples,
      roadShadow: DEPTH.roadShadow,
      shadows: DEPTH.propShadows,
      props: DEPTH.props,
      overhead: DEPTH.overhead,
      sky: DEPTH.sky,
    });
    drawTrack(this, this.track, this.location, decoration, this.decorations.chunks, DEPTH.track);
    this.createBarriersAndCones(tyres, decoration.solids);
    const skidMarks = new SkidMarks(this, DEPTH.skidMarks);
    this.effects = new CarEffects(this, skidMarks, DEPTH.effects);
    this.gate = this.add.graphics().setVisible(false).setDepth(DEPTH.gate);
    this.tweens.add({ targets: this.gate, alpha: 0.5, duration: 500, yoyo: true, repeat: -1 });

    this.createRacers();

    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.controls = {
      up: [kb.addKey(K.UP), kb.addKey(K.W)],
      down: [kb.addKey(K.DOWN), kb.addKey(K.S)],
      left: [kb.addKey(K.LEFT), kb.addKey(K.A)],
      right: [kb.addKey(K.RIGHT), kb.addKey(K.D)],
      handbrake: kb.addKey(K.SPACE),
      reset: kb.addKey(K.R),
    };

    const cam = this.cameras.main;
    cam.setBounds(this.world.x, this.world.y, this.world.width, this.world.height);
    cam.setBackgroundColor('#1b1f24');
    cam.centerOn(this.player.car.x, this.player.car.y);

    this.events.on(RESET_EVENT, this.resetCar, this);
    this.events.on(RESTART_EVENT, () => this.scene.restart({ ...this.settings, bestLap: this.player.laps.bestLap }));
    this.events.on(NEW_TRACK_EVENT, () =>
      this.scene.restart(newTrackSettings(this.location, this.settings.length, this.settings.trackDifficulty, this.settings)),
    );
    this.events.on(SAVE_TRACK_EVENT, (name: string) => this.saveThisTrack(name));
    // Back to the track list, where a just-saved track now appears.
    this.events.on(MENU_EVENT, () => this.scene.start('menu', { page: 'tracks' }));
    this.events.on(PAUSE_EVENT, (paused: boolean) => (this.paused = paused));
    // Switching apps or taking a call pauses the race.
    const pauseWhenHidden = () => {
      if (this.player.finishTime === null) this.paused = true;
    };
    this.game.events.on(Phaser.Core.Events.HIDDEN, pauseWhenHidden);
    // Web Audio only (not the old HTML5 audio fallback, which can't synthesise).
    const sound = this.sound as Phaser.Sound.WebAudioSoundManager;
    if ('context' in sound && sound.context) {
      this.audio = new RaceAudio(sound.context, sound.destination, this.racers.length);
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.audio?.destroy();
      this.audio = null;
      this.events.off(RESET_EVENT, this.resetCar, this);
      this.events.off(RESTART_EVENT);
      this.events.off(NEW_TRACK_EVENT);
      this.events.off(SAVE_TRACK_EVENT);
      this.events.off(MENU_EVENT);
      this.events.off(PAUSE_EVENT);
      this.game.events.off(Phaser.Core.Events.HIDDEN, pauseWhenHidden);
      this.scene.stop('hud');
    });
    this.scene.launch('hud');
  }

  update(time: number, deltaMs: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.controls.reset)) {
      this.resetCar();
    }

    const input = this.readInput();
    let hardestHit = 0;
    // Everyone waits on the grid until the countdown ends.
    if (this.paused) this.accumulator = 0;
    else if (this.countdown > 0) this.countdown = Math.max(0, this.countdown - deltaMs / 1000);
    else this.accumulator = Math.min(this.accumulator + deltaMs / 1000, PHYSICS_DT * MAX_STEPS_PER_FRAME);
    while (this.accumulator >= PHYSICS_DT) {
      this.accumulator -= PHYSICS_DT;
      this.raceTime += PHYSICS_DT;
      hardestHit = Math.max(hardestHit, this.stepRace(input));
    }

    for (const { car, sprite, shadow, surface, input: carInput } of this.racers) {
      sprite.setPosition(car.x, car.y).setRotation(car.heading);
      shadow.setPosition(car.x + SHADOW_OFFSET.x, car.y + SHADOW_OFFSET.y).setRotation(car.heading);
      this.effects.update(car, surface, carInput);
    }
    this.effects.flush();
    this.audio?.setPaused(this.paused);
    if (!this.paused) this.updateAudio(hardestHit);
    for (const { body, sprite } of this.loose) sprite.setPosition(body.x, body.y).setRotation(body.angle);
    this.street?.draw(time, deltaMs / 1000, this.raceTime, this.cameras.main.worldView);
    this.decorations.update(time, deltaMs / 1000, this.racers.map((r) => r.car), this.cameras.main);
    if (hardestHit > SHAKE_THRESHOLD) {
      const strength = Math.min((hardestHit - SHAKE_THRESHOLD) / 700, 1);
      this.cameras.main.shake(120 + 120 * strength, 0.003 + 0.009 * strength);
    }

    const { car, laps } = this.player;
    const speed = Math.hypot(car.vx, car.vy);
    // Pull the camera back a little at speed so you can see what's coming,
    // and further back on small (phone) screens.
    const cam = this.cameras.main;
    const screenScale = Phaser.Math.Clamp(Math.min(cam.width, cam.height) / 600, 0.65, 1);
    const targetZoom = screenScale * Phaser.Math.Linear(1.15, 0.8, Math.min(speed / DEFAULT_TUNING.maxForwardSpeed, 1));
    cam.setZoom(Phaser.Math.Linear(cam.zoom, targetZoom, 0.04));
    this.updateCamera(deltaMs / 1000);
    this.updateGate();

    const telemetry: Telemetry = {
      speed,
      drifting: Math.abs(lateralSpeed(car)) > DRIFT_THRESHOLD,
      x: car.x,
      y: car.y,
      lap: laps.lap,
      lapTime: laps.currentLapTime(this.raceTime),
      lastLap: laps.lastLap,
      bestLap: laps.bestLap,
      // Going back for a missed checkpoint means driving backwards, so don't nag about it.
      wrongWay: this.wrongWay.wrongWay && !laps.missedCheckpoint,
      missedCheckpoint: laps.missedCheckpoint,
      nextCheckpoint: poseAt(this.track, laps.nextCheckpointAlong),
      opponents: this.racers.filter((r) => r !== this.player).map((r) => ({ x: r.car.x, y: r.car.y, color: r.color })),
      mode: this.mode,
      countdown: this.countdown,
      raceTime: this.raceTime,
      totalLaps: this.mode === 'race' ? this.settings.laps : null,
      ...this.standings(),
      paused: this.paused,
      trackName: this.settings.trackName,
      locationName: this.location.name,
      trackSaved: this.settings.trackId !== null,
    };
    this.events.emit(TELEMETRY_EVENT, telemetry);
  }

  /**
   * One fixed physics step for every car: drive, move, collide, count laps.
   * Returns the hardest hit the player's car took, for camera shake.
   */
  private stepRace(playerInput: CarInput): number {
    const cars = this.racers.map((r) => r.car);
    this.street?.step(PHYSICS_DT, this.time.now / 1000, cars);
    let playerHit = 0;
    for (const racer of this.racers) {
      const { car, laps, driver } = racer;
      const pos = locateOnTrack(this.track, car.x, car.y);
      const input = driver ? driver.drive(car, cars.filter((c) => c !== car), PHYSICS_DT) : playerInput;
      const surface = drivingSurface(this.track, this.decoration, this.location, pos, car.x, car.y);
      if (racer === this.player && surface === 'water' && racer.surface !== 'water') {
        this.audio?.splash(Math.hypot(car.vx, car.vy));
      }
      racer.input = input;
      racer.surface = surface;
      stepCar(car, input, PHYSICS_DT, SURFACE_GRIP[surface]);
      const contact: ContactPoint = { x: 0, y: 0 };
      const hit = collideCarWithStatic(car, this.barriers, undefined, contact);
      if (hit > SPARK_THRESHOLD) this.effects.sparksAt(contact.x, contact.y, hit);
      for (const { body, kind } of this.loose) {
        const knock = collideCarWithBody(car, body);
        if (knock > 30 && racer === this.player && this.raceTime - this.lastConeSound > 0.08) {
          this.lastConeSound = this.raceTime;
          // Cones tock; people yelp; tumbleweeds barely thud; tyres, drums, straw bales, snowmen, parked cars and the rest thump.
          const { obstacle } = this.location;
          if (kind === 'cone' && obstacle === 'tumbleweeds') this.audio?.crash(knock * 0.15);
          else if (kind === 'cone' && obstacle !== 'bales' && obstacle !== 'snowmen') this.audio?.cone();
          else if (kind === 'pedestrian') this.audio?.yelp();
          else this.audio?.crash(kind === 'cone' || kind === 'bin' || kind === 'newsbox' ? knock * 0.5 : knock);
        }
      }
      this.keepInsideWorld(car);

      const lap = laps.update(pos.along, this.raceTime);
      const wasRacing = racer.finishTime === null;
      if (lap && this.mode === 'race' && lap.lap === this.settings.laps && wasRacing) {
        racer.finishTime = this.raceTime;
        // Take the player's car over for a cool-down lap.
        if (racer === this.player) racer.driver = new AiDriver(this.track, this.racingLine, COOL_DOWN);
      }
      if (racer === this.player) {
        playerHit = Math.max(playerHit, hit);
        if (lap && wasRacing) {
          if (lap.isBest && this.settings.trackId) saveBestLap(this.settings.trackId, lap.time);
          const event: LapEvent = { ...lap, totalLaps: this.mode === 'race' ? this.settings.laps : null };
          this.events.emit(LAP_EVENT, event);
          if (racer.finishTime !== null) this.audio?.finish();
          else this.audio?.lapChime(lap.isBest);
        }
        const speedAlongTrack = car.vx * Math.cos(pos.heading) + car.vy * Math.sin(pos.heading);
        this.wrongWay.update(speedAlongTrack, PHYSICS_DT);
      }
    }

    for (let a = 0; a < this.racers.length; a++) {
      for (let b = a + 1; b < this.racers.length; b++) {
        const contact: ContactPoint = { x: 0, y: 0 };
        const hit = collideCars(this.racers[a].car, this.racers[b].car, undefined, contact);
        if (hit > SPARK_THRESHOLD) this.effects.sparksAt(contact.x, contact.y, hit);
        if (this.racers[a] === this.player || this.racers[b] === this.player) playerHit = Math.max(playerHit, hit);
      }
    }
    for (const { body } of this.loose) {
      // Most of the street's things are standing still most of the time.
      if (body.vx === 0 && body.vy === 0 && body.spin === 0) continue;
      stepBody(body, PHYSICS_DT);
      collideBodyWithStatic(body, this.barriers);
      if (Math.abs(body.vx) < 0.5 && Math.abs(body.vy) < 0.5 && Math.abs(body.spin) < 0.01) {
        body.vx = 0;
        body.vy = 0;
        body.spin = 0;
      }
    }
    return playerHit;
  }

  /** Saves this race's track under `name`; from then on its best laps are kept. */
  private saveThisTrack(name: string): void {
    const { location, length, track } = this.settings;
    const saved = saveTrack(name, location, length, track);
    if (!saved) return;
    this.settings = { ...this.settings, trackId: saved.id, trackName: saved.name, track: saved.definition };
    const best = this.player.laps.bestLap;
    if (best !== null) saveBestLap(saved.id, best);
  }

  /** Engines, squeal and crashes each frame, and a beep each time a start lamp changes. */
  private updateAudio(hardestHit: number): void {
    if (!this.audio) return;
    if (this.mode === 'race') {
      const lit = this.countdown > 0 ? 4 - Math.ceil(this.countdown) : 4;
      if (lit !== this.lampsLit) {
        this.lampsLit = lit;
        this.audio.startBeep(lit === 4);
      }
    }
    const me = this.player.car;
    const state = (r: Racer): EngineState => ({
      speed: Math.hypot(r.car.vx, r.car.vy),
      throttle: r.input.throttle,
      slide: Math.abs(lateralSpeed(r.car)),
      surface: r.surface,
      dx: r.car.x - me.x,
      dy: r.car.y - me.y,
    });
    this.audio.update([this.player, ...this.racers.filter((r) => r !== this.player)].map(state));
    if (hardestHit > 120) this.audio.crash(hardestHit);
  }

  /** Race: the AI field on the front of the grid and the player at the back. Time trial: just the player. */
  private createRacers(): void {
    // Less grip (a dirt road) means taking corners slower.
    const cornerFactor = DIFFICULTY[this.settings.difficulty].cornerFactor * cornerScale(this.location);
    this.racingLine = buildRacingLine(this.track, { cornerFactor, edgeMargin: DEFAULT_LINE.edgeMargin + (this.location.road.keepOff ?? 0) });
    const make = (name: string, color: number, at: Pose, driver: AiDriver | null, best: number | null): Racer => ({
      name,
      color,
      car: createCar(at.x, at.y, at.heading),
      sprite: this.add.image(at.x, at.y, carTexture(this, color, this.location.car)).setDepth(DEPTH.cars),
      shadow: this.add.image(at.x, at.y, TEX.carShadow).setAlpha(0.3).setDepth(DEPTH.shadows),
      laps: new LapTracker(this.track.length, 12, best),
      driver,
      finishTime: null,
      input: NO_INPUT,
      surface: 'road',
    });
    const { trackId } = this.settings;
    const best = trackId ? loadBestLap(trackId) : (this.settings.bestLap ?? null);
    if (this.mode === 'timeTrial') {
      this.player = make('You', PLAYER_COLOR, poseAt(this.track, -TIME_TRIAL_START), null, best);
      this.racers = [this.player];
      return;
    }
    const drivers = driversFor(this.settings.difficulty, this.settings.opponents);
    const slots = gridSlots(this.track, drivers.length + 1);
    this.racers = drivers.map((profile, i) =>
      make(profile.name, profile.color, slots[i], new AiDriver(this.track, this.racingLine, profile, i), null),
    );
    this.player = make('You', PLAYER_COLOR, slots[drivers.length], null, best);
    this.racers.push(this.player);
  }

  /** The player's position, and once they've finished, the full results. */
  private standings(): Pick<Telemetry, 'position' | 'racers' | 'results'> {
    const order = raceOrder(
      this.racers.map((r) => ({
        finishTime: r.finishTime,
        progress: r.laps.progress(locateOnTrack(this.track, r.car.x, r.car.y).along),
      })),
    );
    const results =
      this.mode === 'race' && this.player.finishTime !== null
        ? order.map((i) => {
            const r = this.racers[i];
            return {
              name: r.name,
              color: r.color,
              isPlayer: r === this.player,
              finishTime: r.finishTime,
              bestLap: r.laps.bestLap,
              lap: r.laps.lap,
            };
          })
        : null;
    return {
      position: order.indexOf(this.racers.indexOf(this.player)) + 1,
      racers: this.racers.length,
      results,
    };
  }

  /**
   * Centres the camera ahead of the car in the direction it's moving, so at
   * speed you can see the road coming up. The lead is capped separately for
   * each axis, so on a short landscape screen it still leads going north/south.
   */
  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    const maxX = (cam.width / cam.zoom) * LOOK_AHEAD_MAX;
    const maxY = (cam.height / cam.zoom) * LOOK_AHEAD_MAX;
    const { car } = this.player;
    const targetX = Phaser.Math.Clamp(car.vx * LOOK_AHEAD_TIME, -maxX, maxX);
    const targetY = Phaser.Math.Clamp(car.vy * LOOK_AHEAD_TIME, -maxY, maxY);
    const k = 1 - Math.exp(-LOOK_AHEAD_RESPONSE * dt);
    this.lookAhead.x += (targetX - this.lookAhead.x) * k;
    this.lookAhead.y += (targetY - this.lookAhead.y) * k;
    cam.centerOn(car.x + this.lookAhead.x, car.y + this.lookAhead.y);
  }

  /** Shows the pulsing gate across the road at a missed checkpoint. */
  private updateGate(): void {
    const { laps } = this.player;
    const missed = laps.missedCheckpoint;
    this.gate.setVisible(missed);
    if (missed && this.gateAlong !== laps.nextCheckpointAlong) {
      this.gateAlong = laps.nextCheckpointAlong;
      drawCheckpointGate(this.gate, this.track, this.gateAlong);
    }
  }

  /** Puts the car back on the centre line nearest to where it is, facing the right way. */
  private resetCar(): void {
    // Not while waiting on the grid, or once the cool-down driver has the car.
    if (this.paused || this.countdown > 0 || this.player.finishTime !== null) return;
    const pos = locateOnTrack(this.track, this.player.car.x, this.player.car.y);
    // Update in place so everything holding this car object sees the reset.
    Object.assign(this.player.car, createCar(pos.x, pos.y, pos.heading));
    this.lookAhead = { x: 0, y: 0 };
  }

  /** Merges keyboard and on-screen touch buttons. */
  private readInput(): CarInput {
    const c = this.controls;
    const touch: Partial<TouchState> = this.registry.get(TOUCH_STATE_KEY) ?? {};
    const held = (keys: Phaser.Input.Keyboard.Key[], touched?: boolean) => touched || keys.some((k) => k.isDown);
    return {
      throttle: held(c.up, touch.up) ? 1 : 0,
      brake: held(c.down, touch.down) ? 1 : 0,
      steer: (held(c.right, touch.right) ? 1 : 0) - (held(c.left, touch.left) ? 1 : 0),
      handbrake: held([c.handbrake], touch.handbrake),
    };
  }

  /** Backstop in case anything ever gets past the barriers. */
  private keepInsideWorld(car: CarState): void {
    const m = CAR_LENGTH / 2;
    const { left, right, top, bottom } = this.world;
    if (car.x < left + m || car.x > right - m) {
      car.x = Phaser.Math.Clamp(car.x, left + m, right - m);
      car.vx *= -0.3;
    }
    if (car.y < top + m || car.y > bottom - m) {
      car.y = Phaser.Math.Clamp(car.y, top + m, bottom - m);
      car.vy *= -0.3;
    }
  }

  /**
   * Solid barriers along the track edges (never on the road) and other solid
   * things off it, and loose things to knock about: cones (or bales) at the
   * corners, and the road obstacles.
   */
  private createBarriersAndCones(tyres: Vec2[], solids: Circle[]): void {
    this.barriers = new CircleGrid([...tyres.map((t) => ({ ...t, r: TYRE_RADIUS })), ...solids]);
    const rng = new Phaser.Math.RandomDataGenerator([this.track.name, 'tyres']);
    const { barrier, obstacle } = this.location;
    for (const t of tyres) {
      let image: Phaser.GameObjects.Image;
      if (barrier === 'concrete') {
        // Concrete blocks laid end to end along the road.
        const variant = rng.frac() < 0.15 ? 2 : rng.between(0, 1);
        const heading = locateOnTrack(this.track, t.x, t.y).heading;
        image = this.add.image(t.x, t.y, DECO_TEXTURE, `jersey-${variant}`).setRotation(heading);
        const shadow = this.add.image(t.x + 3, t.y + 4, DECO_TEXTURE, `jersey-${variant}`).setRotation(heading).setTint(0x000000).setAlpha(0.3);
        this.decorations.chunks.add(shadow, DEPTH.propShadows);
      } else if (barrier === 'bollards') {
        // Bollards along the back of the pavement; across a side street, concrete blocks closing it off.
        const closed = this.decoration.downtown?.city.streets.some((st) => !st.onTrack && inRect(streetRect(st), t.x, t.y));
        if (closed) {
          // Laid along the barrier: from the bollard before to the one after.
          const k = tyres.indexOf(t);
          const prev = tyres[k - 1] ?? t;
          const next = tyres[k + 1] ?? t;
          const heading = Math.atan2(next.y - prev.y, next.x - prev.x);
          image = this.add.image(t.x, t.y, DECO_TEXTURE, `jersey-${rng.between(0, 2)}`).setRotation(heading);
          const shadow = this.add.image(t.x + 3, t.y + 4, DECO_TEXTURE, image.frame.name).setRotation(heading).setTint(0x000000).setAlpha(0.3);
          this.decorations.chunks.add(shadow, DEPTH.propShadows);
        } else {
          image = this.add.image(t.x, t.y, DECO_TEXTURE, 'bollard');
          const shadow = this.add.image(t.x + 2, t.y + 3, DECO_TEXTURE, 'bollard').setTint(0x000000).setAlpha(0.3);
          this.decorations.chunks.add(shadow, DEPTH.propShadows);
        }
      } else if (barrier === 'snowbanks') {
        // Snow ploughed into banks, with snowy rocks where the barrier crosses frozen water.
        const wet = inWater(this.decoration.water, t.x, t.y, 4);
        image = this.add
          .image(t.x, t.y, DECO_TEXTURE, `${wet ? 'snowrock' : 'snowbank'}-${rng.between(0, WINTER_VARIANTS.bank - 1)}`)
          .setDisplaySize(TYRE_RADIUS * 2.3, TYRE_RADIUS * 2.3)
          .setAngle(rng.angle());
      } else if (barrier === 'redrocks') {
        // Red sandstone boulders along the desert track.
        image = this.add
          .image(t.x, t.y, DECO_TEXTURE, `redrock-${rng.between(0, DESERT_VARIANTS.rock - 1)}`)
          .setDisplaySize(TYRE_RADIUS * 2.3, TYRE_RADIUS * 2.3)
          .setAngle(rng.angle());
      } else if (barrier === 'logs') {
        // Log ends along the woods, with boulders where the barrier crosses water.
        const wet = inWater(this.decoration.water, t.x, t.y, 4);
        image = this.add
          .image(t.x, t.y, DECO_TEXTURE, `${wet ? 'rock' : 'logend'}-${rng.between(0, WOODS_VARIANTS.logend - 1)}`)
          .setDisplaySize(TYRE_RADIUS * 2, TYRE_RADIUS * 2)
          .setAngle(rng.angle());
      } else {
        image = this.add.image(t.x, t.y, CIRCUIT_TEX.tyres).setDisplaySize(TYRE_RADIUS * 2, TYRE_RADIUS * 2).setAngle(rng.angle());
      }
      this.decorations.chunks.add(image, DEPTH.props);
    }
    // The light loose things (cones or small bales) and the heavy ones (tyres, oil drums or round bales).
    const looseImage = (at: Vec2, cone: boolean): Phaser.GameObjects.Image => {
      if (obstacle === 'bales') return this.add.image(at.x, at.y, DECO_TEXTURE, cone ? 'bale' : 'roundbale');
      if (obstacle === 'tumbleweeds') return this.add.image(at.x, at.y, DECO_TEXTURE, cone ? `tumbleweed-${rng.between(0, DESERT_VARIANTS.tumbleweed - 1)}` : 'woodbarrel');
      if (obstacle === 'snowmen') return this.add.image(at.x, at.y, DECO_TEXTURE, cone ? 'snowman' : 'iceblock');
      if (cone) return this.add.image(at.x, at.y, TEX.cone);
      if (obstacle === 'barrels') return this.add.image(at.x, at.y, DECO_TEXTURE, 'barrel');
      return obstacle === 'drums' ? this.add.image(at.x, at.y, DECO_TEXTURE, `drum-${rng.between(0, 2)}`) : this.add.image(at.x, at.y, CIRCUIT_TEX.tyres);
    };
    // Knocked things stay where they land until the race ends; each race starts with them back in place.
    const obstacles = obstaclePieces(this.track);
    const make = (at: Vec2, kind: Loose['kind']): Loose => {
      const cone = kind === 'cone';
      return {
        kind,
        body: {
          ...at,
          r: cone ? CONE_RADIUS : TYRE_RADIUS,
          vx: 0,
          vy: 0,
          invMass: cone ? CONE_INV_MASS : LOOSE_TYRE_INV_MASS,
          angle: rng.angle(),
          spin: 0,
        },
        sprite: looseImage(at, cone)
          .setDisplaySize(cone ? CONE_RADIUS * 2 : TYRE_RADIUS * 2, cone ? CONE_RADIUS * 2 : TYRE_RADIUS * 2)
          .setDepth(DEPTH.props),
      };
    };
    // Cones on the inside of the tightest corners (not in town, where the corners are junctions).
    const cornerCones = this.location.decoration.city ? [] : placeCones(this.track, tyres);
    this.loose = [
      ...[...cornerCones, ...obstacles.cones].map((at) => make(at, 'cone')),
      ...obstacles.tyres.map((at) => make(at, 'tyre')),
    ];
    const downtown = this.decoration.downtown;
    if (downtown) {
      this.street = new StreetScenery(this, downtown, DEPTH.props, () => this.audio?.alarm());
      this.loose.push(...this.street.loose);
    }
  }
}
