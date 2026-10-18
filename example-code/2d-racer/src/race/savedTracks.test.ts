import { beforeEach, describe, expect, it } from 'vitest';
import { LOCATIONS } from '../locations/locations';
import { generateTrack } from '../track/generate';
import { CLASSIC, deleteTrack, listTracks, saveTrack, suggestName } from './savedTracks';

/** A minimal in-memory localStorage for Node. */
function installStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  return store;
}

describe('saved tracks', () => {
  beforeEach(() => installStorage());

  it('always lists the built-in classic first', () => {
    expect(listTracks()).toEqual([CLASSIC]);
  });

  it('saves a track exactly, newest first, and deletes it', () => {
    const def = generateTrack(LOCATIONS.docklands, 'short', 7);
    const first = saveTrack('Harbour Loop', 'docklands', 'short', def)!;
    const second = saveTrack('  Quayside  ', 'docklands', 'long', generateTrack(LOCATIONS.docklands, 'long', 8))!;
    expect(second.name).toBe('Quayside');
    const list = listTracks();
    expect(list.map((t) => t.name)).toEqual(['Docklands Classic', 'Quayside', 'Harbour Loop'].filter(Boolean));
    expect(list.find((t) => t.id === first.id)!.definition.points).toEqual(def.points);
    deleteTrack(first.id);
    expect(listTracks().map((t) => t.name)).toEqual(['Docklands Classic', 'Quayside']);
  });

  it('suggests the next free name', () => {
    expect(suggestName('Docklands')).toBe('Docklands 1');
    saveTrack('Docklands 1', 'docklands', 'short', generateTrack(LOCATIONS.docklands, 'short', 1));
    expect(suggestName('Docklands')).toBe('Docklands 2');
  });

  it('ignores broken stored data instead of crashing', () => {
    localStorage.setItem('2d-racer:tracks', '{not json');
    expect(listTracks()).toEqual([CLASSIC]);
    localStorage.setItem('2d-racer:tracks', JSON.stringify([{ id: 1 }, null]));
    expect(listTracks()).toEqual([CLASSIC]);
  });
});
