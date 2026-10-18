/**
 * A small "name this track" box. Phaser has no text input, so this is plain
 * HTML laid over the game; on a phone, focusing it brings up the keyboard.
 * The game's keyboard controls are switched off while it's open, so typing
 * doesn't steer the car (or have keys like space swallowed).
 */

import type * as Phaser from 'phaser';

const STYLE = `
  .name-dialog { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.55); z-index: 10; font-family: monospace; }
  .name-dialog form { background: #10141a; border: 2px solid rgba(255, 255, 255, 0.25); padding: 18px;
    width: min(320px, calc(100vw - 32px)); box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; }
  .name-dialog h2 { margin: 0; color: #fff; font-size: 18px; text-align: center; }
  .name-dialog input { font: inherit; font-size: 16px; padding: 10px; border: 0; background: #2c333d; color: #fff; }
  .name-dialog .buttons { display: flex; gap: 10px; }
  .name-dialog button { flex: 1; font: inherit; font-size: 15px; padding: 10px; border: 0; color: #fff; }
  .name-dialog button[type=submit] { background: #d7263d; }
  .name-dialog button[type=button] { background: #2c333d; }
`;

/** Asks for a name. Resolves with it (trimmed), or null if cancelled. */
export function askName(game: Phaser.Game, title: string, suggestion: string, maxLength: number): Promise<string | null> {
  return new Promise((resolve) => {
    const keyboard = game.input.keyboard;
    if (keyboard) keyboard.enabled = false;

    const root = document.createElement('div');
    root.className = 'name-dialog';
    root.innerHTML = `
      <style>${STYLE}</style>
      <form>
        <h2></h2>
        <input name="name" autocomplete="off" />
        <div class="buttons">
          <button type="button">CANCEL</button>
          <button type="submit">SAVE</button>
        </div>
      </form>`;
    root.querySelector('h2')!.textContent = title;
    const input = root.querySelector('input')!;
    input.maxLength = maxLength;
    input.value = suggestion;
    document.body.appendChild(root);
    input.focus();
    input.select();

    const close = (result: string | null) => {
      root.remove();
      if (keyboard) keyboard.enabled = true;
      resolve(result);
    };
    root.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (name) close(name);
    });
    root.querySelector('button[type=button]')!.addEventListener('click', () => close(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(null);
    });
  });
}
