import { describe, expect, it } from 'vitest';
import { BREAKUP, THINGS } from './damage';
import { HUT_PRICE, PERSON_MOST, THING_PRICE, VEHICLE_PRICE, dentPrice, loosePrice, partPrice, personPrice, pounds, treePrice } from './bill';

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

  it('someone knocked down costs more the faster you were going, and more again driven over', () => {
    expect(personPrice('hit', 1.5)).toBeGreaterThanOrEqual(1_000);
    expect(personPrice('hit', 1.5)).toBeLessThan(3_000);
    expect(personPrice('hit', 9)).toBeGreaterThan(10_000);
    expect(personPrice('hit', 25)).toBeGreaterThan(personPrice('hit', 9) * 3);
    expect(personPrice('over', 9)).toBeGreaterThan(personPrice('hit', 9));
    expect(personPrice('hit', 45)).toBeLessThan(PERSON_MOST);
  });

  it('reads as pounds', () => {
    expect(pounds(1234567.4)).toBe('£1,234,567');
    expect(pounds(0)).toBe('£0');
  });
});
