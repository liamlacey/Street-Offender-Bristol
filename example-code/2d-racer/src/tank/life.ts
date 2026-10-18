/**
 * The island's people and animals: villagers walking between the houses and
 * stopping to chat, people strolling on the beaches, sunbathing on their
 * towels and swimming in the shallows, campers sat round their campfires,
 * forestry workers about their clearings, dockers in the harbour yards,
 * hikers and walkers out along the footpaths, and up in the hills and on the
 * snow, sheep and cows grazing round the farms, and deer in the woods. They wander near home, standing a
 * while between walks, and scatter from explosions and from the tank (and
 * step out of its way). Nobody gets hurt: rockets fly over them, and they
 * run. Pure logic; IslandLife draws them.
 */

import { BIOME, type Biome, type Island, SIZE, type Vec2, YARD, biomeAt, harbourPoint, townReach } from './island';
import { TANK_RADIUS } from './tank';
import { World } from './world';

export type AgentKind = 'person' | 'hiker' | 'swimmer' | 'sheep' | 'cow' | 'deer' | 'hen';
/** What someone's doing there: sunbathers and campers keep to their spot (lying on their towel, sat by the fire) till something scares them off it. */
export type Role = 'sunbather' | 'camper' | 'worker' | 'farmer';

export interface Agent {
  kind: AgentKind;
  x: number;
  y: number;
  heading: number;
  /** How fast it's going now, px/s. */
  speed: number;
  /** Where it lives, and how far it wanders. */
  home: { x: number; y: number; r: number };
  target: { x: number; y: number } | null;
  /** Seconds left standing (chatting, grazing). */
  wait: number;
  /** Seconds left running scared, and from where. */
  scared: number;
  from: { x: number; y: number };
  /** Which look (clothes, coat). */
  look: number;
  role?: Role;
  /** Which way they face when settled in their spot. */
  face?: number;
  /** A footpath they're walking (back and forth, end to end), which point of it they're heading for, and which way along it. */
  route?: Vec2[];
  leg?: number;
  way?: 1 | -1;
}

/** Walking and running speeds, px/s. */
export const PACE: Record<AgentKind, { walk: number; run: number }> = {
  person: { walk: 32, run: 125 },
  hiker: { walk: 28, run: 110 },
  swimmer: { walk: 9, run: 34 },
  sheep: { walk: 12, run: 95 },
  cow: { walk: 10, run: 75 },
  deer: { walk: 18, run: 175 },
  hen: { walk: 9, run: 70 },
};
/** How close an explosion, or the tank, has to be to scare them, px. */
export const FRIGHT: Record<AgentKind, { blast: number; tank: number }> = {
  person: { blast: 480, tank: 150 },
  hiker: { blast: 480, tank: 150 },
  swimmer: { blast: 500, tank: 160 },
  sheep: { blast: 420, tank: 130 },
  cow: { blast: 380, tank: 110 },
  deer: { blast: 650, tank: 280 },
  hen: { blast: 400, tank: 110 },
};
/** How long they stand between walks, s. */
const REST: Record<AgentKind, [number, number]> = {
  person: [2, 9],
  hiker: [2, 7],
  swimmer: [1, 5],
  sheep: [3, 12],
  cow: [4, 14],
  deer: [2, 8],
  hen: [1, 4],
};
const RADIUS = 7;

/** What's round them: whether a spot is somewhere they can go. */
export interface Ground {
  free(x: number, y: number): boolean;
}

/** Where people and animals can go: dry land (only hikers climb onto the snow; cows keep off the rocks), or for swimmers the shallows; clear of anything standing. */
export function groundFor(island: Island, world: World, kind: AgentKind): Ground {
  const ok = (b: Biome) =>
    kind === 'swimmer'
      ? b === BIOME.shallow
      : b !== BIOME.deep && b !== BIOME.shallow && b !== BIOME.river && (b !== BIOME.snow || kind === 'hiker') && (kind !== 'cow' || b !== BIOME.rock);
  return {
    free(x, y) {
      if (x < 20 || y < 20 || x > SIZE - 20 || y > SIZE - 20) return false;
      if (!ok(biomeAt(island, x, y))) return false;
      for (const t of world.near(x, y, 60)) {
        if (World.blocks(t) && Math.hypot(t.x - x, t.y - y) < t.def.r + RADIUS) return false;
      }
      return true;
    },
  };
}

/**
 * Moves someone on by `dt` s: running from a fright, standing, or walking
 * to somewhere near home. `blasts` are explosions this frame.
 */
export function stepAgent(a: Agent, dt: number, ground: Ground, tank: { x: number; y: number }, blasts: { x: number; y: number }[], rand: () => number): void {
  const fright = FRIGHT[a.kind];
  for (const b of blasts) {
    if (Math.hypot(b.x - a.x, b.y - a.y) < fright.blast) scare(a, b, 3 + rand() * 3);
  }
  const toTank = Math.hypot(tank.x - a.x, tank.y - a.y);
  if (toTank < fright.tank) scare(a, tank, 1.5 + rand() * 2);

  if (a.scared > 0) {
    a.scared -= dt;
    let away = Math.atan2(a.y - a.from.y, a.x - a.from.x);
    // Round whatever's in the way.
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 2, -2]) {
      const h = away + turn;
      if (ground.free(a.x + Math.cos(h) * 12, a.y + Math.sin(h) * 12)) {
        away = h;
        break;
      }
    }
    a.heading = away;
    a.speed = PACE[a.kind].run;
    if (a.scared <= 0) {
      a.target = null;
      a.wait = 0.5 + rand();
    }
  } else if (a.wait > 0) {
    a.wait -= dt;
    a.speed = 0;
  } else {
    const settles = a.role === 'sunbather' || a.role === 'camper';
    if (!a.target) a.target = settles ? { x: a.home.x, y: a.home.y } : a.route ? a.route[a.leg!] : pickSpot(a, ground, rand);
    if (!a.target) {
      a.wait = 1;
      a.speed = 0;
    } else {
      const d = Math.hypot(a.target.x - a.x, a.target.y - a.y);
      if (d < 4 && a.route) {
        // On along the path; a rest at either end, then back the other way.
        a.target = null;
        const end = (a.leg === 0 && a.way === -1) || (a.leg === a.route.length - 1 && a.way === 1);
        if (end) {
          a.way = a.way === 1 ? -1 : 1;
          a.wait = 4 + rand() * 8;
          a.speed = 0;
        }
        a.leg = Math.max(0, Math.min(a.route.length - 1, a.leg! + a.way!));
      } else if (d < 4) {
        a.target = null;
        const [lo, hi] = REST[a.kind];
        // Back in their spot, they stay.
        a.wait = settles ? Infinity : lo + rand() * (hi - lo);
        a.speed = 0;
      } else {
        a.heading = Math.atan2(a.target.y - a.y, a.target.x - a.x);
        a.speed = PACE[a.kind].walk;
      }
    }
  }

  if (a.speed > 0) {
    const nx = a.x + Math.cos(a.heading) * a.speed * dt;
    const ny = a.y + Math.sin(a.heading) * a.speed * dt;
    if (ground.free(nx, ny)) {
      a.x = nx;
      a.y = ny;
    } else if (a.scared <= 0) {
      // Something's in the way: go somewhere else (or on past it, along a path).
      a.target = null;
      a.wait = 0.3;
      if (a.route) a.leg = Math.max(0, Math.min(a.route.length - 1, a.leg! + a.way! * 3));
    }
  }
  // Out from under the tank, if it's caught them up.
  const near = Math.hypot(a.x - tank.x, a.y - tank.y);
  if (near < TANK_RADIUS + RADIUS) {
    const push = (TANK_RADIUS + RADIUS - near) / (near || 1);
    const nx = a.x + (a.x - tank.x) * push;
    const ny = a.y + (a.y - tank.y) * push;
    if (ground.free(nx, ny)) {
      a.x = nx;
      a.y = ny;
    }
  }
}

function scare(a: Agent, from: { x: number; y: number }, seconds: number): void {
  a.from = { x: from.x, y: from.y };
  a.scared = Math.max(a.scared, seconds);
  a.target = null;
  a.wait = 0;
}

/** Somewhere to walk to: near home (back towards it, if a fright's taken them far away). */
function pickSpot(a: Agent, ground: Ground, rand: () => number): { x: number; y: number } | null {
  const { home } = a;
  const far = Math.hypot(a.x - home.x, a.y - home.y) > home.r * 1.5;
  for (let k = 0; k < 8; k++) {
    const angle = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * home.r;
    // Animals amble a short way at a time; people go further.
    const reach = a.kind === 'person' || a.kind === 'hiker' ? 1 : 0.35;
    const x = far ? home.x + Math.cos(angle) * r : a.x + (home.x + Math.cos(angle) * r - a.x) * reach;
    const y = far ? home.y + Math.sin(angle) * r : a.y + (home.y + Math.sin(angle) * r - a.y) * reach;
    if (ground.free(x, y)) return { x, y };
  }
  return null;
}

/** Everyone on the island: villagers in each village, people on the beaches and in the sea, campers, forestry workers, hikers, flocks and herds by the farms, deer in the woods. */
export function populate(island: Island, rand: () => number): Agent[] {
  const agents: Agent[] = [];
  const add = (kind: AgentKind, x: number, y: number, r: number, count: number, role?: Role, face?: number) => {
    for (let k = 0; k < count; k++) {
      const a = rand() * Math.PI * 2;
      // Those with a spot start in it.
      const d = role === 'sunbather' || role === 'camper' ? 0 : Math.sqrt(rand()) * r * 0.8;
      agents.push({
        kind,
        role,
        face,
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        heading: rand() * Math.PI * 2,
        speed: 0,
        home: { x, y, r },
        target: null,
        wait: rand() * 4,
        scared: 0,
        from: { x, y },
        look: Math.floor(rand() * 1000),
      });
      if (role === 'sunbather' || role === 'camper') agents[agents.length - 1].wait = Infinity;
    }
  };
  // Townsfolk about the streets.
  for (const t of island.towns) add('person', t.x, t.y, townReach(t), t.city ? 110 + Math.floor(rand() * 30) : 16 + Math.floor(rand() * 10));
  for (const v of island.villages) {
    add('person', v.x, v.y, v.r, 5 + Math.floor(rand() * 5));
    // Flocks and herds in the fields round about.
    const barn = island.things.find((t) => t.kind === 'barn' && Math.hypot(t.x - v.x, t.y - v.y) < v.r + 200);
    const field = barn ?? { x: v.x + v.r + 200, y: v.y };
    for (const [kind, count] of [['sheep', 6 + Math.floor(rand() * 6)], ['cow', 3 + Math.floor(rand() * 4)]] as const) {
      for (let k = 0; k < 8; k++) {
        const a = rand() * Math.PI * 2;
        const x = field.x + Math.cos(a) * (180 + rand() * 200);
        const y = field.y + Math.sin(a) * (180 + rand() * 200);
        const b = biomeAt(island, x, y);
        if (b === BIOME.grass || b === BIOME.hills) {
          add(kind, x, y, 120, count);
          break;
        }
      }
    }
  }
  // People on the beaches, and deer in the woods.
  const more = (SIZE / 6400) ** 2;
  for (const [biome, kind, groups, size, r] of [[BIOME.beach, 'person', 6, 3, 160], [BIOME.forest, 'deer', 8, 4, 220]] as const) {
    for (let placed = 0, tries = 0; placed < groups * more && tries < 3000 * more; tries++) {
      const x = rand() * SIZE;
      const y = rand() * SIZE;
      if (biomeAt(island, x, y) !== biome) continue;
      add(kind, x, y, r, 1 + Math.floor(rand() * size));
      placed++;
    }
  }
  // Hikers and walkers along the footpaths.
  for (const trail of island.trails) {
    const route = trail.filter((_, k) => k % 3 === 0);
    if (route.length < 3) continue;
    for (let k = 0, n = 1 + Math.floor(rand() * 2); k < n; k++) {
      const leg = Math.floor(rand() * route.length);
      add('hiker', route[leg].x, route[leg].y, 40, 1);
      const a = agents[agents.length - 1];
      a.x = route[leg].x;
      a.y = route[leg].y;
      a.route = route;
      a.leg = leg;
      a.way = rand() < 0.5 ? 1 : -1;
    }
  }
  // Farmers about the farmyards and out in the fields, and hens pecking round the yard.
  for (const f of island.farms) {
    add('person', f.x, f.y, 260, 2 + Math.floor(rand() * 2), 'farmer');
    add('hen', f.x - Math.sin(f.angle) * 50, f.y + Math.cos(f.angle) * 50, 60, 4 + Math.floor(rand() * 5));
  }
  // Passengers waiting on the station platforms.
  for (const st of island.railway?.stations ?? []) {
    const nx = -Math.sin(st.angle) * st.side;
    const ny = Math.cos(st.angle) * st.side;
    add('person', st.x + nx * 27, st.y + ny * 27, 70, 3 + Math.floor(rand() * 4));
  }
  // Dockers busy about the harbour yards.
  for (const h of island.harbours) {
    const yard = harbourPoint(h, 0, YARD.depth / 2);
    add('person', yard.x, yard.y, YARD.half * 0.8, 4 + Math.floor(rand() * 3), 'worker');
  }
  // Hikers out in the hills and up the mountains.
  for (let placed = 0, tries = 0; placed < 5 * more && tries < 3000 * more; tries++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const b = biomeAt(island, x, y);
    if (b !== BIOME.hills && b !== BIOME.rock && b !== BIOME.snow) continue;
    add('hiker', x, y, 500, 1 + Math.floor(rand() * 3));
    placed++;
  }
  for (const t of island.things) {
    if (t.kind === 'parasol') {
      // Sunbathing on the towels either side (heads up the beach), and maybe a swim out in the shallows.
      for (const side of [-1, 1]) {
        if (rand() < 0.75) add('person', t.x + Math.cos(t.angle) * 22 * side, t.y + Math.sin(t.angle) * 22 * side, 40, 1, 'sunbather', t.angle - Math.PI / 2);
      }
      if (rand() < 0.5) {
        const out = t.angle + Math.PI / 2;
        for (let d = 40; d < 320; d += 20) {
          const x = t.x + Math.cos(out) * d;
          const y = t.y + Math.sin(out) * d;
          if (biomeAt(island, x, y) !== BIOME.shallow) continue;
          add('swimmer', x + Math.cos(out) * 20, y + Math.sin(out) * 20, 70, 1 + Math.floor(rand() * 2));
          break;
        }
      }
    } else if (t.kind === 'campfire') {
      // Sat round the fire.
      const n = 2 + Math.floor(rand() * 3);
      const turn = rand() * Math.PI * 2;
      for (let k = 0; k < n; k++) {
        const a = turn + ((k + 0.5) / n) * Math.PI * 2;
        add('person', t.x + Math.cos(a) * 22, t.y + Math.sin(a) * 22, 40, 1, 'camper', a + Math.PI);
      }
    } else if (t.kind === 'harvester') {
      add('person', t.x, t.y, 130, 2 + Math.floor(rand() * 2), 'worker');
    }
  }
  return agents;
}

/** Moves anyone who's started inside something (a house, the sea) to a free spot near home; drops anyone who can't be. */
export function settle(agents: Agent[], groundOf: (kind: AgentKind) => Ground, rand: () => number): Agent[] {
  return agents.filter((a) => {
    const ground = groundOf(a.kind);
    for (let k = 0; k < 30; k++) {
      if (ground.free(a.x, a.y)) return true;
      const angle = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * a.home.r;
      a.x = a.home.x + Math.cos(angle) * r;
      a.y = a.home.y + Math.sin(angle) * r;
    }
    return false;
  });
}
