/** Formats seconds as m:ss.cc, e.g. 83.456 → "1:23.45". */
export function formatTime(seconds: number): string {
  const centis = Math.floor(seconds * 100 + 1e-6);
  const m = Math.floor(centis / 6000);
  const s = Math.floor((centis % 6000) / 100);
  const c = centis % 100;
  return `${m}:${s.toString().padStart(2, '0')}.${c.toString().padStart(2, '0')}`;
}

/** Formats a time difference with a sign, e.g. -0.5 → "-0.50", 1.234 → "+1.23". */
export function formatDelta(seconds: number): string {
  return `${seconds < 0 ? '-' : '+'}${(Math.floor(Math.abs(seconds) * 100 + 1e-6) / 100).toFixed(2)}`;
}
