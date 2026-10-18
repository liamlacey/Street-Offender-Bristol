import { describe, expect, it } from 'vitest';
import { PX_PER_METRE, Projection, buildMap, clipLine, clipRing, joinRings, areaKind, cutSpans, roadKind, laneArrows, lanesAcross, metres, parseOsm, pavementSides, ringArea, roadLanes, roadWidth, sidewalkAlong } from './osm';

/** A tiny map: a street with a junction, a building with a part on it, a pond, a park inside a multipolygon, a tree and a bench. */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
 <bounds minlat="51.4500" minlon="-2.6010" maxlat="51.4510" maxlon="-2.5990"/>
 <node id="1" lat="51.4505" lon="-2.6020"/>
 <node id="2" lat="51.4505" lon="-2.6000"/>
 <node id="3" lat="51.4505" lon="-2.5980"/>
 <node id="4" lat="51.4510" lon="-2.6000"/>
 <node id="10" lat="51.4502" lon="-2.6005"/>
 <node id="11" lat="51.4502" lon="-2.6002"/>
 <node id="12" lat="51.4500" lon="-2.6002"/>
 <node id="13" lat="51.4500" lon="-2.6005"/>
 <node id="20" lat="51.4508" lon="-2.5998"><tag k="natural" v="tree"/></node>
 <node id="21" lat="51.4507" lon="-2.5999"><tag k="amenity" v="bench"/></node>
 <node id="22" lat="51.4505" lon="-2.5995"><tag k="highway" v="crossing"/><tag k="crossing" v="zebra"/></node>
 <node id="30" lat="51.4509" lon="-2.6008"/>
 <node id="31" lat="51.4509" lon="-2.6006"/>
 <node id="32" lat="51.4507" lon="-2.6006"/>
 <node id="33" lat="51.4507" lon="-2.6008"/>
 <way id="100"><nd ref="1"/><nd ref="2"/><nd ref="22"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="name" v="Anchor Road"/></way>
 <way id="101"><nd ref="2"/><nd ref="4"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way>
 <way id="102"><nd ref="10"/><nd ref="11"/><nd ref="12"/><nd ref="13"/><nd ref="10"/><tag k="building" v="office"/><tag k="building:levels" v="5"/></way>
 <way id="103"><nd ref="10"/><nd ref="11"/><nd ref="12"/><nd ref="13"/><nd ref="10"/><tag k="building:part" v="yes"/><tag k="height" v="30"/></way>
 <way id="104"><nd ref="30"/><nd ref="31"/><nd ref="32"/></way>
 <way id="105"><nd ref="32"/><nd ref="33"/><nd ref="30"/></way>
 <relation id="200"><member type="way" ref="104" role="outer"/><member type="way" ref="105" role="outer"/><tag k="type" v="multipolygon"/><tag k="leisure" v="park"/></relation>
</osm>`;

describe('parseOsm', () => {
  it('reads nodes, ways, relations and tags', () => {
    const data = parseOsm(XML);
    expect(data.bounds).toEqual({ minlat: 51.45, minlon: -2.601, maxlat: 51.451, maxlon: -2.599 });
    expect(data.nodes.get(20)?.tags.natural).toBe('tree');
    expect(data.ways.get(100)?.nodes).toEqual([1, 2, 22, 3]);
    expect(data.relations.get(200)?.members).toHaveLength(2);
  });

  it('unescapes XML in values', () => {
    const data = parseOsm(`<osm><node id="1" lat="0" lon="0"><tag k="name" v="Pero&apos;s Bridge &amp; Co"/></node></osm>`);
    expect(data.nodes.get(1)?.tags.name).toBe("Pero's Bridge & Co");
  });
});

describe('geometry', () => {
  it('projects to metres east and south of the corner', () => {
    const p = new Projection(51.45, -2.6);
    // A thousandth of a degree north is about 111 m; east, about 69.5 m at this latitude.
    expect(p.y(51.449) / PX_PER_METRE).toBeCloseTo(111.2, 0);
    expect(p.x(-2.599) / PX_PER_METRE).toBeCloseTo(69.5, 0);
  });

  it('clips rings and lines to a rectangle', () => {
    const square = [-10, -10, 10, -10, 10, 10, -10, 10];
    expect(Math.abs(ringArea(clipRing(square, 0, 0, 100, 100)))).toBeCloseTo(100);
    const pieces = clipLine([-10, 5, 50, 5, 50, 200], 0, 0, 100, 100);
    expect(pieces).toEqual([[0, 5, 50, 5, 50, 100]]);
  });

  it('joins a multipolygon\'s ways into rings, either way round', () => {
    expect(joinRings([[1, 2, 3], [1, 4, 3]])).toEqual([[1, 2, 3, 4, 1]]);
  });

  it('reads lengths in metres or feet', () => {
    expect(metres('12')).toBe(12);
    expect(metres('12 m')).toBe(12);
    expect(metres("10'")).toBeCloseTo(3.048);
    expect(metres('tall')).toBeUndefined();
  });

  it('makes roads as wide as their lanes', () => {
    expect(roadWidth('primary', {})).toBe(10);
    expect(roadWidth('primary', { lanes: '4' })).toBeCloseTo(13.2);
    expect(roadWidth('service', { service: 'driveway' })).toBe(3.5);
  });
});

describe('buildMap', () => {
  const map = buildMap(parseOsm(XML), {
    bounds: { minlat: 51.45, minlon: -2.601, maxlat: 51.451, maxlon: -2.599 },
    start: { lat: 51.4505, lon: -2.6001 },
  });

  it('makes the map the size of the area', () => {
    expect(map.width / PX_PER_METRE).toBeCloseTo(139, 0);
    expect(map.height / PX_PER_METRE).toBeCloseTo(111, 0);
  });

  it('keeps the roads, with markings stopping short of the junction', () => {
    const anchor = map.roads.find((r) => r.name === 'Anchor Road')!;
    expect(anchor.kind).toBe('primary');
    expect(anchor.width).toBe(80);
    expect(anchor.pavement).toBe('both');
    // The junction is at node 2, about 139 m along (the road starts beyond the map): no markings near it.
    const junction = 139 * PX_PER_METRE;
    for (let k = 0; k < anchor.marks!.length; k += 2) {
      const [a, b] = [anchor.marks![k], anchor.marks![k + 1]];
      expect(b < junction - 40 || a > junction + 40).toBe(true);
    }
    expect(map.roads.find((r) => r.kind === 'street')?.oneway).toBe(true);
  });

  it('draws a building\'s parts instead of its outline, and you hit the parts', () => {
    const outline = map.buildings.find((b) => b.id === 102)!;
    const part = map.buildings.find((b) => b.id === 103)!;
    expect(outline.drawn).toBe(false);
    expect(outline.solid).toBe(false);
    expect(part.solid).toBe(true);
    expect(part.top).toBe(30 * PX_PER_METRE);
  });

  it('assembles multipolygon areas', () => {
    expect(map.areas.map((a) => a.kind)).toEqual(['park']);
  });

  it('keeps trees, props and crossings', () => {
    expect(map.trees).toHaveLength(4);
    expect(map.props).toEqual([expect.objectContaining({ kind: 'bench' })]);
    expect(map.crossings).toEqual([expect.objectContaining({ kind: 'zebra', width: 80 })]);
  });

  it('starts the car on the nearest road, along it', () => {
    expect(Math.abs(map.spawn.y - map.height / 2)).toBeLessThan(2);
    expect(Math.abs(Math.cos(map.spawn.heading))).toBeCloseTo(1, 2);
  });
});

describe('pavements', () => {
  it('reads which sides of a road have them, both unless told otherwise', () => {
    expect(pavementSides({})).toEqual([true, true]);
    expect(pavementSides({ sidewalk: 'both' })).toEqual([true, true]);
    expect(pavementSides({ sidewalk: 'left' })).toEqual([true, false]);
    expect(pavementSides({ sidewalk: 'right' })).toEqual([false, true]);
    expect(pavementSides({ sidewalk: 'no' })).toEqual([false, false]);
    expect(pavementSides({ sidewalk: 'separate' })).toEqual([false, false]);
    expect(pavementSides({ 'sidewalk:both': 'separate' })).toEqual([false, false]);
    expect(pavementSides({ 'sidewalk:left': 'separate', 'sidewalk:right': 'yes' })).toEqual([false, true]);
    expect(pavementSides({ 'sidewalk:right': 'no' })).toEqual([true, false]);
  });

  it("finds a pavement mapped as a footpath of its own along one side, and doesn't draw one there too", () => {
    // A road 8 m wide running east (left of it is north, y down), and a footpath 5.5 m north of its middle.
    const road = [0, 0, 400, 0];
    const footpath = [-20, -44, 420, -44];
    expect(sidewalkAlong(road, 64, 1, [footpath])).toBe(true);
    expect(sidewalkAlong(road, 64, -1, [footpath])).toBe(false);
    // One crossing it isn't one along it.
    expect(sidewalkAlong(road, 64, 1, [[200, -100, 200, 100]])).toBe(false);
    // Nor is one along only a little of it.
    expect(sidewalkAlong(road, 64, 1, [[0, -44, 80, -44]])).toBe(false);
  });
});

describe('road markings', () => {
  it('puts bus lanes at the kerb on the side their traffic keeps to', () => {
    // One-way: on the left. Two-way, going the way's way: on its left; against it, on its right.
    expect(roadLanes({ 'lanes:psv': '1', lanes: '2' }, true, 64)).toEqual([{ side: 1, kind: 'bus', width: 26 }]);
    expect(roadLanes({ 'lanes:psv:backward': '1' }, false, 80)!.map((l) => l.side)).toEqual([-1]);
    // Just "one bus lane" on a two-way road doesn't say which side: none drawn.
    expect(roadLanes({ 'lanes:psv': '1' }, false, 80)).toBeUndefined();
  });

  it('reads cycle lanes, dashed or solid, and bikes sharing a bus lane or the road', () => {
    const lanes = roadLanes({ 'cycleway:left': 'lane', 'cycleway:left:lane': 'exclusive', 'cycleway:right': 'share_busway', 'lanes:psv:backward': '1' }, false, 80)!;
    expect(lanes.find((l) => l.kind === 'cycle')).toMatchObject({ side: 1, solid: true });
    expect(lanes.find((l) => l.kind === 'bus')).toMatchObject({ side: -1, bikes: true });
    expect(roadLanes({ cycleway: 'shared_lane' }, false, 64)!.map((l) => l.kind)).toEqual(['shared', 'shared']);
  });

  it('reads parking bays along the kerb, but not lay-bys off the road', () => {
    expect(roadLanes({ 'parking:lane:left': 'parallel', 'parking:left:restriction': 'loading_only' }, false, 64)).toEqual([{ side: 1, kind: 'parking', width: 16, bays: 'parallel', loading: true }]);
    expect(roadLanes({ 'parking:lane:right': 'perpendicular', 'parking:lane:right:perpendicular': 'street_side' }, false, 64)).toBeUndefined();
  });

  it('cuts the stretches lanes are painted along round junctions, and drops what is too short to paint', () => {
    // 100 m of road, a junction 30 m along (cut 6 m either side): 24 m kept before it, 64 m after; 4 m cut out of the end.
    expect(cutSpans([0, 800], [[192, 288], [768, 800]])).toEqual([0, 192, 288, 768]);
    expect(cutSpans([0, 800], [[40, 760]])).toEqual([]);
  });

  it('counts the lanes each way, for the lines between them, only where a side has more than one', () => {
    expect(lanesAcross({ lanes: '2' }, false)).toBeUndefined();
    expect(lanesAcross({ lanes: '4', 'lanes:forward': '3' }, false)).toEqual([3, 1]);
    expect(lanesAcross({ lanes: '3' }, true)).toEqual([3, 0]);
  });

  it("paints each lane's arrow before the junction, left to right as the driver sees them", () => {
    // A one-way road 100 m long running east, two lanes: through on the left (north), right on the right.
    const arrows = laneArrows({ 'turn:lanes': 'through|right' }, true, 64, [0, 0, 800, 0]);
    const near = arrows.filter((a) => a.x === 800 - 15 * PX_PER_METRE);
    expect(near.map((a) => a.turns)).toEqual(['through', 'right']);
    expect(near[0].y).toBeLessThan(near[1].y);
    expect(near[0].angle).toBeCloseTo(0);
  });
});

describe('roads being built', () => {
  it("takes one being built or mended as what it'll be", () => {
    expect(roadKind({ highway: 'construction', construction: 'footway', bridge: 'movable' })).toBe('footway');
    expect(roadKind({ highway: 'construction' })).toBeNull();
  });
});

describe('the harbour', () => {
  it('tells a floating pontoon from a pier on legs', () => {
    expect(areaKind({ man_made: 'pier', floating: 'yes' })).toBe('pontoon');
    expect(areaKind({ man_made: 'pier' })).toBe('pier');
    expect(areaKind({ man_made: 'pier', floating: 'no' })).toBe('pier');
    expect(areaKind({ amenity: 'fuel' })).toBe('forecourt');
  });
});

describe('petrol stations, however they are mapped', () => {
  // A road along the bottom, and a canopy 24 m by 8 m (about) near the middle of a small map.
  const base = (extra: string) => `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
 <node id="1" lat="51.4500" lon="-2.6010"/>
 <node id="2" lat="51.4500" lon="-2.5990"/>
 <way id="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
 <node id="11" lat="51.45050" lon="-2.60018"/>
 <node id="12" lat="51.45050" lon="-2.59982"/>
 <node id="13" lat="51.45057" lon="-2.59982"/>
 <node id="14" lat="51.45057" lon="-2.60018"/>
 ${extra}
</osm>`;
  const canopy = (tags: string) => `<way id="10"><nd ref="11"/><nd ref="12"/><nd ref="13"/><nd ref="14"/><nd ref="11"/><tag k="building" v="roof"/>${tags}</way>`;
  const build = (xml: string) =>
    buildMap(parseOsm(xml), { bounds: { minlat: 51.4498, minlon: -2.6012, maxlat: 51.4508, maxlon: -2.5988 }, start: { lat: 51.45, lon: -2.6 } });
  const station = (m: ReturnType<typeof build>) => ({
    canopies: m.buildings.filter((b) => b.fuel).length,
    pumps: m.props.filter((p) => p.kind === 'pump').length,
    forecourts: m.areas.filter((a) => a.kind === 'forecourt').length,
  });

  it('makes a canopy on a mapped forecourt the station, with pumps under it', () => {
    const court = `<node id="21" lat="51.45040" lon="-2.60030"/><node id="22" lat="51.45040" lon="-2.59970"/><node id="23" lat="51.45067" lon="-2.59970"/><node id="24" lat="51.45067" lon="-2.60030"/>
 <way id="20"><nd ref="21"/><nd ref="22"/><nd ref="23"/><nd ref="24"/><nd ref="21"/><tag k="amenity" v="fuel"/></way>`;
    const m = station(build(base(canopy('') + court)));
    expect(m).toMatchObject({ canopies: 1, forecourts: 1 });
    // A canopy about 25 m long: four islands, two pumps each.
    expect(m.pumps).toBe(8);
  });

  it('finds the canopy near a station mapped as a point, and makes it a forecourt', () => {
    const m = station(build(base(canopy('') + '<node id="30" lat="51.45045" lon="-2.60000"><tag k="amenity" v="fuel"/></node>')));
    expect(m).toMatchObject({ canopies: 1, forecourts: 1 });
    expect(m.pumps).toBeGreaterThan(0);
  });

  it('takes a canopy tagged as the station as the station', () => {
    expect(station(build(base(canopy('<tag k="amenity" v="fuel"/>'))))).toMatchObject({ canopies: 1, forecourts: 1 });
  });

  it('puts pumps in the middle of a forecourt with no canopy mapped', () => {
    const court = `<node id="21" lat="51.45020" lon="-2.60040"/><node id="22" lat="51.45020" lon="-2.59960"/><node id="23" lat="51.45045" lon="-2.59960"/><node id="24" lat="51.45045" lon="-2.60040"/>
 <way id="20"><nd ref="21"/><nd ref="22"/><nd ref="23"/><nd ref="24"/><nd ref="21"/><tag k="amenity" v="fuel"/></way>`;
    const m = station(build(base(court)));
    expect(m).toMatchObject({ canopies: 0, forecourts: 1 });
    expect(m.pumps).toBeGreaterThan(0);
  });

  it("leaves a canopy that's nothing to do with a petrol station alone", () => {
    expect(station(build(base(canopy(''))))).toEqual({ canopies: 0, pumps: 0, forecourts: 0 });
  });
});
