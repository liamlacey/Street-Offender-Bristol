import * as Phaser from 'phaser';
import { HudScene } from './scenes/HudScene';
import { MenuScene } from './scenes/MenuScene';
import { RaceScene } from './scenes/RaceScene';
import { TankHudScene } from './tank/TankHudScene';
import { TankScene } from './tank/TankScene';

new Phaser.Game({
  type: Phaser.AUTO,
  // One texture per draw batch. With several car textures batched together some
  // GPU drivers drew rotated cars garbled; the extra draw calls cost nothing here.
  render: { maxTextures: 1 },
  parent: 'game',
  backgroundColor: '#1b1f24',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  // Enough simultaneous touches for steering + gas + drift.
  input: { activePointers: 4 },
  // The first scene listed starts automatically.
  scene: [MenuScene, RaceScene, HudScene, TankScene, TankHudScene],
});
