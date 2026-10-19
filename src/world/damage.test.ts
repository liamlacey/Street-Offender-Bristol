import { describe, expect, it } from 'vitest';
import { createCar } from '../car/CarPhysics';
import { THINGS, WALLS, breaks, crumble, debris, fallen, fallenTree, shards, toppleTime, BREAKUP, THINGS as STANDING, lyingTrunk, logs, gapFor, giveWay, impactSpeed, treeToughness } from './damage';

/** A car at (0, 0) heading east at `speed` px/s. */
const moving = (speed: number) => {
  const car = createCar(0, 0, 0);
  car.vx = speed;
  return car;
};

describe('what breaks', () => {
  it('takes a harder hit to bring down a bigger tree, and the biggest need the car flat out', () => {
    expect(treeToughness(6).strength).toBeLessThan(treeToughness(20).strength);
    expect(breaks(treeToughness(6), 250)).toBe(true);
    expect(breaks(treeToughness(25), 250)).toBe(false);
    expect(breaks(treeToughness(25), 400)).toBe(false);
  });

  it('knocks a lamp post over at a fair speed, but not a postbox', () => {
    expect(breaks(THINGS.lamp, 180)).toBe(true);
    expect(breaks(THINGS.postbox, 180)).toBe(false);
  });

  it('never breaks a stump (it is driven over); a fountain, a statue and a crane only with a very big hit', () => {
    expect(breaks(THINGS.stump, 1e6)).toBe(false);
    for (const thing of ['fountain', 'statue', 'crane'] as const) {
      expect(breaks(THINGS[thing], 250)).toBe(false);
      expect(breaks(THINGS[thing], 350)).toBe(true);
    }
  });

  it('breaks things more easily with a heavier vehicle', () => {
    expect(breaks(THINGS.bollard, 150)).toBe(false);
    expect(breaks(THINGS.bollard, 150, 2)).toBe(true);
  });

  it('goes through a fence far more easily than a stone wall', () => {
    expect(WALLS.fence.strength).toBeLessThan(WALLS.wall.strength / 2);
  });
});

describe('hitting things', () => {
  it('measures how fast the car is going into something it touches, and not something it isn\'t', () => {
    expect(impactSpeed(moving(200), 20, 0, 3)).toBeCloseTo(200);
    expect(impactSpeed(moving(200), -20, 0, 3)).toBe(0);
    expect(impactSpeed(moving(200), 200, 0, 3)).toBe(0);
  });

  it('slows the car more breaking through something heavy', () => {
    const tree = moving(300);
    giveWay(tree, treeToughness(10));
    const fence = moving(300);
    giveWay(fence, WALLS.fence);
    expect(tree.vx).toBeLessThan(fence.vx);
    expect(fence.vx).toBeGreaterThan(200);
  });
});

describe('what\'s left', () => {
  it('knocks a gap in a wall where it\'s hit, leaving the rest standing', () => {
    const wall = { ax: 0, ay: 0, bx: 200, by: 0, r: 2 };
    const { left, from, to } = crumble(wall, 100, 3, 20);
    expect(left).toHaveLength(2);
    expect(left[0].bx).toBeCloseTo(90);
    expect(left[1].ax).toBeCloseTo(110);
    expect(from[0]).toBeCloseTo(90);
    expect(to[0]).toBeCloseTo(110);
  });

  it('brings down more of a wall the harder it\'s hit', () => {
    expect(gapFor('wall', 400)).toBeGreaterThan(gapFor('wall', 210));
  });

  it('scatters the pieces the way the car was going', () => {
    let s = 1;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const bits = debris('plank', 6, 0, 0, 300, 0, rand);
    expect(bits).toHaveLength(6);
    for (const b of bits) expect(b.vx).toBeGreaterThan(0);
  });

  it("strews a hedge's clumps and twigs about, light enough to be kicked along", () => {
    const leaves = debris('foliage', 4, 0, 0, 300, 0, () => 0.5);
    const [plank] = debris('plank', 1, 0, 0, 300, 0, () => 0.5);
    expect(leaves).toHaveLength(4);
    expect(leaves[0].invMass).toBeGreaterThan(plank.invMass);
  });

  it("leaves a fallen lamp's glass where its lamp hit the ground, and none from a bollard", () => {
    const glass = shards('lamp', 0, 0, 300, 0, () => 0.5);
    expect(glass.length).toBeGreaterThan(4);
    for (const g of glass) expect(g.x).toBeGreaterThan(30);
    expect(shards('bollard', 0, 0, 300, 0, () => 0.5)).toHaveLength(0);
  });

  it("doesn't count what's moving away from the car as hard", () => {
    expect(impactSpeed(moving(200), 20, 0, 3, 150, 0)).toBeCloseTo(50);
  });

  it('breaks a fallen trunk into logs along it, far more easily than the tree standing', () => {
    const pieces = logs({ ax: 0, ay: 0, bx: 66, by: 0, r: 3 }, 300, 0, () => 0.5);
    expect(pieces).toHaveLength(3);
    expect(pieces.map((p) => Math.round(p.x))).toEqual([11, 33, 55]);
    for (const metres of [4, 9, 20]) {
      const lying = lyingTrunk(treeToughness(metres)).strength;
      expect(lying).toBeLessThan(treeToughness(metres).strength * 0.6);
      expect(BREAKUP.log!.strength).toBeLessThan(lying);
    }
  });

  it('breaks smaller pieces into smaller ones still, and the smallest not at all', () => {
    expect(BREAKUP.log!.into.map(([kind]) => kind)).toContain('billet');
    expect(BREAKUP.billet!.into.map(([kind]) => kind)).toEqual(['splinter']);
    expect(BREAKUP.splinter).toBeUndefined();
    // Each piece is weaker than what it broke off.
    for (const piece of Object.values(BREAKUP)) {
      for (const [kind] of piece!.into) if (BREAKUP[kind]) expect(BREAKUP[kind]!.strength).toBeLessThan(piece!.strength);
    }
    expect(BREAKUP.pole!.strength).toBeLessThan(STANDING.lamp.strength);
    expect(BREAKUP.phonebox!.strength).toBeLessThan(STANDING.phone.strength);
    expect(BREAKUP.glass).toBeUndefined();
  });

  it('topples the new street furniture, with glass from what has a screen or a face; statues come off their plinths in pieces', () => {
    expect(fallen('meter', 0, 0, 300, 0, () => 0.5).map((d) => d.kind)).toEqual(['meter']);
    expect(fallen('lifering', 0, 0, 300, 0, () => 0.5).map((d) => d.kind)).toEqual(['post', 'ring']);
    expect(shards('meter', 0, 0, 300, 0, () => 0.5).length).toBeGreaterThan(0);
    expect(shards('bikes', 0, 0, 300, 0, () => 0.5)).toHaveLength(0);
    expect(fallen('statue', 0, 0, 400, 0, () => 0.5).some((d) => d.kind === 'rubble')).toBe(true);
  });

  it('breaks a gate or a car park barrier all at once, the barrier far more easily', () => {
    const { left } = crumble({ ax: 0, ay: 0, bx: 36, by: 0, r: 1 }, 18, 0, gapFor('gate', 200));
    expect(left).toHaveLength(0);
    expect(WALLS.liftgate.strength).toBeLessThan(WALLS.gate.strength);
  });

  it('shoves a concrete block more than it breaks it', () => {
    expect(BREAKUP.block!.strength).toBeGreaterThan(BREAKUP.gritbin!.strength);
    expect(BREAKUP.block!.strength).toBeGreaterThan(BREAKUP.picnic!.strength);
  });

  it('topples tall things more slowly than short ones', () => {
    expect(toppleTime(1)).toBeLessThan(toppleTime(5.5));
    expect(toppleTime(5.5)).toBeLessThan(toppleTime(9));
    expect(toppleTime(40)).toBe(1.6);
  });

  it('lays a fallen lamp post along the way it was hit', () => {
    const [pole] = fallen('lamp', 0, 0, 0, 300, () => 0.5);
    expect(pole.kind).toBe('pole');
    expect(pole.y).toBeGreaterThan(10);
    expect(pole.angle).toBeCloseTo(Math.PI / 2);
  });

  it('fells a tree the way it was hit, and away from the side it was hit on', () => {
    // Hit going east by a car passing a little north of it (y is down): it falls east and to the south.
    const { trunk, crownX, crownY, angle } = fallenTree(0, 0, 80, 300, 0, -30, -5);
    expect(Math.hypot(trunk.bx, trunk.by)).toBeCloseTo(60);
    expect(crownX).toBeGreaterThan(30);
    expect(crownY).toBeGreaterThan(20);
    expect(angle).toBeGreaterThan(0.3);
    // From the other side, the other way.
    expect(fallenTree(0, 0, 80, 300, 0, -30, 5).crownY).toBeLessThan(-20);
  });
});
