import * as Phaser from 'phaser';
import { TitleScene } from './scenes/TitleScene';

new Phaser.Game({
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
  scene: [TitleScene],
});
