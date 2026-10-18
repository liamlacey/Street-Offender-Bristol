import * as Phaser from 'phaser';
import type { Body } from '../physics/collisions';
import { mulberry32 } from '../track/generate';
import { DECO_TEXTURE } from '../scenes/decorationArt';
import { PEOPLE } from './art';
import type { Downtown } from './plan';
import { FURNITURE, type FurnitureKind, type Oncoming, PARKED_CAR, type Pedestrian, pedestrian, stepPedestrian } from './street';

/** Kinds of loose thing on a city street, for the race's sounds. */
export type StreetThing = 'parked' | 'pedestrian' | FurnitureKind;

/** Something loose on the street: its body, how it looks, and what it is. */
export interface StreetLoose {
  body: Body;
  sprite: Phaser.GameObjects.Image;
  kind: StreetThing;
}

/** A hydrant knocked this far off its spot (px) gushes water from where it stood. */
const BROKEN = 6;
/** How long a knocked parked car flashes its hazard lights, s. */
const HAZARDS = 12;
/** Where the shadows of parked cars fall. */
const SHADOW = { x: 2.5, y: 3 };
/** People are drawn this much bigger than their frames. */
const PERSON_SCALE = 1.7;

interface Parked {
  body: Body;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  home: { x: number; y: number; angle: number };
  /** Race time (s) its hazards stop flashing, once it's been knocked. */
  hazardsUntil: number;
}

interface Hydrant {
  body: Body;
  home: { x: number; y: number };
  broken: boolean;
}

interface Person {
  p: Pedestrian;
  sprite: Phaser.GameObjects.Image;
  look: number;
}

/**
 * The loose life of the streets the race goes down: parked cars (their
 * hazards flash once they've been shunted), people walking and crossing at
 * the lights, who jump out of the way and if knocked over lie there a moment
 * before getting up and going on, and hydrants that gush water once
 * knocked off their spot. The race moves and collides their bodies; this
 * steers the people and keeps the pictures up to date.
 */
export class StreetScenery {
  readonly loose: StreetLoose[] = [];
  private readonly parked: Parked[] = [];
  private readonly people: Person[] = [];
  private readonly hydrants: Hydrant[] = [];
  private readonly water: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly rng: () => number;
  private waterDue = 0;

  constructor(
    scene: Phaser.Scene,
    downtown: Downtown,
    depth: number,
    private readonly onAlarm: () => void,
  ) {
    const { street } = downtown;
    this.rng = mulberry32(street.parked.length * 31 + street.walks.length);
    const look = () => Math.floor(this.rng() * PEOPLE);

    for (const spot of street.parked) {
      const frame = `parked-${Math.floor(this.rng() * 12)}`;
      const body: Body = {
        x: spot.x,
        y: spot.y,
        r: PARKED_CAR.width / 2,
        length: PARKED_CAR.length,
        vx: 0,
        vy: 0,
        invMass: PARKED_CAR.invMass,
        angle: spot.heading,
        spin: 0,
        damping: PARKED_CAR.damping,
      };
      const shadow = scene.add.image(spot.x, spot.y, DECO_TEXTURE, frame).setTint(0x000000).setAlpha(0.3).setDepth(depth - 0.1);
      const sprite = scene.add.image(spot.x, spot.y, DECO_TEXTURE, frame).setDepth(depth);
      this.parked.push({ body, sprite, shadow, home: { x: spot.x, y: spot.y, angle: spot.heading }, hazardsUntil: -1 });
      this.loose.push({ body, sprite, kind: 'parked' });
    }

    for (const f of street.furniture) {
      const { r, invMass, damping } = FURNITURE[f.kind];
      const body: Body = { x: f.x, y: f.y, r, vx: 0, vy: 0, invMass, angle: this.rng() * Math.PI * 2, spin: 0, damping };
      const sprite = scene.add.image(f.x, f.y, DECO_TEXTURE, f.kind).setDepth(depth);
      this.loose.push({ body, sprite, kind: f.kind });
      if (f.kind === 'hydrant') this.hydrants.push({ body, home: { x: f.x, y: f.y }, broken: false });
    }

    const person = (p: Pedestrian) => {
      const v = look();
      const sprite = scene.add.image(p.body.x, p.body.y, DECO_TEXTURE, `fan-${v}-s`).setScale(PERSON_SCALE).setDepth(depth + 0.02);
      this.people.push({ p, sprite, look: v });
      this.loose.push({ body: p.body, sprite, kind: 'pedestrian' });
    };
    for (const w of street.walks) person(pedestrian(w.a, w.b, null, this.rng));
    for (const c of street.crossings) {
      // A few people waiting at each crossing, either side.
      const count = Math.floor(this.rng() * 3);
      for (let k = 0; k < count; k++) {
        const [a, b] = this.rng() < 0.5 ? [c.a, c.b] : [c.b, c.a];
        const p = pedestrian(a, b, c.junction, this.rng);
        // Side by side along the kerb, not all on one spot.
        const nudge = (k - 1) * 12;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        p.a = { x: a.x - (dy / len) * nudge, y: a.y + (dx / len) * nudge };
        p.b = { x: b.x - (dy / len) * nudge, y: b.y + (dx / len) * nudge };
        p.body.x = p.a.x;
        p.body.y = p.a.y;
        p.dir = 1;
        person(p);
      }
    }

    this.water = scene.add
      .particles(0, 0, DECO_TEXTURE, {
        frame: 'drop',
        lifespan: { min: 500, max: 900 },
        speed: { min: 30, max: 110 },
        scale: { start: 1, end: 2.2 },
        alpha: { start: 0.9, end: 0 },
        emitting: false,
      })
      .setDepth(depth + 0.05);
  }

  /** One physics step: everyone on foot decides where to go. `time` is the lights' clock, s. */
  step(dt: number, time: number, cars: Oncoming[]): void {
    for (const { p } of this.people) stepPedestrian(p, dt, time, cars, this.rng);
  }

  /** Each frame, after the race has moved everything: people's poses, hazard lights, gushing hydrants. */
  draw(time: number, dt: number, raceTime: number, view: Phaser.Geom.Rectangle): void {
    const near = (x: number, y: number, margin = 80) =>
      x > view.left - margin && x < view.right + margin && y > view.top - margin && y < view.bottom + margin;

    for (const { p, sprite, look } of this.people) {
      const { body } = p;
      const show = near(body.x, body.y);
      if (sprite.visible !== show) sprite.setVisible(show);
      if (!show) continue;
      if (p.state === 'down') {
        setFrame(sprite, `down-${look}`);
        sprite.setRotation(body.angle);
        continue;
      }
      const moving = Math.hypot(body.vx, body.vy) > 5;
      setFrame(sprite, moving ? `fan-${look}-${Math.floor(time / (p.state === 'dodge' ? 90 : 230)) % 2}` : `fan-${look}-s`);
      sprite.setRotation(p.heading);
      // Keep their body's angle where they face, so a knock sends them tumbling from there.
      body.angle = p.heading;
    }

    for (const car of this.parked) {
      const { body, sprite, shadow, home } = car;
      const show = near(body.x, body.y);
      if (sprite.visible !== show) {
        sprite.setVisible(show);
        shadow.setVisible(show);
      }
      if (car.hazardsUntil < 0 && (Math.hypot(body.x - home.x, body.y - home.y) > 3 || Math.abs(body.angle - home.angle) > 0.05)) {
        car.hazardsUntil = raceTime + HAZARDS;
        if (show) this.onAlarm();
      }
      if (!show) continue;
      shadow.setPosition(body.x + SHADOW.x, body.y + SHADOW.y).setRotation(body.angle);
      const flashing = raceTime < car.hazardsUntil && Math.floor(time / 380) % 2 === 0;
      if (flashing) sprite.setTint(0xffc65a);
      else sprite.clearTint();
    }

    this.waterDue -= dt;
    const gush = this.waterDue <= 0;
    if (gush) this.waterDue = 0.03;
    for (const h of this.hydrants) {
      if (!h.broken && Math.hypot(h.body.x - h.home.x, h.body.y - h.home.y) > BROKEN) h.broken = true;
      // A fountain from the broken main, for the rest of the race.
      if (h.broken && gush && near(h.home.x, h.home.y, 60)) this.water.emitParticleAt(h.home.x, h.home.y, 3);
    }
  }
}

function setFrame(image: Phaser.GameObjects.Image, frame: string): void {
  if (image.frame.name !== frame) image.setFrame(frame, false, false);
}
