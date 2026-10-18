/**
 * Best lap per saved track (by track id), saved in the browser. Storage can be
 * unavailable (private browsing, blocked site data), so failures are ignored
 * and the game carries on.
 */

const key = (trackId: string) => `2d-racer:best-lap:${trackId}`;

export function loadBestLap(trackId: string): number | null {
  try {
    const value = Number(localStorage.getItem(key(trackId)));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function saveBestLap(trackId: string, seconds: number): void {
  try {
    localStorage.setItem(key(trackId), String(seconds));
  } catch {
    // Not saved; the best lap still shows for this session.
  }
}
