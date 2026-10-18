import * as Phaser from 'phaser';
import type { Location } from '../locations/locations';
import { CircuitScenery } from '../circuit/CircuitScenery';
import { CIRCUIT_PROPS } from '../circuit/style';
import type { Decoration, Prop } from '../track/decoration';
import type { Track, Vec2 } from '../track/Track';
import { ChunkLayers } from './ChunkLayers';
import { CloudShadows } from './CloudShadows';
import { DECO_TEXTURE, createDecorationTexture } from './decorationArt';
import { ForestryScenery } from './ForestryScenery';
import { CityScenery } from '../downtown/CityScenery';
import { CITY_PROPS } from '../downtown/style';
import { WinterScenery } from '../winter/WinterScenery';
import { WINTER_PROPS } from '../winter/style';
import { DesertScenery } from '../desert/DesertScenery';
import { DESERT_PROPS } from '../desert/style';
import { PortScenery } from './PortScenery';
import { WoodsScenery } from './WoodsScenery';
import { LAMP_POST } from './portArt';
import { FIRE_FRAMES } from './woodsArt';

export interface DecorationDepths {
  /** Water (and a circuit's gravel traps), under the road. */
  ground: number;
  /** Fords, bridges, mud and puddles: on top of the road, under the tyre marks. */
  overRoad: number;
  /** Ripples flowing along the water. */
  ripples: number;
  /** A circuit's start gantry's shadow on the road. */
  roadShadow: number;
  /** Shadows of the props. */
  shadows: number;
  props: number;
  /** Things higher than the cars: tree tops, lamps, cranes, a circuit's start gantry. */
  overhead: number;
  /** Falling leaves and birds, above everything in the world. */
  sky: number;
}

/** How tall each kind of prop is, as how far its shadow falls (px). */
const SHADOW_LENGTH: Partial<Record<Prop['kind'], number>> = {
  shed: 7,
  truck: 4,
  container: 4,
  tree: 10,
  canopy: 14,
  logs: 3,
  cabin: 8,
  logstack: 4,
  tent: 3,
  camper: 4,
  tank: 6,
  lamp: 12,
  crates: 3,
  reels: 2,
  drums: 2,
  portacabin: 5,
  coils: 2,
  van: 3,
};
/** Light from the top left, as for the cars. */
export const SHADOW_DIR = { x: 0.62, y: 0.78 };
/** Deer bolt when a car comes this close (px). */
const DEER_FRIGHT = 330;
const DEER_SPEED = 200;

/** Something that flickers all the time: campfires. */
interface Waver {
  image: Phaser.GameObjects.Image;
  frame: string;
  frames: number;
  period: number;
  phase: number;
}

/** A deer grazing in a clearing, until a car comes past and it bolts into the trees. */
interface Deer {
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  /** Which way is away from the road. */
  away: number;
  state: 'grazing' | 'fleeing' | 'gone';
  /** Seconds since it started running. */
  running: number;
  heading: number;
  phase: number;
}

/**
 * Draws a track's scenery and brings it to life: deer that bolt and
 * campfires flickering, the woods' water, leaves and birds (WoodsScenery),
 * forestry at work (ForestryScenery), a downtown (CityScenery), winter (WinterScenery),
 * the desert (DesertScenery),
 * the life of the docks (PortScenery), a race circuit's crowds and gantry
 * (CircuitScenery), and cloud shadows over everything.
 */
export class Decorations {
  private readonly wavers: Waver[] = [];
  private readonly deer: Deer[] = [];
  private readonly rng: Phaser.Math.RandomDataGenerator;
  /** Everything that doesn't move, by area, so only what's near the camera is drawn. */
  readonly chunks: ChunkLayers;
  private readonly woods: WoodsScenery | null = null;
  private readonly port: PortScenery | null = null;
  private readonly clouds: CloudShadows | null = null;
  private readonly circuit: CircuitScenery | null = null;
  private readonly forestry: ForestryScenery | null = null;
  private readonly city: CityScenery | null = null;
  /** Winter: the trees under snow, and chalets for cabins. */
  private readonly snowy: boolean;
  private readonly winter: WinterScenery | null = null;
  private readonly desert: DesertScenery | null = null;
  /** What grazes in the clearings, and bolts: deer, or in the desert a herd of wild horses. */
  private readonly herd: 'deer' | 'horse';

  constructor(
    private readonly scene: Phaser.Scene,
    track: Track,
    deco: Decoration,
    location: Location,
    private readonly depths: DecorationDepths,
  ) {
    createDecorationTexture(scene);
    this.chunks = new ChunkLayers(scene);
    this.rng = new Phaser.Math.RandomDataGenerator([`${track.length}`, 'decoration']);
    const style = location.decoration;
    this.snowy = style.winter;
    this.herd = style.desert ? 'horse' : 'deer';
    if (deco.water.length > 0 || deco.patches.length > 0 || style.wildlife) {
      this.woods = new WoodsScenery(scene, track, deco, style.wildlife, depths, this.chunks, style.winter, style.desert);
    }
    if (deco.worksites.length > 0 || deco.props.some((p) => p.kind === 'fellers')) {
      const woods = this.woods;
      this.forestry = new ForestryScenery(scene, deco.worksites, depths, this.chunks, (x, y) => woods?.addSmoke(x, y));
    }
    if (style.winter) this.winter = new WinterScenery(scene, depths, this.chunks);
    if (style.desert) this.desert = new DesertScenery(scene, track, depths, this.chunks);
    if (deco.downtown) this.city = new CityScenery(scene, track, deco.downtown, depths, this.chunks);
    if (deco.port) this.port = new PortScenery(scene, track, deco, depths, this.chunks);
    if (deco.circuit && location.circuit) {
      this.circuit = new CircuitScenery(scene, track, deco.circuit, location, depths, this.chunks, deco.movers);
    }
    for (const prop of deco.props) {
      if (CIRCUIT_PROPS.has(prop.kind)) this.circuit?.addProp(prop);
      else if (CITY_PROPS.has(prop.kind)) this.city?.addProp(prop);
      else if (WINTER_PROPS.has(prop.kind)) this.winter?.addProp(prop);
      else if (DESERT_PROPS.has(prop.kind)) this.desert?.addProp(prop);
      else this.addProp(prop);
    }
    if (style.clouds) this.clouds = new CloudShadows(scene, depths.sky - 0.5, this.rng);
  }

  /** Call once a frame with where the cars are. */
  update(time: number, dt: number, cars: Vec2[], camera: Phaser.Cameras.Scene2D.Camera): void {
    this.chunks.update(camera);
    for (const w of this.wavers) {
      setFrame(w.image, `${w.frame}-${Math.floor(time / w.period + w.phase) % w.frames}`);
    }
    for (const d of this.deer) this.updateDeer(d, time, dt, cars);
    this.woods?.update(time, dt, camera);
    this.port?.update(time, dt, cars, camera);
    this.forestry?.update(time, dt, camera);
    this.city?.update(time, dt, cars, camera);
    this.winter?.update(time, dt, camera);
    this.desert?.update(time, dt, camera);
    this.circuit?.update(time, dt, cars);
    this.clouds?.update(dt, camera.worldView);
  }

  private updateDeer(d: Deer, time: number, dt: number, cars: Vec2[]): void {
    if (d.state === 'gone') return;
    const { image, shadow } = d;
    if (d.state === 'grazing') {
      // Mostly head down, looking up now and then.
      setFrame(image, `${this.herd}-${Math.sin(time / 1300 + d.phase * 5) > 0.55 ? 'alert' : 'graze'}`);
      if (cars.some((c) => Math.abs(c.x - image.x) < DEER_FRIGHT && Math.abs(c.y - image.y) < DEER_FRIGHT)) {
        d.state = 'fleeing';
        d.heading = d.away + this.rng.realInRange(-0.5, 0.5);
        image.setRotation(d.heading);
        shadow.setRotation(d.heading);
      }
      return;
    }
    // Bounding off into the trees, fading out once it's under them.
    d.running += dt;
    const step = DEER_SPEED * dt;
    image.x += Math.cos(d.heading) * step;
    image.y += Math.sin(d.heading) * step;
    shadow.setPosition(image.x + SHADOW_DIR.x * 3, image.y + SHADOW_DIR.y * 3);
    setFrame(image, `${this.herd}-run-${Math.floor(time / 90 + d.phase * 2) % 2}`);
    shadow.setFrame(image.frame.name, false, false);
    const alpha = Phaser.Math.Clamp(2 - d.running * 1.5, 0, 1);
    image.setAlpha(alpha);
    shadow.setAlpha(alpha * 0.28);
    if (alpha === 0) {
      d.state = 'gone';
      image.setVisible(false);
      shadow.setVisible(false);
    }
  }

  private addProp(prop: Prop): void {
    const { kind, variant } = prop;
    const shadow = SHADOW_LENGTH[kind];
    const overhead = kind === 'tree' || kind === 'canopy';
    const depth = overhead ? this.depths.overhead : this.depths.props;
    const image = (frame: string, u = 0, v = 0, w?: number, h?: number) => {
      const at = this.local(prop, u, v);
      const img = this.scene.add.image(at.x, at.y, DECO_TEXTURE, frame).setRotation(prop.angle);
      if (w !== undefined && h !== undefined) img.setDisplaySize(w, h);
      return this.chunks.add(img, depth);
    };
    const castShadow = (img: Phaser.GameObjects.Image) => {
      if (!shadow) return;
      const s = this.scene.add
        .image(img.x + SHADOW_DIR.x * shadow, img.y + SHADOW_DIR.y * shadow, DECO_TEXTURE, img.frame.name)
        .setDisplaySize(img.displayWidth, img.displayHeight)
        .setRotation(img.rotation)
        .setOrigin(img.originX, img.originY)
        .setTint(0x000000)
        .setAlpha(0.28);
      this.chunks.add(s, this.depths.shadows);
    };

    switch (kind) {
      case 'tree': {
        // The art's canopy fills about 58 of its 64 px.
        // (In the snow, a snowy pine: its art fills about 120 of its 128 px.)
        const tree = this.snowy
          ? image(`snowpine-${variant + 3}`, 0, 0, (prop.w * 128) / 120, (prop.h * 128) / 120).setRotation(this.rng.angle())
          : image(`tree-${variant}`, 0, 0, (prop.w * 64) / 58, (prop.h * 64) / 58).setRotation(this.rng.angle());
        castShadow(tree);
        break;
      }
      case 'canopy': {
        // The art fills about 120 of its 128 px.
        castShadow(image(`${this.snowy ? 'snowpine' : 'canopy'}-${variant}`, 0, 0, (prop.w * 128) / 120, (prop.h * 128) / 120));
        break;
      }
      case 'campfire': {
        const fire = image('campfire-0');
        this.wavers.push({ image: fire, frame: 'campfire', frames: FIRE_FRAMES, period: 110, phase: this.rng.frac() * 3 });
        this.woods?.addSmoke(fire.x, fire.y);
        break;
      }
      case 'deer': {
        // Out in the open at the front of its clearing, nearer the road (wild horses in a little herd).
        const count = this.herd === 'horse' ? this.rng.between(3, 5) : 1;
        for (let k = 0; k < count; k++) {
          const at = this.local(prop, k === 0 ? 0 : this.rng.realInRange(-0.4, 0.4) * prop.w, -prop.h * 0.15 + (k === 0 ? 0 : this.rng.realInRange(-0.2, 0.3) * prop.h));
          const heading = this.rng.angle();
          const frame = `${this.herd}-graze`;
          const deer = this.scene.add.image(at.x, at.y, DECO_TEXTURE, frame).setRotation(heading).setScale(1.5).setDepth(this.depths.props);
          const s = this.scene.add
            .image(at.x + SHADOW_DIR.x * 3, at.y + SHADOW_DIR.y * 3, DECO_TEXTURE, frame)
            .setRotation(heading)
            .setScale(1.5)
            .setTint(0x000000)
            .setAlpha(0.28)
            .setDepth(this.depths.shadows);
          // Local +y of the prop points away from the road.
          this.deer.push({ image: deer, shadow: s, away: prop.angle + Math.PI / 2, state: 'grazing', running: 0, heading, phase: this.rng.frac() });
        }
        break;
      }
      case 'lamp': {
        // The post stands on the prop; the arm reaches out towards the road, over the cars.
        const at = this.local(prop, 0, -(LAMP_POST - 23));
        const lamp = this.scene.add.image(at.x, at.y, DECO_TEXTURE, 'lamp').setRotation(prop.angle);
        this.chunks.add(lamp, this.depths.overhead);
        castShadow(lamp);
        break;
      }
      case 'tank':
        // Round, so any way round will do.
        castShadow(image(`tank-${variant}`, 0, 0, prop.w, prop.h).setRotation(this.rng.frac() * Math.PI * 2));
        break;
      case 'road':
      case 'rail':
      case 'ship':
      case 'boat':
      case 'pontoon':
      case 'crane':
      case 'gulls':
      case 'workers':
        this.port?.addProp(prop);
        break;
      case 'path':
      case 'worksite':
      case 'trail':
        // Just keeps the way clear (forestry worksites are drawn whole, with their tracks).
        break;
      case 'fellers':
        this.forestry?.addFellers(prop);
        break;
      case 'cabin':
        if (this.snowy) {
          // A chalet, smoke rising from its chimney.
          castShadow(image(`chalet-${variant}`, 0, 0, prop.w, prop.h));
          const chimney = this.local(prop, prop.w / 2 - 19, 13);
          this.woods?.addSmoke(chimney.x, chimney.y);
        } else castShadow(image(`cabin-${variant}`, 0, 0, prop.w, prop.h));
        break;
      default:
        castShadow(image(`${kind}-${variant}`, 0, 0, prop.w, prop.h));
        break;
    }
  }

  /** A point on a prop, `u` px along it and `v` px back from its centre. */
  private local(prop: Prop, u: number, v: number): Vec2 {
    const c = Math.cos(prop.angle);
    const s = Math.sin(prop.angle);
    return { x: prop.x + c * u - s * v, y: prop.y + s * u + c * v };
  }

}

function setFrame(image: Phaser.GameObjects.Image, frame: string): void {
  if (image.frame.name !== frame) image.setFrame(frame, false, false);
}
