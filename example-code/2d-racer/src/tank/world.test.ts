import { describe, expect, it } from 'vitest';
import type { ThingKind, ThingSpec } from './kinds';
import { MAX_FIRES, World, type WorldEvent } from './world';

const at = (kind: ThingKind, x: number, y = 0): ThingSpec => ({ kind, x, y, angle: 0, variant: 0 });
/** Never random: fires always catch and spread. */
const sure = () => 0;
const types = (events: WorldEvent[]) => events.map((e) => e.type);
/** Runs time on, collecting what happens. */
const run = (world: World, seconds: number) => {
  const events: WorldEvent[] = [];
  for (let t = 0; t < seconds; t += 0.05) events.push(...world.update(0.05));
  return events;
};

describe('the tank world', () => {
  it('splits a tree with a direct hit, sets it alight, and leaves ash', () => {
    const world = new World([at('oak', 0)], sure);
    const tree = world.things[0];
    const events = world.blast(0, 0, 70, 60, tree);
    expect(types(events)).toEqual(expect.arrayContaining(['explode', 'split', 'ignite']));
    expect(tree.phase).toBe('wrecked');
    expect(World.blocks(tree)).toBe(false);
    expect(types(run(world, 15))).toContain('burntOut');
    expect(tree.burnt).toBe(true);
    expect(tree.fire).toBe(0);
  });

  it('cracks rock first, then crumbles it to rubble; stone never burns', () => {
    const world = new World([at('boulder', 0)], sure);
    const rock = world.things[0];
    expect(types(world.blast(0, 0, 70, 60, rock))).toContain('damaged');
    expect(rock.phase).toBe('damaged');
    expect(World.blocks(rock)).toBe(true);
    expect(types(world.blast(0, 0, 70, 60, rock))).toContain('crumble');
    expect(rock.phase).toBe('wrecked');
    expect(World.blocks(rock)).toBe(false);
    expect(rock.fire).toBe(0);
  });

  it('brings a house down into burning rubble, which burns out as a ruin', () => {
    const world = new World([at('house', 0)], sure);
    const house = world.things[0];
    const events = world.blast(0, 0, 70, 80, house);
    expect(types(events)).toEqual(expect.arrayContaining(['collapse', 'ignite']));
    expect(house.phase).toBe('wrecked');
    run(world, 25);
    expect(house.burnt).toBe(true);
  });

  it('blows a car up, and the blast sets off the barrel next to it', () => {
    const world = new World([at('car', 0), at('barrel', 60), at('rock', 400)], sure);
    const [car, barrel, rock] = world.things;
    world.blast(0, 0, 70, 60, car);
    expect(car.phase).toBe('wrecked');
    // It goes off a moment later...
    const later = run(world, 1);
    const blasts = later.filter((e) => e.type === 'explode');
    expect(blasts.map((e) => e.type === 'explode' && e.thing)).toEqual(expect.arrayContaining([car, barrel]));
    // ...and burns out as a wreck that still blocks the way.
    expect(barrel.phase).toBe('gone');
    expect(World.blocks(car)).toBe(true);
    expect(rock.phase).toBe('intact');
    expect(car.fire).toBeGreaterThan(0);
  });

  it('spreads fire through the trees but not to rocks, and only so far at once', () => {
    const specs = [at('pine', 0), at('pine', 40), at('pine', 80), at('rock', 120)];
    const world = new World(specs, sure);
    world.ignite(world.things[0], []);
    run(world, 3);
    expect(world.things[2].fire > 0 || world.things[2].burnt).toBe(true);
    expect(world.things[3].fire).toBe(0);
    const forest = new World(Array.from({ length: 400 }, (_, k) => at('oak', (k % 20) * 40, Math.floor(k / 20) * 40)), sure);
    forest.ignite(forest.things[0], []);
    for (let t = 0; t < 20; t += 0.05) {
      forest.update(0.05);
      expect(forest.fires.size).toBeLessThanOrEqual(MAX_FIRES);
    }
  });

  it('flattens bushes, fences and crates under the tank without fire, but a barrel still goes up', () => {
    const world = new World([at('bush', 0), at('fence', 100), at('crate', 200), at('barrel', 300)], sure);
    const [bush, fence, crate, barrel] = world.things;
    expect(types(world.crush(bush))).toContain('split');
    expect(bush.fire).toBe(0);
    expect(types(world.crush(fence))).toContain('splinter');
    expect(fence.phase).toBe('gone');
    world.crush(crate);
    expect(crate.phase).toBe('gone');
    world.crush(barrel);
    expect(types(run(world, 0.5))).toContain('explode');
  });

  it('only hurts what the blast reaches, less at its edge', () => {
    const world = new World([at('boulder', 0), at('boulder', 120), at('boulder', 400)], sure);
    world.blast(0, 0, 150, 60);
    const [a, b, c] = world.things;
    expect(a.hp).toBeLessThan(b.hp);
    expect(b.hp).toBeLessThan(b.def.hp);
    expect(c.hp).toBe(c.def.hp);
  });

  it('runs a wildfire through a field from one shot, and into the trees beyond (flattened crops never burn)', () => {
    const specs: ThingSpec[] = [];
    for (let x = 0; x < 8; x++) for (let y = 0; y < 5; y++) specs.push({ kind: 'crop', x: x * 40, y: y * 40, angle: 0, variant: 0 });
    specs.push(at('oak', 8 * 40 + 10, 80));
    const world = new World(specs, () => 0.1);
    const crops = world.things.filter((t) => t.kind === 'crop');
    const flat = crops[39];
    world.crush(flat);
    expect(flat.flattened).toBe(true);
    world.blast(0, 0, 80, 60, crops[0]);
    run(world, 60);
    expect(crops.filter((t) => t.burnt && !t.flattened).length).toBe(39);
    expect(world.things.find((t) => t.kind === 'oak')!.burnt).toBe(true);
    expect(flat.phase).toBe('wrecked');
    expect(flat.fire).toBe(0);
  });
});
