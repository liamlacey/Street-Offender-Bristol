import * as Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { HudScene } from './scenes/HudScene';
import { LoadingScene } from './scenes/LoadingScene';
import { MenuScene } from './scenes/MenuScene';
import { TitleScene } from './scenes/TitleScene';
import { PERF, watch } from './scenes/perfMeter';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  // One texture per draw batch (some GPU drivers garble rotated sprites batched together).
  render: { maxTextures: 1 },
  parent: 'game',
  backgroundColor: '#14161b',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  // Enough simultaneous touches for steering + gas + buttons.
  input: { activePointers: 4 },
  // The first scene listed starts automatically.
  // (The loading screen over the game as it's set up.)
  scene: [TitleScene, GameScene, LoadingScene, HudScene, MenuScene],
});

// (`?perf` on the address: how smoothly it's running, over the game.)
watch(game);

// For poking at the game from the browser's console (and the screenshot scripts) while developing; and, with `?perf`, timing it
// as it's played (the built game, as the phone has it).
if (import.meta.env.DEV || PERF) (window as unknown as { game: Phaser.Game }).game = game;
