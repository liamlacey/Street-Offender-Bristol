/**
 * A read-out of how smoothly the game's running, turned on with `?perf` on
 * the address: frames a second, the longest frame (and how many were long),
 * what the longest was spent on, and the slowest parts of the frame (each
 * part's average and longest, ms; and any part that held a frame up),
 * over the last second. Drawn over the game (a few lines of text at the top),
 * changed once a second. Off, it costs nothing: `start` and `stop` return
 * at once.
 */

import * as Phaser from 'phaser';

export const PERF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');

/** A frame longer than this, ms, is a stutter (two frames at 60 a second, missed). */
const LONG = 25;

const parts = new Map<string, { total: number; most: number; began: number }>();
let box: HTMLDivElement | undefined;
let frames = 0;
let long = 0;
let worst = 0;
let last = 0;
let since = 0;
/** This frame's parts, ms; and the longest frame's (of the last second), the biggest first. */
const frame = new Map<string, number>();
let worstParts: [string, number][] = [];

/** The time spent in a part of the frame, from `start` to `stop` (by name). */
export function start(name: string): void {
  if (!PERF) return;
  let p = parts.get(name);
  if (!p) parts.set(name, (p = { total: 0, most: 0, began: 0 }));
  p.began = performance.now();
}

export function stop(name: string): void {
  if (!PERF) return;
  const p = parts.get(name);
  if (!p) return;
  const t = performance.now() - p.began;
  p.total += t;
  p.most = Math.max(p.most, t);
  frame.set(name, (frame.get(name) ?? 0) + t);
}

/** Times every frame of the game, start to start (rendering included), and the whole of the step and the rendering. */
export function watch(game: Phaser.Game): void {
  if (!PERF) return;
  box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed',
    // (Top middle: clear of the pause button and RESET.)
    left: '50%',
    top: '4px',
    transform: 'translateX(-50%)',
    zIndex: '10',
    font: '10px/1.25 monospace',
    color: '#fff',
    background: 'rgba(0,0,0,0.55)',
    padding: '2px 4px',
    pointerEvents: 'none',
    whiteSpace: 'pre',
  });
  document.body.appendChild(box);
  game.events.on(Phaser.Core.Events.PRE_STEP, () => {
    const now = performance.now();
    if (last) {
      const t = now - last;
      frames++;
      if (t > worst) {
        worst = t;
        worstParts = [...frame].filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]);
      }
      if (t > LONG) long++;
    }
    frame.clear();
    last = now;
    start('step');
    if (now - since >= 1000) show(now);
  });
  game.events.on(Phaser.Core.Events.PRE_RENDER, () => {
    stop('step');
    start('render');
  });
  game.events.on(Phaser.Core.Events.POST_RENDER, () => stop('render'));
}

function show(now: number): void {
  const secs = since ? (now - since) / 1000 : 1;
  since = now;
  if (!box || !frames) return;
  // The slowest on average; and any that held a frame up, however rarely.
  const rows = [...parts].sort((a, b) => b[1].total - a[1].total).filter(([, p], i) => i < 12 || p.most >= 8).slice(0, 16);
  box.textContent = [
    `${Math.round(frames / secs)} fps · longest ${worst.toFixed(0)} ms · ${long} over ${LONG} ms`,
    // What the longest frame was spent on.
    `longest: ${worstParts.slice(0, 5).map(([name, v]) => `${name} ${v.toFixed(0)}`).join(' ')}`,
    ...rows.map(([name, p]) => `${name.padEnd(8)} ${(p.total / frames).toFixed(1).padStart(5)} avg ${p.most.toFixed(1).padStart(5)} max`),
  ].join('\n');
  frames = long = worst = 0;
  for (const p of parts.values()) p.total = p.most = 0;
}
