/**
 * Tracks the player has saved, kept in the browser. A saved track stores its
 * actual shape (the generated control points), not just the seed it came
 * from, so it stays exactly the same even if the generator changes later.
 *
 * Storage can be unavailable (private browsing, blocked site data); then
 * nothing is listed or saved, and the game carries on.
 */

import { LOCATIONS, type LocationId } from '../locations/locations';
import type { TrackLength } from '../track/generate';
import type { TrackDefinition } from '../track/Track';
import { TRACKS } from '../track/tracks';

export interface SavedTrack {
  id: string;
  name: string;
  location: LocationId;
  length: TrackLength;
  /** ms since 1970, for ordering. */
  savedAt: number;
  definition: TrackDefinition;
  /** Built into the game: always listed, can't be deleted. */
  builtIn?: boolean;
}

const KEY = '2d-racer:tracks';
export const MAX_NAME_LENGTH = 24;

/**
 * The original hand-made layout. Its id is the old track name, so best laps
 * set before tracks could be saved still show against it.
 */
export const CLASSIC: SavedTrack = {
  id: 'Docklands',
  name: 'Docklands Classic',
  location: 'docklands',
  length: 'medium',
  savedAt: 0,
  definition: TRACKS[0],
  builtIn: true,
};

/** Built-in tracks first, then the player's, newest first. */
export function listTracks(): SavedTrack[] {
  return [CLASSIC, ...readAll().sort((a, b) => b.savedAt - a.savedAt)];
}

export function saveTrack(
  name: string,
  location: LocationId,
  length: TrackLength,
  definition: TrackDefinition,
): SavedTrack | null {
  const track: SavedTrack = {
    id: `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: name.trim().slice(0, MAX_NAME_LENGTH) || 'Untitled',
    location,
    length,
    savedAt: Date.now(),
    definition: { ...definition, name: name.trim().slice(0, MAX_NAME_LENGTH) || 'Untitled' },
  };
  return writeAll([...readAll(), track]) ? track : null;
}

export function deleteTrack(id: string): void {
  writeAll(readAll().filter((t) => t.id !== id));
}

/** A name suggestion like "Docklands 3" for the next saved track at a location. */
export function suggestName(locationName: string): string {
  const taken = new Set(readAll().map((t) => t.name));
  for (let n = 1; ; n++) if (!taken.has(`${locationName} ${n}`)) return `${locationName} ${n}`;
}

function readAll(): SavedTrack[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isSavedTrack) : [];
  } catch {
    return [];
  }
}

function writeAll(tracks: SavedTrack[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(tracks));
    return true;
  } catch {
    return false;
  }
}

/** Guards against stored data from an older or broken version. */
function isSavedTrack(value: unknown): value is SavedTrack {
  const t = value as SavedTrack;
  return (
    typeof t === 'object' &&
    t !== null &&
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    typeof t.location === 'string' &&
    t.location in LOCATIONS &&
    Array.isArray(t.definition?.points) &&
    t.definition.points.length >= 3
  );
}
