import * as Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { HudScene } from './scenes/HudScene';
import { MenuScene } from './scenes/MenuScene';
import { TitleScene } from './scenes/TitleScene';

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
  scene: [TitleScene, GameScene, HudScene, MenuScene],
});

// For poking at the game from the browser's console (and the screenshot scripts) while developing.
if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
