/**
 * Keeping the game going when something goes wrong.
 *
 * - A frame that goes wrong (an error, anywhere in it) doesn't stop the game: Phaser only asks for the next frame once this
 *   one's done, so an error would leave it there, frozen. The error's caught, and shown at the bottom of the screen a while
 *   (small, in red: to see what it was).
 * - The picture lost (the phone short of memory, it takes the WebGL context away): there's no getting it back as it was, so
 *   it says so, and a tap loads the game again, carrying on where you were (where, which way, the damage and the kills: see
 *   `carried`). That's not starting again: the counts carry on.
 */

import * as Phaser from 'phaser';

/** What's carried over a reload to get the picture back. */
export interface Carried {
  x: number;
  y: number;
  heading: number;
  damage: number;
  kills: number;
}

const KEY = 'street-offender:carry';

/** What was carried over, if this load's to get the picture back (and only this once). */
export function carried(): Carried | null {
  try {
    const s = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const c = s ? (JSON.parse(s) as Carried) : null;
    return c && [c.x, c.y, c.heading, c.damage, c.kills].every(Number.isFinite) ? c : null;
  } catch {
    return null;
  }
}

/** Errors shown, and how many times the last came up (the same one, frame after frame, is shown once, counted). */
let shownError = '';
let repeats = 0;
let errorBox: HTMLDivElement | undefined;
let hideAt = 0;

function show(e: unknown): void {
  const err = e instanceof Error ? e : new Error(String(e));
  const where = (err.stack ?? '').split('\n').find((l) => /\d+:\d+/.test(l))?.trim() ?? '';
  const text = `${err.message}${where ? ` (${where.replace(/^at\s+/, '').slice(-80)})` : ''}`;
  console.error(err);
  if (!errorBox) {
    errorBox = document.createElement('div');
    Object.assign(errorBox.style, {
      position: 'fixed',
      left: '8px',
      right: '8px',
      bottom: '16px',
      zIndex: '20',
      font: '10px/1.3 monospace',
      color: '#ff8a80',
      textShadow: '0 0 3px #000, 0 0 2px #000',
      pointerEvents: 'none',
      whiteSpace: 'pre-wrap',
    });
    document.body.appendChild(errorBox);
  }
  repeats = text === shownError ? repeats + 1 : 1;
  shownError = text;
  errorBox.textContent = repeats > 1 ? `${text} ×${repeats}` : text;
  errorBox.style.display = 'block';
  hideAt = performance.now() + 15_000;
  setTimeout(() => {
    if (errorBox && performance.now() >= hideAt) errorBox.style.display = 'none';
  }, 15_100);
}

/** Keeps the game going (see above); `save` says where you are and the counts, for carrying on after a reload. */
export function guard(game: Phaser.Game, save: () => Carried | null): void {
  const step = game.step.bind(game);
  game.step = (time: number, delta: number) => {
    try {
      step(time, delta);
    } catch (e) {
      show(e);
    }
  };
  window.addEventListener('error', (e) => show(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => show(e.reason));
  // The picture lost: a tap, and it's loaded again, carrying on.
  game.events.once(Phaser.Core.Events.READY, () => {
    game.renderer.on(Phaser.Renderer.Events.LOSE_WEBGL, () => {
      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '30',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '24px',
        background: 'rgba(20,22,27,0.85)',
        color: '#ffffff',
        font: 'bold 18px/1.5 monospace',
      });
      box.textContent = "The phone's run short of memory and lost the picture.\nTap to carry on.";
      box.style.whiteSpace = 'pre-wrap';
      box.addEventListener('pointerdown', () => {
        try {
          const c = save();
          if (c) sessionStorage.setItem(KEY, JSON.stringify(c));
        } catch {
          // (Carried on from the start, then.)
        }
        location.reload();
      });
      document.body.appendChild(box);
    });
  });
}
