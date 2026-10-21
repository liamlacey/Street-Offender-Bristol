import { describe, expect, it } from 'vitest';
import type { GameMap, Road } from '../map/osm';
import bristol from '../map/bristol.json';
import { buildingLook, clipHalfPlane, hatch, parseColour } from './buildingLook';
import { Surface, SurfaceGrid, surfacePaint } from './surface';
import { CHUNK, buildWorld, buildingWalls, chunkKey, cutWall, lineLength, pointAlong, shadowOffset, subPolyline } from './world';
import { DECK_END, Decks, SHADOW_HEIGHT } from './decks';
import { nearestOnSegment } from '../physics/collisions';

const map = bristol as unknown as GameMap;

describe('the Bristol map', () => {
  it('has the Cathedral, its towers, and the harbour', () => {
    expect(map.buildings.some((b) => b.name === 'Bristol Cathedral')).toBe(true);
    expect(map.buildings.filter((b) => b.top >= 30 * 8 && b.roofShape === 'pyramidal').length).toBeGreaterThanOrEqual(2);
    expect(map.areas.some((a) => a.kind === 'water')).toBe(true);
    expect(map.roads.some((r) => r.name === 'Anchor Road')).toBe(true);
  });

  it('starts the car on a road inside the map', () => {
    const { x, y } = map.spawn;
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    expect(x).toBeLessThan(map.width);
    expect(y).toBeLessThan(map.height);
  });
});

describe('buildWorld', () => {
  const world = buildWorld(map);

  it('walls in every solid building and the edge of the map', () => {
    const solid = map.buildings.filter((b) => b.solid);
    expect(world.walls[0].length).toBeGreaterThan(solid.length * 3);
    expect(world.walls[0]).toContainEqual({ ax: 0, ay: 0, bx: map.width, by: 0, r: 0, level: 0 });
    expect(world.walls[1]).toContainEqual({ ax: 0, ay: 0, bx: map.width, by: 0, r: 0, level: 0 });
  });

  it('knows what each post and wall is, so it can be knocked down as what it is', () => {
    const things = new Set(world.posts[0].map((p) => p.thing));
    for (const t of ['tree', 'lamp', 'signal', 'bollard'] as const) expect(things.has(t)).toBe(true);
    const kinds = new Set(world.walls[0].map((w) => w.kind).filter(Boolean));
    expect(kinds.has('wall')).toBe(true);
    // A building's walls have no kind: they don't break.
    expect(world.walls[0].filter((w) => !w.kind).length).toBeGreaterThan(1000);
  });

  it('makes benches, bins, picnic tables, grit bins, planters, blocks and trolleys loose, and lamp posts and trees fixed', () => {
    expect(world.loose.every((l) => ['bench', 'bin', 'picnic', 'gritbin', 'planter', 'block', 'trolley'].includes(l.kind))).toBe(true);
    // The heavy ones are hard to shift.
    expect(world.loose.find((l) => l.kind === 'block')!.invMass).toBeLessThan(1);
    expect(world.loose.length).toBeGreaterThan(100);
    expect(world.posts[0].length).toBeGreaterThan(map.trees.length / 4);
    expect(world.fixed.some((p) => p.kind === 'signals')).toBe(false);
    // Parking machines, bike stands and statues stand in the way.
    for (const thing of ['meter', 'bikes', 'statue']) expect(world.posts[0].some((p) => p.thing === thing)).toBe(true);
  });

  it('puts the gates and car park barriers across their ways, as walls that break', () => {
    const gates = world.walls[0].filter((w) => w.kind === 'gate' || w.kind === 'liftgate');
    expect(gates.length).toBeGreaterThan(30);
  });

  it('indexes each tree in the chunk it stands in', () => {
    const [x, y] = [map.trees[0], map.trees[1]];
    expect(world.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)))?.trees).toContain(0);
  });

  it('casts taller buildings\' shadows further, but not without end', () => {
    expect(shadowOffset(200)[0]).toBeGreaterThan(shadowOffset(80)[0]);
    expect(Math.hypot(...shadowOffset(5000))).toBeLessThanOrEqual(220);
  });
});

describe('subPolyline', () => {
  it('cuts out a stretch of a line by distance along it', () => {
    expect(subPolyline([0, 0, 100, 0, 100, 100], 50, 150)).toEqual([50, 0, 100, 0, 100, 50]);
    expect(subPolyline([0, 0, 100, 0], 20, 40)).toEqual([20, 0, 40, 0]);
  });
});

describe('SurfaceGrid', () => {
  it('reads back the surfaces from their painted colours, even blurred a little', () => {
    const paint = (s: Surface, blur = 0) => {
      const red = Number(surfacePaint(s).match(/\d+/)![0]) + blur;
      return [red, 0, 0, 255];
    };
    const pixels = new Uint8ClampedArray([...paint(Surface.Road), ...paint(Surface.Deep, -8), ...paint(Surface.Grass, 10), ...paint(Surface.Pavement)]);
    const grid = SurfaceGrid.fromPixels(pixels, 2, 2, 8);
    expect(grid.at(3, 3)).toBe(Surface.Road);
    expect(grid.at(12, 3)).toBe(Surface.Deep);
    expect(grid.at(3, 12)).toBe(Surface.Grass);
    expect(grid.at(-5, 3)).toBe(Surface.Pavement);
  });
});

describe('buildingLook', () => {
  // Just fans each polygon from its first point, which is right for the convex footprints here.
  const fan = (data: number[]) => {
    const out: number[] = [];
    for (let i = 1; i + 1 < data.length / 2; i++) out.push(0, i, i + 1);
    return out;
  };
  const house = { id: 7, rings: [[0, 0, 80, 0, 80, 40, 0, 40]], top: 64, bottom: 0, kind: 'house', solid: true, drawn: true };

  it('gives a house a pitched roof: two slopes, lit differently, with a ridge along its length', () => {
    const look = buildingLook(house, fan);
    expect(look.facets).toHaveLength(2);
    expect(look.facets[0].colour).not.toBe(look.facets[1].colour);
    const [ax, ay, bx, by] = look.ridge!;
    expect(ay).toBeCloseTo(20);
    expect(by).toBeCloseTo(20);
    expect(Math.abs(bx - ax)).toBeCloseTo(80);
  });

  it('gives an office a flat roof with a parapet, and windows', () => {
    const look = buildingLook({ ...house, kind: 'office', rings: [[0, 0, 300, 0, 300, 300, 0, 300]] }, fan);
    expect(look.facets).toHaveLength(1);
    expect(look.rim).not.toBeNull();
    expect(look.windows).not.toBeNull();
    expect(look.boxes.length).toBeGreaterThan(0);
  });

  it('points each wall outward, whichever way round the outline goes', () => {
    for (const ring of [house.rings[0], [0, 0, 0, 40, 80, 40, 80, 0]]) {
      const look = buildingLook({ ...house, rings: [ring] }, fan);
      for (const w of look.walls) {
        const mx = (w.ax + w.bx) / 2 + w.nx;
        const my = (w.ay + w.by) / 2 + w.ny;
        // A step out along the normal leaves the building.
        expect(mx < 0 || mx > 80 || my < 0 || my > 40).toBe(true);
      }
    }
  });

  it('uses the colours OSM gives', () => {
    expect(parseColour('#ff0000')).toBe(0xff0000);
    expect(parseColour('#f00')).toBe(0xff0000);
    expect(parseColour('LightGrey')).toBe(0xb5b4ae);
    expect(buildingLook({ ...house, roof: '#123456', kind: 'office' }, fan).facets[0].colour).toBe(0x123456);
  });

  it('cuts a polygon along a line', () => {
    const half = clipHalfPlane([0, 0, 80, 0, 80, 40, 0, 40], 0, 20, 1, 0, 1);
    const ys = half.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeCloseTo(20);
    expect(Math.max(...ys)).toBeCloseTo(40);
  });
});

describe('the map\'s extra detail', () => {
  it('has trees found by the LIDAR, each with its height', () => {
    expect(map.trees.length / 4).toBeGreaterThan(1000);
    for (let i = 3; i < map.trees.length; i += 4) expect(map.trees[i]).toBeGreaterThanOrEqual(4 * 8);
  });

  it('has most buildings\' heights measured', () => {
    expect(map.buildings.filter((b) => b.heightFrom === 'lidar').length).toBeGreaterThan(map.buildings.length / 2);
  });

  it('has the cobbles of King Street and Queen Square', () => {
    expect(map.roads.some((r) => r.name === 'King Street' && r.surface === 'sett')).toBe(true);
  });

  it('colours the landmarks, and their parts', () => {
    const cathedral = map.buildings.find((b) => b.name === 'Bristol Cathedral')!;
    expect(cathedral.roof).toBe('#6d7577');
    expect(map.buildings.filter((b) => b.roof === '#6d7577' && b.kind !== 'cathedral').length).toBeGreaterThan(5);
  });
});

describe('pointAlong', () => {
  // Along x, then turning a right angle down y.
  const bend = [0, 0, 100, 0, 100, 100];

  it('finds the point a distance along a line, and which way it runs there', () => {
    expect(pointAlong(bend, 50)).toEqual([50, 0, 1, 0]);
    const [x, y, tx, ty] = pointAlong(bend, 150);
    expect([x, y]).toEqual([100, 50]);
    expect([tx, ty]).toEqual([0, 1]);
    expect(lineLength(bend)).toBe(200);
  });

  it('turns smoothly round a bend when asked to', () => {
    const [, , tx, ty] = pointAlong(bend, 100, 10);
    expect(tx).toBeCloseTo(Math.SQRT1_2);
    expect(ty).toBeCloseTo(Math.SQRT1_2);
  });
});

describe('archways', () => {
  const road = (pts: number[], width = 56): Road => ({ kind: 'service', width, pts, passage: true });

  it('cuts a gap as wide as the road where it passes through a wall', () => {
    const wall = { ax: 0, ay: 100, bx: 400, by: 100, r: 0 };
    const pieces = cutWall(wall, [road([200, 0, 200, 300])]);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].bx).toBeCloseTo(172);
    expect(pieces[1].ax).toBeCloseTo(228);
  });

  it('leaves a wall the road doesn\'t cross alone', () => {
    const wall = { ax: 0, ay: 100, bx: 400, by: 100, r: 0 };
    expect(cutWall(wall, [road([600, 0, 600, 300])])).toEqual([wall]);
  });

  it('opens Bristol\'s buildings where its archways go under them', () => {
    const world = buildWorld(map);
    const passages = map.roads.filter((r) => r.passage && r.kind === 'service');
    expect(passages.length).toBeGreaterThan(5);
    // A point along each archway's road, inside its building: no wall right across the way.
    let open = 0;
    for (const p of passages) {
      const [x, y] = pointAlong(p.pts, lineLength(p.pts) / 2);
      const blocked = world.walls[0].some((w) => {
        const [nx, ny] = nearestOnSegment(x, y, w);
        return Math.hypot(nx - x, ny - y) < 4;
      });
      if (!blocked) open++;
    }
    expect(open / passages.length).toBeGreaterThan(0.8);
  });
});

describe('Decks', () => {
  // A bridge from (0, 0) to (800, 0), 80 px wide, with the ground rising 1 px per 10 eastwards.
  const bridge: Road = { kind: 'primary', width: 80, pts: [0, 0, 800, 0], bridge: true };
  const decks = new Decks([bridge], (x) => x / 10);

  it('runs from the ground\'s height at one end to its height at the other', () => {
    const [deck] = decks.decks;
    expect(decks.height(deck, 0)).toBe(0);
    expect(decks.height(deck, 400)).toBe(40);
    expect(decks.slope(deck, 400)[0]).toBeCloseTo(0.1);
  });

  it('takes a car onto it only at its ends, and off it once it\'s off the deck', () => {
    // Driving across underneath, in the middle: still on the ground.
    expect(decks.levelAt(0, 400, 0)).toBe(0);
    // Driving on at an end.
    expect(decks.levelAt(0, DECK_END / 2, 0)).toBe(1);
    // Along it, it stays up.
    expect(decks.levelAt(1, 400, 0)).toBe(1);
    // Off the far end, down again.
    expect(decks.levelAt(1, 900, 0)).toBe(0);
  });

  it('follows the height the LIDAR measured along it, meeting the ground at its ends', () => {
    // An arched footbridge 64 px long over level ground: up 16 px in the middle, measured every 16 px, a little off at the ends.
    const arch: Road = { kind: 'footway', width: 24, pts: [0, 0, 64, 0], bridge: true, deck: [2, 10, 16, 10, 2] };
    const level = new Decks([arch], () => 0);
    const [deck] = level.decks;
    // Both ends 2 px above the ground, taken up over DECK_END from each.
    expect(level.height(deck, 32)).toBeCloseTo(16 - 2 * 2 * Math.max(0, 1 - 32 / DECK_END));
    expect(level.height(deck, 0)).toBeCloseTo(0);
    expect(level.height(deck, 64)).toBeCloseTo(0);
    expect(level.slope(deck, 16)[0]).toBeGreaterThan(0);
    expect(level.slope(deck, 48)[0]).toBeLessThan(0);
  });

  it('has parapets along both sides, open at the ends; none on the bits it runs on onto the land (into a junction), up to 16 m', () => {
    const span = (d: Decks) => {
      const walls = d.parapets();
      return [walls.length, Math.min(...walls.map((w) => Math.min(w.ax, w.bx))), Math.max(...walls.map((w) => Math.max(w.ax, w.bx)))];
    };
    // Over a river from 60 to 340 px (3 m down), a 400 px bridge: on the land at either end.
    const short: Road = { kind: 'primary', width: 80, pts: [0, 0, 400, 0], bridge: true };
    const [n, from, to] = span(new Decks([short], (x) => x / 10 - (x > 60 && x < 340 ? 24 : 0)));
    expect(n).toBe(2);
    expect(from).toBeGreaterThan(40);
    expect(from).toBeLessThan(70);
    expect(to).toBeGreaterThan(330);
    expect(to).toBeLessThan(360);
    // The river further in: no more than 16 m's taken off either end.
    const [, far0, far1] = span(new Decks([bridge], (x) => x / 10 - (x > 300 && x < 500 ? 24 : 0)));
    expect(far0).toBeLessThan(16 * 8 + 1);
    expect(far1).toBeGreaterThan(800 - 16 * 8 - 1);
    // Over the water (level with it, as the survey can have it), it's up off it all the same.
    const [, wet0, wet1] = span(new Decks([short], () => 0, (x) => x > 60 && x < 340));
    expect(wet0).toBeLessThan(70);
    expect(wet1).toBeGreaterThan(330);
    // All of it on the ground as the survey has it (a flyover the survey sees as the ground): all of it, as ever.
    expect(span(decks)).toEqual([2, 0, 800]);
  });

  it('casts a shadow along it, fading to nothing towards an end on the ground', () => {
    const short: Road = { kind: 'primary', width: 80, pts: [0, 0, 400, 0], bridge: true };
    const river = new Decks([short], (x) => x / 10 - (x > 60 && x < 340 ? 24 : 0));
    const [d] = river.decks;
    expect(river.shadowAt(d, 10)).toBe(0);
    expect(river.shadowAt(d, 200)).toBe(SHADOW_HEIGHT);
    expect(river.shadowAt(d, 70)).toBeGreaterThan(0);
    expect(river.shadowAt(d, 70)).toBeLessThan(SHADOW_HEIGHT);
  });

  it('joins a pavement mapped as a bridge of its own beside a road\'s: no parapets between them, the gap paved over', () => {
    // A road 10 m wide along y = 0, a pavement 2 m wide 1.5 m off its side (its middle at y = 60).
    const road: Road = { kind: 'primary', width: 80, pts: [0, 0, 800, 0], bridge: true };
    const side: Road = { kind: 'footway', width: 16, pts: [0, 60, 800, 60], bridge: true };
    /** The parapets' lines (y) across the middle. */
    const lines = (d: Decks) => d.parapets().filter((w) => w.ax < 400 && w.bx > 400 || w.bx < 400 && w.ax > 400).map((w) => Math.round(w.ay));
    const joined = new Decks([road, side], () => 0);
    expect(lines(joined).sort((a, b) => a - b)).toEqual([-42, 70]);
    expect(joined.edges(joined.decks[0]).joins.length).toBeGreaterThan(0);
    // In the gap, it's on a deck.
    expect(joined.over(400, 46)).not.toBeNull();
    // The pavement 5 m higher: not joined, a parapet each side of both.
    const high = new Decks([road, { ...side, deck: Array(51).fill(40) }], () => 0);
    expect(lines(high)).toHaveLength(4);
    expect(high.over(400, 46)).toBeNull();
  });

  it('finds Park Street\'s bridge over Frogmore Street in Bristol', () => {
    const bristol = new Decks(map.roads, () => 0);
    expect(bristol.decks.some((d) => d.road.name === 'Park Street')).toBe(true);
  });
});

describe('arcades and roofs', () => {
  it("opens a building's wall along an arcade running under its front, but not the wall behind", () => {
    // A wall 200 px long running east; an arcade path 1 m inside it, along it; a back wall 10 m further in.
    const arcade: Road = { kind: 'footway', width: 19, pts: [20, 8, 180, 8], passage: true, arcade: true };
    const front = cutWall({ ax: 0, ay: 0, bx: 200, by: 0, r: 0 }, [arcade]);
    expect(front.every((piece) => piece.bx <= 30 || piece.ax >= 170)).toBe(true);
    expect(cutWall({ ax: 0, ay: 80, bx: 200, by: 80, r: 0 }, [arcade])).toHaveLength(1);
  });

  it("hatches a roof's seams or courses across the inside of its outline", () => {
    const lines = hatch([[0, 0, 40, 0, 40, 20, 0, 20]], 1, 0, 5);
    expect(lines.length / 4).toBe(4);
    for (let i = 0; i < lines.length; i += 4) expect([lines[i], lines[i + 2]]).toEqual([0, 40]);
  });
});

describe('buildings a way goes into', () => {
  // A building 25 m square (0 to 200 px).
  const square = [[0, 0, 200, 0, 200, 200, 0, 200]];
  const way = (pts: number[], width = 56, kind: Road['kind'] = 'service'): Road => ({ kind, width, pts });
  /** Whether a straight line crosses any of the walls. */
  const blocked = (walls: { ax: number; ay: number; bx: number; by: number }[], ax: number, ay: number, bx: number, by: number) =>
    walls.some((w) => {
      const d = (bx - ax) * (w.by - w.ay) - (by - ay) * (w.bx - w.ax);
      if (Math.abs(d) < 1e-9) return false;
      const t = ((w.ax - ax) * (w.by - w.ay) - (w.ay - ay) * (w.bx - w.ax)) / d;
      const u = ((w.ax - ax) * (by - ay) - (w.ay - ay) * (bx - ax)) / d;
      return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    });
  const length = (walls: { ax: number; ay: number; bx: number; by: number }[]) => walls.reduce((n, w) => n + Math.hypot(w.bx - w.ax, w.by - w.ay), 0);

  it('through it: open where the way is, and walled along its sides inside (not into the rest of the building)', () => {
    const walls = buildingWalls(square, [way([-100, 100, 300, 100])], 0);
    // Along the way, and along beside its middle: nothing in the way.
    for (const y of [100, 80, 120]) expect(blocked(walls, -50, y, 250, y)).toBe(false);
    // Off it, into the building: walled off (by its side, inside).
    expect(blocked(walls, 100, 100, 100, 40)).toBe(true);
    expect(blocked(walls, 100, 100, 100, 160)).toBe(true);
    // The rest of the building's walls stand.
    expect(blocked(walls, -20, 30, 60, 30)).toBe(true);
  });

  it('a path to its door (it stops at the wall): the building stays shut', () => {
    const walls = buildingWalls(square, [way([-100, 100, 0, 100], 16, 'footway')], 0);
    expect(length(walls)).toBeCloseTo(800, 0);
    expect(blocked(walls, -20, 100, 20, 100)).toBe(true);
  });

  it('a way that goes in and ends inside: in as far as it goes, closed off at its end', () => {
    const walls = buildingWalls(square, [way([-100, 100, 80, 100])], 0);
    expect(blocked(walls, -50, 100, 70, 100)).toBe(false);
    expect(blocked(walls, 70, 100, 150, 100)).toBe(true);
  });

  it('across a corner of it (it overlaps the way): passable where the way is, walled at its edge', () => {
    // A road 10 m wide along y = -20: its far half's over the building's edge.
    const walls = buildingWalls(square, [way([-100, -20, 300, -20], 80)], 0);
    expect(blocked(walls, -50, 10, 250, 10)).toBe(false);
    expect(blocked(walls, 100, 10, 100, 60)).toBe(true);
  });

  it("only just over a way's edge (less than half a metre): left as it is", () => {
    const walls = buildingWalls(square, [way([-100, -26, 300, -26])], 0);
    expect(length(walls)).toBeCloseTo(800, 0);
  });
});
