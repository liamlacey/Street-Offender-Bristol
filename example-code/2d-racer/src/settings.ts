/**
 * Player choices remembered between visits. Storage can be unavailable
 * (private browsing, blocked site data); then the defaults apply and nothing
 * breaks.
 */

import { MAX_OPPONENTS, MIN_OPPONENTS } from './ai/drivers';
import { LOCATIONS, type LocationId } from './locations/locations';
import { TRACK_DIFFICULTIES, TRACK_LENGTHS, type TrackDifficulty, type TrackLength } from './track/generate';

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

const KEYS = {
  muted: '2d-racer:muted',
  difficulty: '2d-racer:difficulty',
  laps: '2d-racer:laps',
  opponents: '2d-racer:opponents',
  length: '2d-racer:length',
  trackDifficulty: '2d-racer:track-difficulty',
  location: '2d-racer:location',
  gunForward: '2d-racer:tank-gun-forward',
  police: '2d-racer:tank-police',
};

export const MIN_LAPS = 1;
export const MAX_LAPS = 10;

export function loadMuted(): boolean {
  return read(KEYS.muted) === '1';
}

export function saveMuted(muted: boolean): void {
  write(KEYS.muted, muted ? '1' : '0');
}

/** Tank World: the tank's gun fixed pointing the way it's going, rather than aimed on its own. */
export function loadGunForward(): boolean {
  return read(KEYS.gunForward) === '1';
}

export function saveGunForward(forward: boolean): void {
  write(KEYS.gunForward, forward ? '1' : '0');
}

/** Whether the police come after the tank in Tank World (on unless switched off). */
export function loadPolice(): boolean {
  return read(KEYS.police) !== '0';
}

export function savePolice(on: boolean): void {
  write(KEYS.police, on ? '1' : '0');
}

export function loadDifficulty(): Difficulty {
  const value = read(KEYS.difficulty);
  return DIFFICULTIES.includes(value as Difficulty) ? (value as Difficulty) : 'medium';
}

export function saveDifficulty(difficulty: Difficulty): void {
  write(KEYS.difficulty, difficulty);
}

export function loadLaps(): number {
  const laps = Number(read(KEYS.laps));
  return Number.isInteger(laps) && laps >= MIN_LAPS && laps <= MAX_LAPS ? laps : 3;
}

export function saveLaps(laps: number): void {
  write(KEYS.laps, String(laps));
}

export function loadOpponents(): number {
  const n = Number(read(KEYS.opponents));
  return Number.isInteger(n) && n >= MIN_OPPONENTS && n <= MAX_OPPONENTS ? n : 3;
}

export function saveOpponents(n: number): void {
  write(KEYS.opponents, String(n));
}

export function loadLength(): TrackLength {
  const value = read(KEYS.length);
  return TRACK_LENGTHS.includes(value as TrackLength) ? (value as TrackLength) : 'medium';
}

export function saveLength(length: TrackLength): void {
  write(KEYS.length, length);
}

export function loadTrackDifficulty(): TrackDifficulty {
  const value = read(KEYS.trackDifficulty);
  return TRACK_DIFFICULTIES.includes(value as TrackDifficulty) ? (value as TrackDifficulty) : 'medium';
}

export function saveTrackDifficulty(difficulty: TrackDifficulty): void {
  write(KEYS.trackDifficulty, difficulty);
}

export function loadLocation(): LocationId {
  const value = read(KEYS.location);
  return value !== null && value in LOCATIONS ? (value as LocationId) : 'docklands';
}

export function saveLocation(location: LocationId): void {
  write(KEYS.location, location);
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered next time; it still applies now.
  }
}
