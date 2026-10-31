import { describe, expect, it } from 'vitest';
import { BREAKUP, THINGS } from './damage';
import { HUT_PRICE, THING_PRICE, VEHICLE_PRICE, dentPrice, loosePrice, partPrice, pounds, treePrice } from './bill';

describe('the damage bill', () => {
  it('prices everything that can be knocked down, and every loose thing that can be smashed', () => {
    for (const kind of Object.keys(THINGS)) expect(THING_PRICE[kind as keyof typeof THING_PRICE]).toBeGreaterThanOrEqual(0);
    expect(THING_PRICE.lamp).toBeGreaterThan(THING_PRICE.bollard);
    for (const kind of Object.keys(BREAKUP)) expect(loosePrice(kind)).toBeGreaterThanOrEqual(0);
    expect(loosePrice('bench')).toBeGreaterThan(0);
    // (The pieces of what's broken are already paid for; fly-tipped rubbish isn't anyone's.)
    expect(loosePrice('rubble')).toBe(0);
    expect(loosePrice('mattress')).toBe(0);
    expect(HUT_PRICE).toBeGreaterThan(loosePrice('shed'));
  });

  it('a taller tree costs more', () => {
    expect(treePrice(20)).toBeGreaterThan(treePrice(6));
  });

  it("a dent costs more the harder it is, nothing for none, and never more than the vehicle's worth", () => {
    expect(dentPrice('hatch', 0)).toBe(0);
    expect(dentPrice('hatch', 60)).toBeGreaterThan(dentPrice('hatch', 20));
    expect(dentPrice('hatch', 10_000)).toBe(VEHICLE_PRICE.hatch);
    expect(dentPrice('bus', 60)).toBeGreaterThan(dentPrice('hatch', 60));
    expect(partPrice('bumperFront')).toBeGreaterThan(partPrice('hubcap'));
  });

  it('reads as pounds', () => {
    expect(pounds(1234567.4)).toBe('£1,234,567');
    expect(pounds(0)).toBe('£0');
  });
});
