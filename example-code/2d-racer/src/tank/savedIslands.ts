/**
 * Tank World islands the player has saved, kept in the browser. An island is
 * made from its seed, so that's what's kept (with a name); loading one builds
 * it again from the seed, fresh, before anything was blown up.
 *
 * Storage can be unavailable (private browsing, blocked site data); then
 * nothing is listed or saved, and the game carries on.
 */

export interface SavedIsland {
  id: string;
  name: string;
  seed: number;
  /** ms since 1970, for ordering. */
  savedAt: number;
}

const KEY = '2d-racer:islands';
export const MAX_ISLAND_NAME = 24;

/** Newest first. */
export function listIslands(): SavedIsland[] {
  return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export function saveIsland(name: string, seed: number): SavedIsland | null {
  const island: SavedIsland = {
    id: `i${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: name.trim().slice(0, MAX_ISLAND_NAME) || 'Untitled',
    seed,
    savedAt: Date.now(),
  };
  return writeAll([...readAll(), island]) ? island : null;
}

export function deleteIsland(id: string): void {
  writeAll(readAll().filter((t) => t.id !== id));
}

/** A made-up island name from its seed, like "Port Marrow" or "Isle of Tarn", to suggest when saving. */
export function islandName(seed: number): string {
  const start = ['Mar', 'Tal', 'Bren', 'Ash', 'Kel', 'Dun', 'Rav', 'Sel', 'Tor', 'Wen', 'Fal', 'Cor', 'Hal', 'Lin', 'Por'];
  const end = ['row', 'mouth', 'holm', 'wick', 'ey', 'more', 'ness', 'by', 'ton', 'dale', 'gard', 'stead', 'en', 'ar'];
  const form = ['Isle of #', '# Island', 'Port #', '#', 'Little #', 'Great #'];
  const pick = <T>(list: T[], k: number) => list[Math.abs(Math.floor(seed / k)) % list.length];
  const word = pick(start, 1) + pick(end, 7);
  const taken = new Set(readAll().map((t) => t.name));
  const name = pick(form, 97).replace('#', word);
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`)) return `${name} ${n}`;
}

function readAll(): SavedIsland[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isSavedIsland) : [];
  } catch {
    return [];
  }
}

function writeAll(islands: SavedIsland[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(islands));
    return true;
  } catch {
    return false;
  }
}

/** Guards against stored data from an older or broken version. */
function isSavedIsland(value: unknown): value is SavedIsland {
  const t = value as SavedIsland;
  return typeof t === 'object' && t !== null && typeof t.id === 'string' && typeof t.name === 'string' && Number.isFinite(t.seed);
}
