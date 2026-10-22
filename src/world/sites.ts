/**
 * The building sites (`landuse=construction`) and the brownfield land
 * (`landuse=brownfield`): what's on them. A building site's fenced round
 * (a gate left open on the side nearest a road), with a Portakabin or two,
 * a portaloo, skips, pallets of bricks, stacks of pipes, a digger and a
 * dumper going about it, a tower crane over a big one, and its workers.
 * Brownfield's had rubbish dumped on it: mattresses, sofas, tyres, bin
 * bags, fridges, in piles along the side nearest a road. Worked out from
 * the map, the same every time (and in every region of it each is in), so
 * what's knocked about is the same thing. Pure, so it's tested; each thing
 * is a loose thing (see world.ts), the machines are driven about by
 * `SiteMachines`, and the workers are people (see people.ts).
 */

import { type GameMap, type Pts, VEHICLE_ROADS, pointInRing, ridgeAxis } from '../map/osm';
import { rectsOverlap } from './playgrounds';
import { type Work, drain, every } from './work.ts';

const M = 8;

export const TIP_KINDS = ['mattress', 'sofa', 'tyres', 'binbags', 'fridge', 'drum', 'cone', 'woodpallet', 'washer', 'carpet'] as const;
/** On the brownfield besides the rubbish: a burnt-out car, and a rough sleepers' camp (tents round a campfire). */
export type TipKind = (typeof TIP_KINDS)[number] | 'burntcar' | 'tent' | 'campfire';
export const SITE_KINDS = ['cabin', 'portaloo', 'skip', 'pallet', 'pipes', 'digger', 'dumper'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];
export const MACHINES: ReadonlySet<string> = new Set(['digger', 'dumper']);

/** What each takes up on the ground (along its angle, across it), px. */
export const SITE_SIZE: Record<SiteKind | TipKind, [number, number]> = {
  cabin: [6 * M, 2.5 * M],
  portaloo: [1.2 * M, 1.2 * M],
  skip: [3.6 * M, 1.8 * M],
  pallet: [1.2 * M, 1.1 * M],
  pipes: [3 * M, 1.5 * M],
  digger: [5 * M, 2.6 * M],
  dumper: [3.6 * M, 2 * M],
  mattress: [1.9 * M, 1.4 * M],
  sofa: [2 * M, 0.9 * M],
  tyres: [0.75 * M, 0.75 * M],
  binbags: [0.8 * M, 0.7 * M],
  fridge: [0.7 * M, 0.7 * M],
  drum: [0.6 * M, 0.6 * M],
  cone: [0.4 * M, 0.4 * M],
  woodpallet: [1.2 * M, 1 * M],
  washer: [0.65 * M, 0.65 * M],
  carpet: [2.4 * M, 0.5 * M],
  burntcar: [4.4 * M, 1.9 * M],
  tent: [2.3 * M, 1.6 * M],
  campfire: [1.4 * M, 1.4 * M],
};

/** A building site this big or more has anything on it, px²; a cabin and a digger from this, a dumper from this, a tower crane from this. */
const SITE_LEAST = 150 * M * M;
const DIGGER_SITE = 500 * M * M;
const DUMPER_SITE = 1500 * M * M;
const CRANE_SITE = 4000 * M * M;
/** A tower crane: how tall, how long its jib, px. */
export const CRANE_HEIGHT = 40 * M;
export const CRANE_JIB = 45 * M;
/** Its fence: Heras panels 3.5 m long; its gate, this wide. */
const PANEL = 3.5 * M;
const GATE = 7 * M;
/** A pile of fly-tipped rubbish for every this much brownfield, px² (at least one, at most TIPS); none in less than TIP_LEAST. */
const PER_TIP = 300 * M * M;
const TIPS = 12;
/** A burnt-out car on brownfield this big, px² (two on one CARS2 big); a camp on one this big; someone cutting across it for every this much (at most 4). */
const CARS1 = 1200 * M * M;
const CARS2 = 6000 * M * M;
const CAMP = 800 * M * M;
const PER_WALKER = 1000 * M * M;
const TIP_LEAST = 100 * M * M;
/** A worker for every this much building site, px² (at most WORKERS). */
const PER_WORKER = 400 * M * M;
const WORKERS = 8;

export interface Thing<K> {
  kind: K;
  x: number;
  y: number;
  angle: number;
}

export interface SiteLife {
  /** The rubbish dumped on the brownfield. */
  tips: Thing<TipKind>[];
  /** What's on the building sites (the machines too). */
  things: Thing<SiteKind>[];
  /** The building sites' fences, in runs (a gate's gap between two). */
  fences: Pts[];
  /** The tower cranes: where their masts stand, which way their jibs point. */
  cranes: { x: number; y: number; angle: number }[];
  /** Where the workers stand about. */
  workers: { x: number; y: number }[];
  /** The building sites themselves (each the outer ring), for the machines to keep to. */
  sites: Pts[];
  /** The brownfield: each its outer ring (people cut across it); where its gulls pick at the rubbish; where people stand about on it. */
  wastes: Pts[];
  gulls: { x: number; y: number }[];
  wanderers: { x: number; y: number }[];
}

/** How many spots a site's things are tried in, at most, laid out over it; and tried for each thing. */
const SPOTS = 12_000;
const PUT_TRIES = 3_000;
const SOLID_CELL = 16 * M;

const cache = new WeakMap<GameMap, SiteLife>();

/** What's on a map's building sites and brownfield (worked out once for each). */
export function siteLife(map: GameMap): SiteLife {
  return drain(siteLifeWork(map));
}

/** The same, a little at a time (see work.ts). */
export function* siteLifeWork(map: GameMap): Work<SiteLife> {
  const had = cache.get(map);
  if (had) return had;
  const pause = every(4);
  const life: SiteLife = { tips: [], things: [], fences: [], cranes: [], workers: [], sites: [], wastes: [], gulls: [], wanderers: [] };
  const bounded = (pts: Pts, pad: number) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k + 1 < pts.length; k += 2) [x0, y0, x1, y1] = [Math.min(x0, pts[k]), Math.min(y0, pts[k + 1]), Math.max(x1, pts[k]), Math.max(y1, pts[k + 1])];
    return { pts, x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  };
  const within = (x: number, y: number, b: { x0: number; y0: number; x1: number; y1: number }) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  const lots = (map.areas ?? []).filter((a) => a.kind === 'dirt' || a.kind === 'brownfield');
  if (!lots.length) {
    cache.set(map, life);
    return life;
  }
  const solid = (map.buildings ?? []).filter((b) => !b.bottom).map((b) => bounded(b.rings[0], 0));
  const roads = map.roads.filter((r) => !r.bridge && !r.tunnel && (VEHICLE_ROADS.has(r.kind) || r.kind === 'rail' || r.kind === 'pedestrian' || r.kind === 'footway' || r.kind === 'cycleway')).map((r) => ({ ...bounded(r.pts, r.width / 2 + 2 * M), half: r.width / 2, vehicle: VEHICLE_ROADS.has(r.kind) && r.kind !== 'track' }));
  // (The water; and anything paved or laid out mapped over it: a car park, a forecourt, a square, a playground, a pitch, a platform.)
  const water = (map.areas ?? []).filter((a) => a.kind === 'water' || a.kind === 'pool' || a.kind === 'parking' || a.kind === 'forecourt' || a.kind === 'plaza' || a.kind === 'yard' || a.kind === 'play' || a.kind === 'pitch' || a.kind === 'platform' || a.kind === 'pier').map((a) => bounded(a.rings[0], 0));
  const trees: [number, number][] = [];
  for (let i = 0; i + 3 < (map.trees ?? []).length; i += 4) trees.push([map.trees[i], map.trees[i + 1]]);
  const seen = new Set<string>();
  for (const a of lots) {
    if (pause()) yield;
    const ring = a.rings[0];
    const name = `${a.kind},${ring[0]},${ring[1]},${ring.length}`;
    if (seen.has(name)) continue;
    seen.add(name);
    const area = Math.abs(ringArea(ring));
    const site = a.kind === 'dirt';
    if (area < (site ? SITE_LEAST : TIP_LEAST)) continue;
    const box = bounded(ring, 0);
    const overlaps = (b: { x0: number; y0: number; x1: number; y1: number }) => b.x1 > box.x0 && b.x0 < box.x1 && b.y1 > box.y0 && b.y0 < box.y1;
    const near = { solid: solid.filter(overlaps), roads: roads.filter(overlaps), water: water.filter(overlaps), trees: trees.filter(([x, y]) => x > box.x0 - M && x < box.x1 + M && y > box.y0 - M && y < box.y1 + M) };
    const inside = (x: number, y: number) => a.rings.every((r, i) => pointInRing(x, y, r) === (i === 0));
    // (The buildings by the 16 m squares they're in: a big site has hundreds round it.)
    const solidCells = new Map<number, typeof near.solid>();
    for (const b of near.solid) {
      for (let i = Math.floor(b.x0 / SOLID_CELL); i <= Math.floor(b.x1 / SOLID_CELL); i++) {
        for (let j = Math.floor(b.y0 / SOLID_CELL); j <= Math.floor(b.y1 / SOLID_CELL); j++) {
          const k = i * 100003 + j;
          const list = solidCells.get(k);
          if (list) list.push(b);
          else solidCells.set(k, [b]);
        }
      }
    }
    const inBuilding = (x: number, y: number) => (solidCells.get(Math.floor(x / SOLID_CELL) * 100003 + Math.floor(y / SOLID_CELL)) ?? []).some((b) => within(x, y, b) && pointInRing(x, y, b.pts));
    const onRoad = (x: number, y: number, pad: number) => near.roads.some((r) => within(x, y, r) && distanceTo(x, y, r.pts) < r.half + pad);
    // (The trees by the 16 m squares they're in, too: there can be thousands round a big site.)
    const treeCells = new Map<number, [number, number][]>();
    for (const t of near.trees) {
      const k = Math.floor(t[0] / SOLID_CELL) * 100003 + Math.floor(t[1] / SOLID_CELL);
      const list = treeCells.get(k);
      if (list) list.push(t);
      else treeCells.set(k, [t]);
    }
    const byTree = (x: number, y: number) => {
      for (let i = Math.floor((x - M) / SOLID_CELL); i <= Math.floor((x + M) / SOLID_CELL); i++) {
        for (let j = Math.floor((y - M) / SOLID_CELL); j <= Math.floor((y + M) / SOLID_CELL); j++) {
          for (const [tx, ty] of treeCells.get(i * 100003 + j) ?? []) if (Math.hypot(tx - x, ty - y) < 1 * M) return true;
        }
      }
      return false;
    };
    const open = (x: number, y: number) =>
      inside(x, y) && !inBuilding(x, y) && !byTree(x, y) && !onRoad(x, y, 1 * M) && !near.water.some((b) => within(x, y, b) && pointInRing(x, y, b.pts));
    let seed = hash(ring[0], ring[1]) || 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const { ux, uy } = ridgeAxis(ring);
    const square = Math.atan2(uy, ux);
    // Its edge, and where on it's nearest a road (the gate; where the rubbish is dumped): a road within 20 m of it.
    const beside = roads.filter((b) => b.x1 > box.x0 - 20 * M && b.x0 < box.x1 + 20 * M && b.y1 > box.y0 - 20 * M && b.y0 < box.y1 + 20 * M);
    const edge = [...ring, ring[0], ring[1]];
    let [gx, gy, gd] = [ring[0], ring[1], Infinity];
    for (let i = 0; i + 3 < edge.length; i += 2) {
      const [ax, ay, bx, by] = [edge[i], edge[i + 1], edge[i + 2], edge[i + 3]];
      const len = Math.hypot(bx - ax, by - ay);
      for (let d = 0; d <= len; d += 2 * M) {
        const [x, y] = [ax + ((bx - ax) * d) / (len || 1), ay + ((by - ay) * d) / (len || 1)];
        for (const r of beside) {
          if (!r.vehicle || !within(x, y, { x0: r.x0 - 20 * M, y0: r.y0 - 20 * M, x1: r.x1 + 20 * M, y1: r.y1 + 20 * M })) continue;
          const dd = distanceTo(x, y, r.pts) - r.half;
          if (dd < gd) [gx, gy, gd] = [x, y, dd];
        }
      }
    }
    const placed: [number, number, number, number, number][] = [];
    /** Somewhere for something this big: the first of the spots tried (in the order given) where it fits, clear of the rest. */
    const put = (kind: SiteKind | TipKind, spots: [number, number][], turn: () => number, apart = 0.8 * M): Thing<never> | null => {
      const [len, wide] = SITE_SIZE[kind];
      // (Not every spot, on a big site: enough to find somewhere if there is anywhere.)
      let tries = 0;
      for (const [x, y] of spots) {
        if (++tries > PUT_TRIES) break;
        const angle = turn();
        const [cx, cy] = [Math.cos(angle), Math.sin(angle)];
        const [hl, hw] = [len / 2, wide / 2];
        // (A little in from its corners: inside, not right on the edge.)
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([s, t]) => [x + cx * (hl + 2) * s - cy * (hw + 2) * t, y + cy * (hl + 2) * s + cx * (hw + 2) * t]);
        if (!corners.every(([px, py]) => open(px, py))) continue;
        if (placed.some((o) => rectsOverlap([x, y, angle, hl + apart / 2, hw + apart / 2], [o[0], o[1], o[2], o[3] + apart / 2, o[4] + apart / 2]))) continue;
        placed.push([x, y, angle, hl, hw]);
        return { kind: kind as never, x: r1(x), y: r1(y), angle: +angle.toFixed(3) };
      }
      return null;
    };
    // Spots inside it, a metre apart (further on a big one: no more than about SPOTS of them), tried in an order of their own; and
    // those near its edge (within `reach`), nearest the gate first.
    const grid: [number, number][] = [];
    const step = Math.max(M, Math.ceil(Math.sqrt(area / SPOTS) / M) * M);
    for (let x = box.x0 + M; x < box.x1; x += step) for (let y = box.y0 + M; y < box.y1; y += step) if (inside(x, y)) grid.push([x, y]);
    const shuffled = grid.map((p) => [p, hash(p[0], p[1])] as const).sort((p, q) => p[1] - q[1]).map(([p]) => p);
    const edgeDist = (x: number, y: number) => distanceTo(x, y, edge);
    // (Each spot's distance from the edge, worked out once.)
    const fromEdge = new Map(shuffled.map((p) => [p, edgeDist(p[0], p[1])]));
    const byEdge = (reach: number) => shuffled.filter((p) => fromEdge.get(p)! < reach);
    if (!site) {
      life.wastes.push(ring);
      // Fly-tipped: in piles, inside its edge on the side nearest a road first (or anywhere along its edge, if there's no road near), then about it.
      const piles = Math.min(TIPS, Math.max(1, Math.floor(area / PER_TIP)));
      const roadside = byEdge(14 * M).sort((p, q) => Math.hypot(p[0] - gx, p[1] - gy) * (1 + (hash(p[1], p[0]) % 7) / 10) - Math.hypot(q[0] - gx, q[1] - gy) * (1 + (hash(q[1], q[0]) % 7) / 10));
      const piled: [number, number][] = [];
      for (const [px, py] of [...roadside.slice(0, Math.ceil(roadside.length / 3)), ...shuffled]) {
        if (piled.length >= piles) break;
        if (piled.some(([x, y]) => Math.hypot(x - px, y - py) < 9 * M)) continue;
        if (!open(px, py)) continue;
        piled.push([px, py]);
        const n = 3 + Math.floor(rand() * 5);
        for (let k = 0; k < n; k++) {
          const kind = TIP_KINDS[Math.floor(rand() * TIP_KINDS.length)];
          const near = Array.from({ length: 12 }, () => [px + (rand() - 0.5) * 6 * M, py + (rand() - 0.5) * 6 * M] as [number, number]);
          const t = put(kind, near, () => rand() * Math.PI * 2, 0.1 * M);
          if (t) life.tips.push(t);
        }
      }
      // The gulls, at the rubbish.
      if (piled.length >= 2) life.gulls.push({ x: r1(piled[1][0]), y: r1(piled[1][1] + 3 * M) });
      // A burnt-out car or two, dumped and set alight.
      for (let k = area >= CARS2 ? 2 : area >= CARS1 ? 1 : 0; k > 0; k--) {
        const t = put('burntcar', shuffled, () => rand() * Math.PI * 2, 1.5 * M);
        if (t) life.tips.push(t);
      }
      // A rough sleepers' camp, well away from the road: a campfire, its tents round it.
      if (area >= CAMP) {
        const far = shuffled.filter(([x, y]) => edgeDist(x, y) > 3 * M).sort((p, q) => Math.hypot(q[0] - gx, q[1] - gy) - Math.hypot(p[0] - gx, p[1] - gy));
        const fire = put('campfire', far.slice(0, 40), () => 0, 2.5 * M);
        if (fire) {
          life.tips.push(fire);
          for (let k = 0, n = 1 + Math.floor(rand() * 2); k < n; k++) {
            const a = rand() * Math.PI * 2;
            const ring3 = Array.from({ length: 10 }, (_, i) => [fire.x + Math.cos(a + i * 0.6) * 3.2 * M, fire.y + Math.sin(a + i * 0.6) * 3.2 * M] as [number, number]);
            let at = 0;
            const t = put('tent', ring3, () => {
              // (Its door to the fire.)
              const [x, y] = ring3[at++];
              return Math.atan2(fire.y - y, fire.x - x);
            }, 0.4 * M);
            if (t) life.tips.push(t);
          }
        }
      }
      // Someone cutting across it (with the dog), now and then.
      for (const [x, y] of shuffled) {
        if (life.wanderers.filter((w) => inside(w.x, w.y)).length >= Math.min(4, Math.max(1, Math.floor(area / PER_WALKER)))) break;
        if (!open(x, y) || life.wanderers.some((w) => Math.hypot(w.x - x, w.y - y) < 8 * M)) continue;
        life.wanderers.push({ x: r1(x), y: r1(y) });
      }
      continue;
    }
    life.sites.push(ring);
    // Its fence, all round it (but not across a road or a building, nor in the water), less the gate.
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 4) life.fences.push(run);
      run = [];
    };
    for (let i = 0; i + 3 < edge.length; i += 2) {
      const [ax, ay, bx, by] = [edge[i], edge[i + 1], edge[i + 2], edge[i + 3]];
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.round(len / PANEL));
      for (let k = 0; k < n; k++) {
        const [x0, y0] = [ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n];
        const [x1, y1] = [ax + ((bx - ax) * (k + 1)) / n, ay + ((by - ay) * (k + 1)) / n];
        const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
        const keep = Math.hypot(mx - gx, my - gy) > GATE / 2 && !inBuilding(mx, my) && !onRoad(mx, my, 0.3 * M) && !near.water.some((b) => within(mx, my, b) && pointInRing(mx, my, b.pts));
        if (!keep) {
          flush();
          continue;
        }
        if (!run.length) run.push(r1(x0), r1(y0));
        run.push(r1(x1), r1(y1));
      }
    }
    flush();
    // A tower crane over a big one, in the middle of it (its mast's foot clear of everything).
    const [cx, cy] = centroid(ring);
    if (area >= CRANE_SITE) {
      const spot = shuffled.filter((p) => fromEdge.get(p)! > 8 * M && open(p[0], p[1])).sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy))[0];
      if (spot) {
        life.cranes.push({ x: r1(spot[0]), y: r1(spot[1]), angle: +(rand() * Math.PI * 2).toFixed(3) });
        placed.push([spot[0], spot[1], 0, 2 * M, 2 * M]);
      }
    }
    // Along its edge, square to it: the cabins and the portaloo by the gate, the skips, the materials.
    const along = () => square + (rand() < 0.5 ? 0 : Math.PI / 2);
    const byGate = byEdge(8 * M).sort((p, q) => Math.hypot(p[0] - gx, p[1] - gy) - Math.hypot(q[0] - gx, q[1] - gy));
    const wants: SiteKind[] = ['cabin', 'portaloo', 'skip', 'pallet', 'pallet', 'pipes'];
    if (area >= DIGGER_SITE) wants.push('pallet', 'pallet', 'skip');
    if (area >= CRANE_SITE) wants.push('cabin', 'pallet', 'pallet', 'pipes');
    for (const kind of wants) {
      const t = put(kind, kind === 'cabin' || kind === 'portaloo' ? byGate : byEdge(10 * M), along);
      if (t) life.things.push(t);
    }
    // The machines, out in the middle.
    const middle = shuffled.filter((p) => fromEdge.get(p)! > 4 * M);
    for (const kind of [...(area >= DIGGER_SITE ? ['digger'] : []), ...(area >= DUMPER_SITE ? ['dumper'] : [])] as SiteKind[]) {
      const t = put(kind, middle, () => rand() * Math.PI * 2, 2 * M);
      if (t) life.things.push(t);
    }
    // Where the workers stand about.
    const workers = Math.min(WORKERS, Math.max(1, Math.floor(area / PER_WORKER)));
    let here = life.workers.filter((w) => inside(w.x, w.y)).length;
    for (const [x, y] of middle) {
      if (here >= workers) break;
      if (!open(x, y) || placed.some((o) => Math.hypot(o[0] - x, o[1] - y) < Math.max(o[3], o[4]) + 1.5 * M)) continue;
      if (life.workers.some((w) => Math.hypot(w.x - x, w.y - y) < 6 * M)) continue;
      life.workers.push({ x: r1(x), y: r1(y) });
      here++;
    }
  }
  cache.set(map, life);
  return life;
}

/** A machine on a building site, as the world has it (a loose thing): where, which way, whether it's been knocked (or wrecked), its moving parts. */
export interface Machine {
  kind: string;
  x: number;
  y: number;
  angle: number;
  moved: boolean;
  gone?: boolean;
  motion?: number[];
}

/** How fast a machine trundles about a site, px/s; how quickly it turns, radians/s; and how far from where it started it goes, px. */
const TRUNDLE = 1.6 * M;
const TURN = 0.7;
const ROAM = 14 * M;

/**
 * The diggers and dumpers at work: each off to somewhere else on its site
 * (not far), turning as it goes, then stopped a while (a digger digging, its
 * arm swinging); knocked by anything, and it's stopped for good.
 */
export class SiteMachines {
  private readonly jobs: Map<Machine, { home: [number, number]; tx: number; ty: number; wait: number; dead: boolean; t: number }>;

  constructor(
    private readonly sites: Pts[],
    private readonly rand: () => number = Math.random,
    /** The last region's (its machines carried over carry on with what they were doing). */
    last: SiteMachines | null = null,
  ) {
    this.jobs = last ? last.jobs : new Map();
  }

  update(dt: number, machines: Machine[]): void {
    for (const m of machines) {
      let job = this.jobs.get(m);
      if (!job) {
        job = { home: [m.x, m.y], tx: m.x, ty: m.y, wait: 1 + this.rand() * 6, dead: false, t: this.rand() * 10 };
        this.jobs.set(m, job);
      }
      m.motion ??= [0];
      if (job.dead || m.gone) continue;
      if (m.moved) {
        job.dead = true;
        continue;
      }
      job.t += dt;
      if (job.wait > 0) {
        job.wait -= dt;
        // A digger digging: its arm swinging to and fro.
        if (m.kind === 'digger') m.motion[0] = Math.sin(job.t * 0.9) * 0.6;
        if (job.wait <= 0) this.retarget(m, job);
        continue;
      }
      const [dx, dy] = [job.tx - m.x, job.ty - m.y];
      const d = Math.hypot(dx, dy);
      if (d < 0.5 * M) {
        job.wait = 4 + this.rand() * 10;
        continue;
      }
      let turn = Math.atan2(dy, dx) - m.angle;
      turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
      m.angle += Math.max(-TURN * dt, Math.min(TURN * dt, turn));
      // (Slowly round a tight turn; along once it's facing the way.)
      const speed = TRUNDLE * Math.max(0.2, Math.cos(turn));
      m.x += Math.cos(m.angle) * Math.min(d, speed * dt);
      m.y += Math.sin(m.angle) * Math.min(d, speed * dt);
      if (m.kind === 'digger') m.motion[0] *= Math.exp(-dt * 2);
    }
  }

  /** Somewhere else on its site, not far from where it started. */
  private retarget(_m: Machine, job: { home: [number, number]; tx: number; ty: number }): void {
    const ring = this.sites.find((r) => pointInRing(job.home[0], job.home[1], r));
    for (let tries = 0; tries < 12; tries++) {
      const [a, d] = [this.rand() * Math.PI * 2, (0.3 + this.rand() * 0.7) * ROAM];
      const [x, y] = [job.home[0] + Math.cos(a) * d, job.home[1] + Math.sin(a) * d];
      if (ring && !pointInRing(x, y, ring)) continue;
      [job.tx, job.ty] = [x, y];
      return;
    }
    [job.tx, job.ty] = job.home;
  }
}

/** A number from where something is (the same for the same place). */
function hash(x: number, y: number): number {
  return Math.abs(Math.round(x * 7.31 + y * 13.17) * 2654435761) % 2147483647;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function ringArea(pts: Pts): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return a / 2;
}

function centroid(pts: Pts): [number, number] {
  let [x, y] = [0, 0];
  for (let i = 0; i + 1 < pts.length; i += 2) [x, y] = [x + pts[i], y + pts[i + 1]];
  return [x / (pts.length / 2), y / (pts.length / 2)];
}

function distanceTo(x: number, y: number, pts: Pts): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y));
  }
  return best;
}
