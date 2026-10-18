/**
 * What happens to the things on the island when they're shot at, by what
 * they're made of:
 *
 * - stone cracks, then crumbles to rubble;
 * - trees split and come down, catch fire, and burn to ash (and the fire
 *   spreads to the trees round them);
 * - buildings are holed, then collapse into rubble and burn, leaving a
 *   blackened ruin;
 * - vehicles explode (setting off what's round them) and burn out as wrecks;
 * - fuel barrels and tanks go up in a big blast;
 * - straw goes up in flames and burns to ash, and the fire runs on through
 *   fields of crops and long grass (a wildfire, into the woods beyond);
 * - fences and crates splinter;
 * - bridges crack, then fall into the river (wooden ones burn too).
 *
 * The tank can also drive into things and smash them: trees go down (no
 * fire), rock crumbles, buildings collapse, vehicles go up, and burnt-out
 * wrecks are flattened.
 *
 * Pure logic: it reports what happened as events, and TankScene shows them.
 */

import { KINDS, type KindDef, type ThingSpec } from './kinds';

/** Standing, hurt (cracked, holed, dented), wrecked (rubble, a fallen tree, a burnt-out shell, ash) or gone. */
export type Phase = 'intact' | 'damaged' | 'wrecked' | 'gone';

export interface Thing extends ThingSpec {
  id: number;
  def: KindDef;
  hp: number;
  phase: Phase;
  /** Seconds of burning left (0: not alight). */
  fire: number;
  /** Has burnt out (ash, a blackened ruin or a charred wreck). */
  burnt: boolean;
  /** Flattened by the tank (and so can't burn). */
  flattened: boolean;
}

export type WorldEvent =
  | { type: 'damaged'; thing: Thing }
  | { type: 'crumble'; thing: Thing }
  | { type: 'split'; thing: Thing }
  | { type: 'collapse'; thing: Thing }
  | { type: 'splinter'; thing: Thing }
  | { type: 'ignite'; thing: Thing }
  | { type: 'burntOut'; thing: Thing }
  | { type: 'explode'; thing: Thing | null; x: number; y: number; radius: number; power: number };

/** How long after being hit a vehicle or fuel goes up, s (so chain reactions ripple outwards). */
const FUSE = { metal: 0.25, fuel: 0.12 };
/** Most things alight at once (a whole forest burning would be too much for a phone). */
export const MAX_FIRES = 140;
/** How often a fire tries to spread, s; how far, px (beyond the two things' edges); and how likely, each try. */
const SPREAD_EVERY = 0.5;
const SPREAD_REACH = 26;
const SPREAD_CHANCE = { plant: 0.16, straw: 0.3, building: 0.08 };
const GRID = 128;

export class World {
  readonly things: Thing[];
  private readonly cells = new Map<number, Thing[]>();
  private readonly burning = new Set<Thing>();
  private readonly fuses: { thing: Thing; t: number }[] = [];
  private spreadDue = SPREAD_EVERY;
  /** How many things have been wrecked or destroyed. */
  destroyed = 0;

  constructor(
    specs: ThingSpec[],
    private readonly rand: () => number = Math.random,
  ) {
    this.things = specs.map((s, id) => {
      const def = KINDS[s.kind];
      return { ...s, id, def, hp: def.hp, phase: 'intact', fire: 0, burnt: false, flattened: false };
    });
    for (const t of this.things) {
      const key = cellKey(Math.floor(t.x / GRID), Math.floor(t.y / GRID));
      const list = this.cells.get(key);
      if (list) list.push(t);
      else this.cells.set(key, [t]);
    }
  }

  /** Puts something new into the world (a police car arriving), and returns it. */
  add(spec: ThingSpec): Thing {
    const def = KINDS[spec.kind];
    const t: Thing = { ...spec, id: this.things.length, def, hp: def.hp, phase: 'intact', fire: 0, burnt: false, flattened: false };
    this.things.push(t);
    const key = cellKey(Math.floor(t.x / GRID), Math.floor(t.y / GRID));
    const list = this.cells.get(key);
    if (list) list.push(t);
    else this.cells.set(key, [t]);
    return t;
  }

  /** Moves something (a vehicle driving along), keeping the lookup grid right. */
  move(t: Thing, x: number, y: number): void {
    const from = cellKey(Math.floor(t.x / GRID), Math.floor(t.y / GRID));
    const to = cellKey(Math.floor(x / GRID), Math.floor(y / GRID));
    t.x = x;
    t.y = y;
    if (from === to) return;
    const list = this.cells.get(from);
    if (list) list.splice(list.indexOf(t), 1);
    const next = this.cells.get(to);
    if (next) next.push(t);
    else this.cells.set(to, [t]);
  }

  /** Things whose middles are within `reach` px of a point (plus the biggest thing's size). */
  near(x: number, y: number, reach: number): Thing[] {
    const found: Thing[] = [];
    const r = reach + 60;
    for (let gx = Math.floor((x - r) / GRID); gx <= Math.floor((x + r) / GRID); gx++) {
      for (let gy = Math.floor((y - r) / GRID); gy <= Math.floor((y + r) / GRID); gy++) {
        for (const t of this.cells.get(cellKey(gx, gy)) ?? []) if (t.phase !== 'gone') found.push(t);
      }
    }
    return found;
  }

  /** Whether it stops the tank. */
  static blocks(t: Thing): boolean {
    if (t.phase === 'intact' || t.phase === 'damaged') return t.def.solid;
    return t.phase === 'wrecked' && !!t.def.wreckSolid;
  }

  /** Whether a rocket flying past hits it. */
  static target(t: Thing): boolean {
    if (t.phase === 'intact' || t.phase === 'damaged') return !t.def.low;
    return t.phase === 'wrecked' && !!t.def.wreckSolid;
  }

  /** Whether the tank flattens it by driving over it. */
  static crushable(t: Thing): boolean {
    return (t.phase === 'intact' || t.phase === 'damaged') && !t.def.solid && t.def.material !== 'bridge';
  }

  /** A blast: everything within `radius` px takes damage, more the nearer the middle; `direct` (what a rocket struck) takes it all. */
  blast(x: number, y: number, radius: number, power: number, direct: Thing | null = null): WorldEvent[] {
    const events: WorldEvent[] = [{ type: 'explode', thing: null, x, y, radius, power }];
    for (const t of this.near(x, y, radius)) {
      const d = Math.max(0, Math.hypot(t.x - x, t.y - y) - t.def.r);
      if (d > radius && t !== direct) continue;
      const share = t === direct ? 1 : 1 - d / radius;
      this.hit(t, power * share, events);
      // The heat sets light to what's close in, even if it doesn't bring it down.
      if (share > 0.5 && t.def.burns > 0 && this.rand() < share * 0.6) this.ignite(t, events);
    }
    return events;
  }

  /** The tank rolling over something small: it's flattened (no fire, except fuel, which goes up). */
  crush(t: Thing): WorldEvent[] {
    const events: WorldEvent[] = [];
    this.hit(t, t.def.hp + 1, events, 'crush');
    return events;
  }

  /** A crop cut by the combine harvester: flattened (and so it won't burn), but not by the player, so it doesn't count. */
  harvest(t: Thing): WorldEvent[] {
    if (t.phase !== 'intact') return [];
    t.phase = 'wrecked';
    t.burnt = true;
    t.flattened = true;
    return [{ type: 'split', thing: t }];
  }

  /** The tank driving into something and grinding on into it, `damage` worth. A wreck in its way is flattened. */
  ram(t: Thing, damage: number): WorldEvent[] {
    const events: WorldEvent[] = [];
    if (t.phase === 'wrecked' && t.def.wreckSolid) {
      t.phase = 'gone';
      events.push({ type: 'splinter', thing: t });
    } else this.hit(t, damage, events, 'ram');
    return events;
  }

  /** Damage to one thing, and what it does about it (`cause`: a blast, or the tank flattening or ramming it). */
  hit(t: Thing, damage: number, events: WorldEvent[], cause: 'blast' | 'crush' | 'ram' = 'blast'): void {
    if (damage <= 0 || (t.phase !== 'intact' && t.phase !== 'damaged')) return;
    const crushed = cause === 'crush';
    const rammed = cause === 'ram';
    t.hp -= damage;
    const { material } = t.def;
    const down = t.hp <= 0;
    if (!down) {
      // Hurt but standing: rock cracks, buildings are holed (and may catch), vehicles dented and smoking.
      if (t.phase === 'intact' && t.hp < t.def.hp * 0.5 && (material === 'stone' || material === 'building' || material === 'metal' || material === 'bridge')) {
        t.phase = 'damaged';
        events.push({ type: 'damaged', thing: t });
        if (material === 'building' && !rammed && this.rand() < 0.5) this.ignite(t, events);
      }
      return;
    }
    this.destroyed++;
    if (crushed && material !== 'fuel') {
      // Flattened: a bush or a haystack squashed, a fence or crate in splinters.
      t.phase = material === 'wood' ? 'gone' : 'wrecked';
      t.burnt = material === 'plant' || material === 'straw';
      t.flattened = true;
      events.push({ type: material === 'wood' ? 'splinter' : 'split', thing: t });
      return;
    }
    switch (material) {
      case 'stone':
        t.phase = 'wrecked';
        events.push({ type: 'crumble', thing: t });
        break;
      case 'plant':
        t.phase = 'wrecked';
        events.push({ type: 'split', thing: t });
        if (!rammed) this.ignite(t, events);
        break;
      case 'building':
        t.phase = 'wrecked';
        events.push({ type: 'collapse', thing: t });
        if (!rammed || this.rand() < 0.25) this.ignite(t, events, true);
        break;
      case 'bridge':
        t.phase = 'wrecked';
        events.push({ type: 'collapse', thing: t });
        break;
      case 'metal':
      case 'fuel':
        t.phase = t.def.wreckSolid || t.def.burns > 0 ? 'wrecked' : 'gone';
        // Machinery that doesn't burn or go up (a crane, a silo) just buckles and comes down.
        if (!t.def.explodes && t.def.burns <= 0) events.push({ type: 'collapse', thing: t });
        else this.fuses.push({ thing: t, t: FUSE[material] });
        break;
      case 'straw':
        // It doesn't fall apart: it goes up, and burns to ash.
        t.phase = 'wrecked';
        this.ignite(t, events, true);
        break;
      case 'wood':
        t.phase = 'gone';
        events.push({ type: 'splinter', thing: t });
        break;
    }
  }

  /** Sets something alight (if it burns, isn't already, and there's room for another fire; `force` makes room). */
  ignite(t: Thing, events: WorldEvent[], force = false): void {
    if (t.def.burns <= 0 || t.fire > 0 || t.burnt || t.phase === 'gone') return;
    if (this.burning.size >= MAX_FIRES && !force) return;
    t.fire = t.def.burns * (0.8 + this.rand() * 0.4);
    this.burning.add(t);
    events.push({ type: 'ignite', thing: t });
  }

  get fires(): ReadonlySet<Thing> {
    return this.burning;
  }

  /** Moves time on: fuses run down (and things go off), fires burn down and spread. */
  update(dt: number): WorldEvent[] {
    const events: WorldEvent[] = [];
    for (let k = this.fuses.length - 1; k >= 0; k--) {
      const f = this.fuses[k];
      f.t -= dt;
      if (f.t > 0) continue;
      this.fuses.splice(k, 1);
      const t = f.thing;
      const boom = t.def.explodes;
      if (boom) {
        events.push(...this.blast(t.x, t.y, boom.radius, boom.power).map((e) => (e.type === 'explode' && e.thing === null ? { ...e, thing: t } : e)));
      }
      if (t.phase !== 'gone') this.ignite(t, events, true);
    }

    this.spreadDue -= dt;
    const spread = this.spreadDue <= 0;
    if (spread) this.spreadDue += SPREAD_EVERY;
    for (const t of [...this.burning]) {
      t.fire -= dt;
      // A burning building comes down part way through.
      if (t.def.material === 'building' && t.phase !== 'wrecked' && t.fire < t.def.burns * 0.6) {
        t.phase = 'wrecked';
        t.hp = 0;
        this.destroyed++;
        events.push({ type: 'collapse', thing: t });
      }
      if (spread) this.spreadFrom(t, events);
      if (t.fire > 0) continue;
      t.fire = 0;
      t.burnt = true;
      this.burning.delete(t);
      if (t.phase === 'intact' || t.phase === 'damaged') {
        // Burnt where it stood: a tree or haystack to ash.
        t.phase = 'wrecked';
        this.destroyed++;
      }
      // A boat burns to the waterline and sinks.
      if (t.kind === 'boat' || t.kind === 'trawler') t.phase = 'gone';
      events.push({ type: 'burntOut', thing: t });
    }
    return events;
  }

  private spreadFrom(t: Thing, events: WorldEvent[]): void {
    for (const n of this.near(t.x, t.y, t.def.r + SPREAD_REACH + 50)) {
      if (n === t || n.fire > 0 || n.burnt || n.def.burns <= 0 || n.phase === 'gone') continue;
      const chance = SPREAD_CHANCE[n.def.material as keyof typeof SPREAD_CHANCE];
      if (!chance) continue;
      if (Math.hypot(n.x - t.x, n.y - t.y) - t.def.r - n.def.r > SPREAD_REACH) continue;
      if (this.rand() < chance) this.ignite(n, events);
    }
  }
}

function cellKey(gx: number, gy: number): number {
  return gx * 4096 + gy;
}
