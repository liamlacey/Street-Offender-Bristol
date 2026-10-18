import { describe, expect, it } from 'vitest';
import { BIOME, COLS, CELL, type Island, SIZE } from './island';
import type { ThingKind, ThingSpec } from './kinds';
import { RELOAD, type TankInput, createTank, launch, stepRocket, stepTank, wantsToFire } from './tank';
import { World } from './world';

/** A flat grass island with the sea from x = 2000 on. */
function flatIsland(): Island {
  const biomes = new Uint8Array(COLS * COLS).fill(BIOME.grass);
  for (let y = 0; y < COLS; y++) for (let x = Math.floor(2000 / CELL); x < COLS; x++) biomes[y * COLS + x] = BIOME.deep;
  return {
    seed: 1,
    heights: new Float32Array(COLS * COLS),
    moisture: new Float32Array(COLS * COLS),
    biomes,
    roads: new Uint8Array(COLS * COLS),
    rails: new Uint8Array(COLS * COLS),
    railway: null,
    tracks: [],
    roadKinds: [],
    junctions: [],
    rivers: [],
    towns: [],
    harbours: [],
    trails: [],
    villages: [],
    farms: [],
    lifts: [],
    things: [],
    spawn: { x: 1000, y: 1000, angle: 0 },
  };
}
const at = (kind: ThingKind, x: number, y = 1000): ThingSpec => ({ kind, x, y, angle: 0, variant: 0 });
const forward: TankInput = { drive: null, throttle: 1, turn: 0, aim: 0, fire: false };
const drive = (island: Island, world: World, input: TankInput, seconds: number) => {
  const tank = createTank(island);
  for (let t = 0; t < seconds; t += 1 / 60) stepTank(tank, input, island, world, 1 / 60);
  return tank;
};

describe('the tank', () => {
  it('drives the way it points, and stops at deep water', () => {
    const island = flatIsland();
    const tank = drive(island, new World([]), forward, 10);
    expect(tank.x).toBeGreaterThan(1900);
    expect(tank.x).toBeLessThan(2000);
    expect(Math.abs(tank.y - 1000)).toBeLessThan(1);
  });

  it('turns to face the way a thumb stick points, then goes that way', () => {
    const tank = drive(flatIsland(), new World([]), { drive: { x: 0, y: 1 }, throttle: 0, turn: 0, aim: null, fire: false }, 3);
    expect(tank.y).toBeGreaterThan(1200);
    expect(Math.abs(tank.heading - Math.PI / 2)).toBeLessThan(0.05);
  });

  it('smashes through whatever it drives into, slowed by it: trees fall (no fire), houses come down, a fence is flattened', () => {
    const island = flatIsland();
    const world = new World([at('fence', 1100), at('oak', 1250), at('house', 1450), at('boulder', 1650)]);
    const tank = createTank(island);
    let slowest = Infinity;
    for (let t = 0; t < 10; t += 1 / 60) {
      stepTank(tank, forward, island, world, 1 / 60);
      if (tank.x > 1200 && tank.x < 1700) slowest = Math.min(slowest, Math.abs(tank.speed));
    }
    const [fence, oak, house, boulder] = world.things;
    expect(fence.phase).toBe('gone');
    expect(oak.phase).toBe('wrecked');
    expect(oak.fire).toBe(0);
    expect(house.phase).toBe('wrecked');
    expect(boulder.phase).toBe('wrecked');
    expect(tank.x).toBeGreaterThan(1750);
    expect(slowest).toBeLessThan(150);
  });

  it('wades across a river slowly, and crosses quickly by a bridge while it stands', () => {
    // A river from x = 1200 to 1400, across the whole island.
    const island = flatIsland();
    for (let y = 0; y < COLS; y++) for (let x = Math.floor(1200 / CELL); x < Math.ceil(1400 / CELL); x++) island.biomes[y * COLS + x] = BIOME.river;
    const wading = drive(island, new World([]), forward, 4);
    expect(wading.x).toBeGreaterThan(1400);
    const bridge: ThingSpec = { kind: 'stonebridge', x: 1300, y: 1000, angle: 0, variant: 0, length: 280 };
    const across = drive(island, new World([bridge]), forward, 4);
    expect(across.x).toBeGreaterThan(wading.x + 100);
    const world = new World([bridge]);
    const [b] = world.things;
    world.blast(b.x, b.y, 80, 200, b);
    expect(b.phase).toBe('wrecked');
    expect(drive(island, world, forward, 4).x).toBeCloseTo(wading.x, -1);
  });

  it('shoots a bridge down from off it, but flies over the one it was fired from', () => {
    const island = flatIsland();
    const world = new World([{ kind: 'bridge', x: 1300, y: 1000, angle: 0, variant: 0, length: 140 }]);
    const tank = createTank(island);
    const rocket = launch(tank, world);
    let boom = null;
    for (let k = 0; k < 100 && !boom; k++) boom = stepRocket(rocket, world, 1 / 60);
    expect(boom?.hit?.kind).toBe('bridge');
    const onIt = { ...tank, x: 1300, y: 1000 };
    const away = launch(onIt, world);
    let miss = null;
    for (let k = 0; k < 100 && !miss; k++) miss = stepRocket(away, world, 1 / 60);
    expect(miss?.hit).toBeNull();
  });

  it('fires only once reloaded', () => {
    const tank = createTank(flatIsland());
    const fire = { ...forward, fire: true };
    expect(wantsToFire(tank, fire)).toBe(true);
    expect(wantsToFire(tank, fire)).toBe(false);
    tank.reload = 0;
    expect(wantsToFire(tank, fire)).toBe(true);
    expect(tank.reload).toBe(RELOAD);
  });

  it('sends rockets into the first thing in their way, over bushes, or to the end of their range', () => {
    const world = new World([at('bush', 1100), at('oak', 1300), at('rock', 1500)]);
    const tank = createTank(flatIsland());
    const rocket = launch(tank);
    let boom = null;
    for (let k = 0; k < 100 && !boom; k++) boom = stepRocket(rocket, world, 1 / 60);
    expect(boom?.hit?.kind).toBe('oak');
    const empty = launch({ ...tank, turret: Math.PI / 2 });
    let miss = null;
    for (let k = 0; k < 200 && !miss; k++) miss = stepRocket(empty, world, 1 / 60);
    expect(miss?.hit).toBeNull();
    expect(miss!.y).toBeGreaterThan(1700);
    expect(miss!.y).toBeLessThan(SIZE);
  });
});
