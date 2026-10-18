import { describe, expect, it } from 'vitest';
import { KINDS } from './kinds';
import { BIOME, COLS, SIZE, YARD, biomeAt, cellOf, generateIsland, harbourPoint, heightAt, townReach } from './island';

// (Islands are big, and take a few seconds each to make.)
const SEEDS = [1, 42, 31337];

describe.each(SEEDS)('island %i', { timeout: 60_000 }, (seed) => {
  const island = generateIsland(seed);

  it('comes out the same every time from its seed', () => {
    const again = generateIsland(seed);
    expect(again.things.length).toBe(island.things.length);
    expect(again.things[10]).toEqual(island.things[10]);
  });

  it('is an island: sea all round the edge, with beaches, plains, forest and mountains', () => {
    for (let k = 0; k < SIZE; k += 200) {
      for (const [x, y] of [[k, 5], [k, SIZE - 5], [5, k], [SIZE - 5, k]]) expect(biomeAt(island, x, y)).toBe(BIOME.deep);
    }
    const share = (b: number) => island.biomes.filter((v) => v === b).length / (COLS * COLS);
    const land = 1 - share(BIOME.deep) - share(BIOME.shallow);
    expect(land).toBeGreaterThan(0.25);
    expect(share(BIOME.beach)).toBeGreaterThan(0.005);
    expect(share(BIOME.grass)).toBeGreaterThan(0.03);
    expect(share(BIOME.forest)).toBeGreaterThan(0.03);
    expect(share(BIOME.hills) + share(BIOME.rock) + share(BIOME.snow)).toBeGreaterThan(0.02);
  });

  it('has villages joined up by tracks on dry land', () => {
    expect(island.villages.length).toBeGreaterThanOrEqual(3);
    expect(island.tracks.length).toBeGreaterThanOrEqual(island.villages.length - 1);
    for (const v of island.villages) {
      expect(island.tracks.some((t) => [t[0], t[t.length - 1]].some((p) => Math.hypot(p.x - v.x, p.y - v.y) < 1))).toBe(true);
    }
    for (const track of island.tracks) {
      // (Rounding a corner, a track can clip the edge of the snow.)
      let snow = 0;
      for (const p of track) {
        const b = biomeAt(island, p.x, p.y);
        expect(b).not.toBe(BIOME.deep);
        if (b === BIOME.snow) snow++;
      }
      expect(snow).toBeLessThan(Math.max(8, track.length * 0.05));
    }
    expect(island.things.filter((t) => t.kind === 'house').length).toBeGreaterThan(15);
    expect(island.things.some((t) => t.kind === 'fueltank')).toBe(true);
  });

  it('puts things on dry land (boats on the water), off the tracks, not on top of each other', () => {
    const counts: Record<string, number> = {};
    for (const t of island.things) {
      counts[t.kind] = (counts[t.kind] ?? 0) + 1;
      if (KINDS[t.kind].material === 'bridge') continue;
      const b = biomeAt(island, t.x, t.y);
      const wet = b === BIOME.deep || b === BIOME.shallow;
      expect(wet || b === BIOME.river).toBe(t.kind === 'boat' || t.kind === 'trawler');
      expect(island.roads[cellOf(t.x, t.y)]).toBe(0);
    }
    for (const kind of ['oak', 'pine', 'rock', 'house', 'car', 'barn', 'boat'] as const) expect(counts[kind]).toBeGreaterThan(0);
    // No two solid things overlapping (looked up by area: there are thousands).
    const solid = island.things.filter((t) => KINDS[t.kind].solid);
    const cells = new Map<string, typeof solid>();
    const key = (x: number, y: number) => `${Math.floor(x / 128)},${Math.floor(y / 128)}`;
    for (const t of solid) cells.set(key(t.x, t.y), [...(cells.get(key(t.x, t.y)) ?? []), t]);
    let overlaps = 0;
    for (const a of solid) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const b of cells.get(key(a.x + dx * 128, a.y + dy * 128)) ?? []) {
            if (a !== b && Math.hypot(a.x - b.x, a.y - b.y) < KINDS[a.kind].r + KINDS[b.kind].r) overlaps++;
          }
        }
      }
    }
    expect(overlaps).toBe(0);
  });

  it('has a town or two: streets on a grid, terraced houses and shops along them, a church and a fountain', () => {
    expect(island.towns.length).toBeGreaterThanOrEqual(1);
    const streets = island.roadKinds.filter((k) => k === 'street').length;
    expect(streets).toBeGreaterThanOrEqual(10);
    expect(island.roadKinds).toContain('road');
    const count = (kind: string) => island.things.filter((t) => t.kind === kind).length;
    expect(count('townhouse')).toBeGreaterThan(20);
    expect(count('shop')).toBeGreaterThan(4);
    // (Each town's church and fountain, where they fit.)
    expect(count('church')).toBeGreaterThanOrEqual(1);
    expect(count('church')).toBeLessThanOrEqual(island.towns.length);
    expect(count('fountain')).toBeGreaterThanOrEqual(1);
  });

  it('has rivers running down to the sea, and a bridge wherever a road crosses one', () => {
    for (const river of island.rivers) {
      const mouth = river.path[river.path.length - 1];
      expect(heightAt(island.heights, mouth.x, mouth.y)).toBeLessThan(0);
      expect(river.path.length).toBeGreaterThan(20);
    }
    const bridges = island.things.filter((t) => KINDS[t.kind].material === 'bridge');
    for (const track of island.tracks) {
      for (const p of track) {
        if (biomeAt(island, p.x, p.y) !== BIOME.river) continue;
        const over = bridges.some((b) => {
          const along = (p.x - b.x) * Math.cos(b.angle) + (p.y - b.y) * Math.sin(b.angle);
          const across = -(p.x - b.x) * Math.sin(b.angle) + (p.y - b.y) * Math.cos(b.angle);
          return Math.abs(along) < b.length! / 2 && Math.abs(across) < 30;
        });
        expect(over).toBe(true);
      }
    }
  });

  it('has fields of crops and meadows of long grass, laid edge to edge so fire can run through them', () => {
    const crops = island.things.filter((t) => t.kind === 'crop');
    const grass = island.things.filter((t) => t.kind === 'grass');
    expect(crops.length).toBeGreaterThan(100);
    expect(grass.length).toBeGreaterThan(100);
    // (Nearly) every patch has a neighbour in its field, a row along.
    const sample = crops.slice(0, 100);
    const joined = sample.filter((t) => crops.some((n) => n !== t && Math.hypot(n.x - t.x, n.y - t.y) < 41));
    expect(joined.length).toBeGreaterThan(sample.length * 0.9);
  });

  it('has beach huts and sunshades on the beaches, campsites and forestry in the woods', () => {
    const of = (kind: string) => island.things.filter((t) => t.kind === kind);
    expect(of('beachhut').length).toBeGreaterThan(10);
    for (const p of of('parasol')) expect(biomeAt(island, p.x, p.y)).toBe(BIOME.beach);
    for (const fire of of('campfire')) {
      expect(biomeAt(island, fire.x, fire.y)).toBe(BIOME.forest);
      expect(of('tent').filter((t) => Math.hypot(t.x - fire.x, t.y - fire.y) < 60).length).toBeGreaterThanOrEqual(1);
      // A clearing: no trees right round it.
      expect(island.things.some((t) => (t.kind === 'oak' || t.kind === 'pine') && Math.hypot(t.x - fire.x, t.y - fire.y) < 70)).toBe(false);
    }
    expect(of('campfire').length).toBeGreaterThan(3);
    expect(of('harvester').length).toBeGreaterThanOrEqual(1);
    expect(of('stump').length).toBeGreaterThan(10);
  });

  it('has ski lifts from below the snow line up to the peaks, with a station at each end', () => {
    expect(island.lifts.length).toBeGreaterThanOrEqual(1);
    for (const { bottom, top } of island.lifts) {
      expect(biomeAt(island, top.x, top.y)).toBe(BIOME.snow);
      expect(heightAt(island.heights, top.x, top.y)).toBeGreaterThan(heightAt(island.heights, bottom.x, bottom.y) + 0.2);
      expect(island.things.some((t) => t.kind === 'liftstation' && Math.hypot(t.x - bottom.x, t.y - bottom.y) < 1)).toBe(true);
    }
  });

  it('has harbours: a yard on dry land with warehouses and cranes, jetties out over open water, boats tied up, and a road in', () => {
    expect(island.harbours.length).toBeGreaterThanOrEqual(3);
    const of = (kind: string) => island.things.filter((t) => t.kind === kind);
    for (const h of island.harbours) {
      const yard = harbourPoint(h, 0, YARD.depth / 2);
      const near = (kind: string, r: number) => of(kind).filter((t) => Math.hypot(t.x - yard.x, t.y - yard.y) < r).length;
      expect(near('warehouse', 300)).toBeGreaterThanOrEqual(1);
      expect(near('crane', 300)).toBeGreaterThanOrEqual(1);
      expect(near('jetty', 450)).toBe(3);
      const tip = harbourPoint(h, 0, -150);
      expect([BIOME.deep, BIOME.shallow]).toContain(biomeAt(island, tip.x, tip.y));
      const gate = harbourPoint(h, 0, YARD.depth + 70);
      expect(island.tracks.some((t) => [t[0], t[t.length - 1]].some((p) => Math.hypot(p.x - gate.x, p.y - gate.y) < 1))).toBe(true);
    }
    expect(of('trawler').length + of('boat').length).toBeGreaterThan(island.harbours.length);
  });

  it('has footpaths through the woods and up the hills, on dry land, clear of trees', () => {
    expect(island.trails.length).toBeGreaterThan(20);
    const trees = island.things.filter((t) => t.kind === 'oak' || t.kind === 'pine');
    const cells = new Set(trees.map((t) => `${Math.floor(t.x / 64)},${Math.floor(t.y / 64)}`));
    let blocked = 0;
    let points = 0;
    for (const trail of island.trails.slice(0, 40)) {
      for (const p of trail) {
        const b = biomeAt(island, p.x, p.y);
        expect(b === BIOME.deep || b === BIOME.shallow || b === BIOME.river).toBe(false);
        points++;
        if (!cells.has(`${Math.floor(p.x / 64)},${Math.floor(p.y / 64)}`)) continue;
        if (trees.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < 8)) blocked++;
      }
    }
    expect(blocked).toBeLessThan(points * 0.01);
  });

  it('has one big city: avenues through the middle, towers and offices, parks', () => {
    const cities = island.towns.filter((t) => t.city);
    expect(cities.length).toBe(1);
    const city = cities[0];
    expect(city.blocks.u).toBeGreaterThanOrEqual(3);
    expect(island.roadKinds.filter((k) => k === 'avenue').length).toBe(2);
    const near = (kind: string) => island.things.filter((t) => t.kind === kind && Math.hypot(t.x - city.x, t.y - city.y) < townReach(city)).length;
    expect(near('tower')).toBeGreaterThanOrEqual(4);
    expect(near('office')).toBeGreaterThanOrEqual(10);
    expect(city.parks!.length).toBeGreaterThanOrEqual(2);
  });

  it('joins roads that meet into junctions, and lays roads that run together as one', () => {
    expect(island.junctions.length).toBeGreaterThan(island.villages.length);
    // No two roads running alongside each other a few px apart for long (they'd have been laid as one).
    let parallel = 0;
    const sample = island.tracks.slice(0, 60);
    for (const [a, track] of sample.entries()) {
      for (let k = 0; k < track.length; k += 4) {
        const p = track[k];
        // (How far it is from the other road's line, not its nearest point.)
        const off = (other: { x: number; y: number }[]) => {
          let best = Infinity;
          for (let n = 0; n < other.length - 1; n++) {
            const q = other[n];
            const r = other[n + 1];
            const len = Math.hypot(r.x - q.x, r.y - q.y) || 1;
            const t = Math.max(0, Math.min(1, ((p.x - q.x) * (r.x - q.x) + (p.y - q.y) * (r.y - q.y)) / (len * len)));
            best = Math.min(best, Math.hypot(q.x + (r.x - q.x) * t - p.x, q.y + (r.y - q.y) * t - p.y));
          }
          return best;
        };
        if (sample.some((other, b) => b !== a && off(other) > 4 && off(other) < 14)) parallel++;
      }
    }
    const points = sample.reduce((n, t) => n + Math.ceil(t.length / 4), 0);
    expect(parallel).toBeLessThan(points * 0.15);
  });

  it('has farms by their fields: a barn, silos, and crops in rows', () => {
    expect(island.farms.length).toBeGreaterThan(5);
    expect(island.farms.filter((f) => f.fields.length > 0).length).toBeGreaterThan(island.farms.length * 0.8);
    for (const f of island.farms.slice(0, 20)) {
      expect(island.things.some((t) => t.kind === 'barn' && Math.hypot(t.x - f.x, t.y - f.y) < 120)).toBe(true);
    }
    const silos = island.farms.filter((f) => island.things.some((t) => t.kind === 'silo' && Math.hypot(t.x - f.x, t.y - f.y) < 200));
    expect(silos.length).toBeGreaterThan(island.farms.length * 0.7);
  });

  it('runs a track out to the road from the farms, campsites and forestry', () => {
    // (Some are right by a road already.)
    const served = (x: number, y: number, r: number) => {
      for (let a = 0; a < 16; a++) {
        for (let d = 0; d <= r; d += 16) if (island.roads[cellOf(x + Math.cos((a / 16) * Math.PI * 2) * d, y + Math.sin((a / 16) * Math.PI * 2) * d)]) return true;
      }
      return false;
    };
    const check = (places: { x: number; y: number }[], r: number) => {
      const reached = places.filter((p) => served(p.x, p.y, r)).length;
      expect(reached).toBeGreaterThanOrEqual(places.length * 0.65);
    };
    check(island.farms, 260);
    check(island.things.filter((t) => t.kind === 'campfire'), 130);
    check(island.things.filter((t) => t.kind === 'harvester'), 160);
  });

  it('has a railway loop round the towns, a station by each, and bridges where it crosses rivers', () => {
    const r = island.railway!;
    expect(r).not.toBeNull();
    expect(r.stations.length).toBeGreaterThanOrEqual(island.towns.length - 2);
    expect(island.things.filter((t) => t.kind === 'station').length).toBeGreaterThanOrEqual(r.stations.length - 2);
    // A loop: the last point near the first, and no sharp kinks.
    const first = r.line[0];
    const last = r.line[r.line.length - 1];
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeLessThan(80);
    const bridges = island.things.filter((t) => t.kind === 'railbridge');
    let wet = 0;
    for (const p of r.line) {
      const b = biomeAt(island, p.x, p.y);
      expect(b === BIOME.deep || b === BIOME.snow).toBe(false);
      // (Rounding a bend, it can just clip the edge of the shallows.)
      if (b === BIOME.shallow) wet++;
      if (b === BIOME.river) expect(bridges.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < t.length! / 2 + 10)).toBe(true);
    }
    expect(wet).toBeLessThan(r.line.length * 0.002);
    // Nothing standing on the line.
    for (const t of island.things) if (KINDS[t.kind].solid) expect(island.rails[cellOf(t.x, t.y)]).toBe(0);
  });

  it('starts the tank on open ground on a track', () => {
    const { x, y } = island.spawn;
    const b = biomeAt(island, x, y);
    expect(b === BIOME.deep || b === BIOME.shallow || b === BIOME.snow).toBe(false);
    for (const t of island.things) if (KINDS[t.kind].solid) expect(Math.hypot(t.x - x, t.y - y)).toBeGreaterThan(KINDS[t.kind].r + 30);
  });
});
