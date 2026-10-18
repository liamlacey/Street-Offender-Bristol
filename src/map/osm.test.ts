import { describe, expect, it } from 'vitest';
import { PX_PER_METRE, Projection, buildMap, clipLine, clipRing, joinRings, metres, parseOsm, ringArea, roadWidth } from './osm';

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
    expect(anchor.pavement).toBe(true);
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
    expect(map.trees).toHaveLength(3);
    expect(map.props).toEqual([expect.objectContaining({ kind: 'bench' })]);
    expect(map.crossings).toEqual([expect.objectContaining({ zebra: true, width: 80 })]);
  });

  it('starts the car on the nearest road, along it', () => {
    expect(Math.abs(map.spawn.y - map.height / 2)).toBeLessThan(2);
    expect(Math.abs(Math.cos(map.spawn.heading))).toBeCloseTo(1, 2);
  });
});
