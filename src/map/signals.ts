/**
 * Traffic lights from OpenStreetMap. OSM puts a set of lights as a single
 * point on the road (where traffic stops, or at a junction, or at a crossing
 * with lights), saying at most which way it faces; the game needs to know,
 * for each way into it, where the stop line is, where the pole stands (on
 * the kerb to the left of the traffic coming, as in Britain), and which
 * lights work together. Pure, so it's tested.
 */

/** A way into a point on a road: traffic heading along (dx, dy) towards it. */
export interface Arm {
  dx: number;
  dy: number;
  /** The road's width, px, and whether it's one-way. */
  width: number;
  oneway: boolean;
  /** The road's id, so lights along the same road can be told apart from those on others. */
  road: number;
}

/** A point on the roads with lights: a set of traffic lights, or a crossing with them. */
export interface LightPoint {
  x: number;
  y: number;
  /** A crossing with lights (pelican, puffin, toucan), rather than lights on their own. */
  crossing: boolean;
  /** The ways into it; for a junction, every road meeting there. */
  arms: Arm[];
}

/** One way into a set of lights: where traffic stops and where its lights stand. */
export interface Signal {
  /** The pole, map px. */
  x: number;
  y: number;
  /** The way the traffic stopping here is heading, radians. */
  angle: number;
  /** The stop line, across the lanes coming in: x0, y0, x1, y1. */
  stop: [number, number, number, number];
  /** Which controller works it, and which of its groups it's in (the lights in a group go green together). */
  controller: number;
  group: number;
}

/** A set of lights working together: a junction's, or a crossing's. */
export interface Controller {
  x: number;
  y: number;
  /** How many groups of lights take turns. */
  groups: number;
  /** Whether people get a turn to cross (everything red, the green man lit). */
  walk: boolean;
}

/** Lights this close together are worked together, px. */
const TOGETHER = 40 * 8;
/** Traffic stops this far short of a crossing with lights, px. */
const CROSSING_SETBACK = 2.5 * 8;
/** The pole stands this far out from the edge of the road, px. */
const KERB = 0.9 * 8;

export function trafficLights(points: LightPoint[]): { signals: Signal[]; controllers: Controller[] } {
  // Lights close together are one controller's.
  const parent = points.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < TOGETHER) parent[find(i)] = find(j);
    }
  }

  // Each way in, with where it stops.
  interface Approach {
    point: number;
    arm: Arm;
    /** The middle of the road at the stop line. */
    sx: number;
    sy: number;
  }
  const approaches: Approach[] = [];
  points.forEach((p, i) => {
    const roads = new Set(p.arms.map((a) => a.road));
    const junction = roads.size > 1;
    const widest = Math.max(...p.arms.map((a) => a.width));
    for (const arm of p.arms) {
      // At a junction, traffic stops short of the road it's crossing; at a crossing, short of the stripes;
      // lights on their own are mapped at the stop line.
      const setback = junction ? widest / 2 + 2 * 8 : p.crossing ? CROSSING_SETBACK : 0;
      approaches.push({ point: i, arm, sx: p.x - arm.dx * setback, sy: p.y - arm.dy * setback });
    }
  });

  // Lights mapped either side of a crossing say the same thing to the same traffic as the crossing
  // itself: of those along the same road one after the other, only the first the traffic meets counts.
  const kept = approaches.filter((a) =>
    !approaches.some((b) => {
      if (b === a || b.arm.road !== a.arm.road || a.arm.dx * b.arm.dx + a.arm.dy * b.arm.dy < 0.9) return false;
      if (find(a.point) !== find(b.point)) return false;
      // b is further back up the road than a (the traffic meets it first), and in line with it.
      const along = (a.sx - b.sx) * a.arm.dx + (a.sy - b.sy) * a.arm.dy;
      const across = Math.abs(-(a.sx - b.sx) * a.arm.dy + (a.sy - b.sy) * a.arm.dx);
      return along > 1 && along < TOGETHER && across < a.arm.width;
    }),
  );

  // Controllers, numbered in order, and their groups: ways in that line up (or run head on) go together.
  const ids = new Map<number, number>();
  const controllers: Controller[] = [];
  const axes: [number, number][][] = [];
  const signals: Signal[] = [];
  for (const a of kept) {
    const root = find(a.point);
    let id = ids.get(root);
    if (id === undefined) {
      id = controllers.length;
      ids.set(root, id);
      const members = points.filter((_, i) => find(i) === root);
      controllers.push({
        x: Math.round(members.reduce((s, m) => s + m.x, 0) / members.length),
        y: Math.round(members.reduce((s, m) => s + m.y, 0) / members.length),
        groups: 0,
        walk: members.some((m) => m.crossing),
      });
      axes.push([]);
    }
    const { dx, dy, width, oneway } = a.arm;
    let group = axes[id].findIndex(([ax, ay]) => Math.abs(ax * dx + ay * dy) > 0.7);
    if (group < 0) {
      group = axes[id].length;
      axes[id].push([dx, dy]);
      controllers[id].groups = axes[id].length;
    }
    // Left of the traffic (y is down, so that's (dy, -dx)): Britain drives on the left.
    const nx = dy;
    const ny = -dx;
    const half = width / 2;
    const from = oneway ? -half : 0;
    signals.push({
      x: Math.round(a.sx + nx * (half + KERB)),
      y: Math.round(a.sy + ny * (half + KERB)),
      angle: +Math.atan2(dy, dx).toFixed(3),
      stop: [Math.round(a.sx + nx * from), Math.round(a.sy + ny * from), Math.round(a.sx + nx * half), Math.round(a.sy + ny * half)],
      controller: id,
      group,
    });
  }
  return { signals, controllers };
}
