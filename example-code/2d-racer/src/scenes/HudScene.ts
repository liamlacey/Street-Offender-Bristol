import * as Phaser from 'phaser';
import { TouchControls } from '../input/TouchControls';
import { formatDelta, formatTime } from '../race/formatTime';
import { ordinal } from '../race/standings';
import { MAX_NAME_LENGTH, suggestName } from '../race/savedTracks';
import { saveMuted } from '../settings';
import { askName } from '../ui/nameDialog';
import type { Track } from '../track/Track';
import { Minimap } from './Minimap';
import {
  LAP_EVENT,
  type LapEvent,
  MENU_EVENT,
  NEW_TRACK_EVENT,
  PAUSE_EVENT,
  SAVE_TRACK_EVENT,
  MODE_KEY,
  RESET_EVENT,
  RESTART_EVENT,
  type RaceMode,
  type Standing,
  TELEMETRY_EVENT,
  TOUCH_STATE_KEY,
  TRACK_KEY,
  type Telemetry,
} from './RaceScene';

const KEYBOARD_HELP = 'Arrows / WASD: drive    Space: handbrake    R: back on track';
const MARGIN = 12;
/** Height of a row in the results table. */
const RESULT_ROW = 22;
const FONT = { fontFamily: 'monospace', color: '#ffffff' };
const LAMP_OFF = 0x2a2f36;
const LAMP_RED = 0xff2b3d;
const LAMP_GREEN = 0x3dff6e;
const BUTTON_STYLE = { ...FONT, fontSize: '15px', backgroundColor: '#00000088', padding: { x: 10, y: 6 } };

/**
 * Screen-space overlay. Runs as its own scene so the race camera's zoom doesn't affect it.
 *
 * Layout: minimap, RESET (touch screens) and the race/time-trial switch
 * top-left; position, timing and speed top-right; messages in the middle. The
 * bottom is left clear for the touch buttons.
 */
export class HudScene extends Phaser.Scene {
  private mode: RaceMode = 'race';
  private positionText!: Phaser.GameObjects.Text;
  private lapText!: Phaser.GameObjects.Text;
  private timesText!: Phaser.GameObjects.Text;
  private speedText!: Phaser.GameObjects.Text;
  private startLights!: Phaser.GameObjects.Container;
  private lamps: Phaser.GameObjects.Arc[] = [];
  private wrongWayText!: Phaser.GameObjects.Text;
  private missedText!: Phaser.GameObjects.Text;
  private checkpointArrow!: Phaser.GameObjects.Triangle;
  private lapMessage!: Phaser.GameObjects.Text;
  private lapMessageTween?: Phaser.Tweens.Tween;
  private helpText?: Phaser.GameObjects.Text;
  private resetButton?: Phaser.GameObjects.Text;
  private pauseButton!: Phaser.GameObjects.Text;
  private pausePanel!: Phaser.GameObjects.Container;
  private pauseSoundButton!: Phaser.GameObjects.Text;
  /** The save buttons on the pause and results panels, which change to "TRACK SAVED". */
  private saveButtons: Phaser.GameObjects.Text[] = [];
  private trackSaved = false;
  private locationName = '';
  /** True while the name box is open. */
  private naming = false;
  private paused = false;
  private results?: Phaser.GameObjects.Container;
  private resultRows: Phaser.GameObjects.Text[] = [];
  private resultTitle?: Phaser.GameObjects.Text;
  private touch?: TouchControls;
  private minimap!: Minimap;

  constructor() {
    super('hud');
  }

  create(): void {
    this.mode = this.registry.get(MODE_KEY) as RaceMode;
    this.results = undefined;
    this.resultRows = [];
    this.saveButtons = [];
    this.naming = false;
    const shadow = (t: Phaser.GameObjects.Text) => t.setShadow(1, 1, '#000000', 3);

    this.minimap = new Minimap(this, this.registry.get(TRACK_KEY) as Track);
    this.positionText = shadow(this.add.text(0, 0, '', { ...FONT, fontSize: '26px', fontStyle: 'bold' }).setOrigin(1, 0));
    this.lapText = shadow(this.add.text(0, 0, '', { ...FONT, fontSize: '20px', fontStyle: 'bold' }).setOrigin(1, 0));
    this.timesText = shadow(
      this.add.text(0, 0, '', { ...FONT, fontSize: '14px', color: '#d0d7de', align: 'right' }).setOrigin(1, 0),
    );
    this.speedText = shadow(this.add.text(0, 0, '', { ...FONT, fontSize: '16px' }).setOrigin(1, 0));
    this.startLights = this.createStartLights();
    this.wrongWayText = shadow(
      this.add
        .text(0, 0, 'WRONG WAY', { ...FONT, fontSize: '30px', fontStyle: 'bold', color: '#ff4d5e' })
        .setOrigin(0.5)
        .setVisible(false),
    );
    this.missedText = shadow(
      this.add
        .text(0, 0, 'MISSED CHECKPOINT\nGo back to the yellow marker', {
          ...FONT,
          fontSize: '18px',
          fontStyle: 'bold',
          color: '#ffd23f',
          align: 'center',
        })
        .setOrigin(0.5)
        .setVisible(false),
    );
    // Points from the car towards a missed checkpoint (drawn pointing right at rotation 0).
    this.checkpointArrow = this.add
      .triangle(0, 0, 0, 0, 30, 12, 0, 24, 0xffd23f)
      .setStrokeStyle(2, 0x10141a)
      .setVisible(false);
    this.lapMessage = shadow(
      this.add
        .text(0, 0, '', { ...FONT, fontSize: '22px', fontStyle: 'bold', align: 'center' })
        .setOrigin(0.5)
        .setAlpha(0),
    );

    const race = this.scene.get('race');
    const restart = () => race.events.emit(RESTART_EVENT);
    const setPaused = (paused: boolean) => race.events.emit(PAUSE_EVENT, paused);
    this.pauseButton = this.add
      .text(0, 0, 'PAUSE', BUTTON_STYLE)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => setPaused(true));
    this.pausePanel = this.createPausePanel(
      () => setPaused(false),
      restart,
      () => race.events.emit(MENU_EVENT),
    );
    if (this.sys.game.device.input.touch) {
      this.touch = new TouchControls(this);
      this.registry.set(TOUCH_STATE_KEY, this.touch.state);
      this.resetButton = this.add
        .text(0, 0, 'RESET', BUTTON_STYLE)
        .setInteractive()
        .on('pointerdown', () => race.events.emit(RESET_EVENT));
    } else {
      this.helpText = this.add
        .text(MARGIN, 0, KEYBOARD_HELP, { ...FONT, fontSize: '14px', color: '#c9d1d9' })
        .setOrigin(0, 1)
        .setShadow(1, 1, '#000000', 2);
    }
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (this.results) restart();
      else if (this.paused) setPaused(false);
    });
    for (const key of ['keydown-ESC', 'keydown-P']) {
      this.input.keyboard?.on(key, () => {
        if (!this.results) setPaused(!this.paused);
      });
    }

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    race.events.on(TELEMETRY_EVENT, this.onTelemetry, this);
    race.events.on(LAP_EVENT, this.onLap, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      race.events.off(TELEMETRY_EVENT, this.onTelemetry, this);
      race.events.off(LAP_EVENT, this.onLap, this);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
  }

  update(): void {
    this.touch?.update();
  }

  private onTelemetry(t: Telemetry): void {
    this.minimap.setCarPosition(t.x, t.y);
    this.minimap.setOpponents(t.opponents);
    this.minimap.setCheckpoint(t.nextCheckpoint, t.missedCheckpoint);
    this.missedText.setVisible(t.missedCheckpoint);
    this.checkpointArrow
      .setVisible(t.missedCheckpoint)
      .setRotation(Math.atan2(t.nextCheckpoint.y - t.y, t.nextCheckpoint.x - t.x));

    const racing = t.totalLaps !== null;
    this.positionText.setText(racing ? `POS ${t.position}/${t.racers}` : '');
    const lapNumber = t.lap > 0 ? `${Math.min(t.lap, t.totalLaps ?? t.lap)}` : '-';
    const laps = racing ? `${lapNumber}/${t.totalLaps}` : lapNumber;
    this.lapText.setText(`LAP ${laps}  ${formatTime(t.lapTime)}`);
    const last = t.lastLap === null ? '-:--.--' : formatTime(t.lastLap);
    const best = t.bestLap === null ? '-:--.--' : formatTime(t.bestLap);
    this.timesText.setText(`LAST ${last}\nBEST ${best}`);
    // 4 px/s ≈ 1 km/h — an arbitrary scale that makes the numbers feel right.
    const kmh = Math.round(t.speed / 4).toString().padStart(3);
    this.speedText.setText(`${t.drifting ? 'DRIFT!  ' : ''}${kmh} km/h`);
    this.wrongWayText.setVisible(t.wrongWay);

    this.updateStartLights(racing && !t.paused, t.countdown, t.raceTime);

    this.trackSaved = t.trackSaved;
    this.locationName = t.locationName;
    for (const button of this.saveButtons) {
      button.setText(t.trackSaved ? 'TRACK SAVED' : 'SAVE TRACK').setAlpha(t.trackSaved ? 0.6 : 1);
    }
    this.paused = t.paused;
    this.pausePanel.setVisible(t.paused);
    this.pauseButton.setVisible(!t.paused && !t.results);
    if (t.results) {
      this.showResults(t.results, t.totalLaps ?? 0);
      // The results replace the timing panel (which would only be timing the cool-down lap).
      for (const text of [this.positionText, this.lapText, this.timesText, this.speedText]) text.setVisible(false);
    }
  }

  /** Asks for a name and saves this race's track (once). */
  private async saveTrack(): Promise<void> {
    if (this.trackSaved || this.naming) return;
    this.naming = true;
    const name = await askName(this.game, 'Name this track', suggestName(this.locationName), MAX_NAME_LENGTH);
    this.naming = false;
    if (name) this.scene.get('race').events.emit(SAVE_TRACK_EVENT, name);
  }

  /** Resume / restart / save / menu / sound, shown while paused. */
  private createPausePanel(resume: () => void, restart: () => void, menu: () => void): Phaser.GameObjects.Container {
    const width = 220;
    const gap = 42;
    const items: [string, string, () => void][] = [
      ['RESUME', '#d7263d', resume],
      ['RESTART', '#2c333d', restart],
      ['SAVE TRACK', '#2c333d', () => void this.saveTrack()],
      ['MENU', '#2c333d', menu],
      ['', '#2c333d', () => this.toggleSound()],
    ];
    const height = 64 + items.length * gap;
    const top = -height / 2;
    const bg = this.add
      .rectangle(0, 0, width, height, 0x10141a, 0.92)
      .setStrokeStyle(2, 0xffffff, 0.25)
      .setInteractive();
    const title = this.add.text(0, top + 14, 'PAUSED', { ...FONT, fontSize: '22px', fontStyle: 'bold' }).setOrigin(0.5, 0);
    const buttons = items.map(([label, color, onTap], i) =>
      this.add
        .text(0, top + 62 + i * gap, label, { ...BUTTON_STYLE, backgroundColor: color, fixedWidth: 150, align: 'center' })
        .setOrigin(0.5, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', onTap),
    );
    this.saveButtons.push(buttons[2]);
    this.pauseSoundButton = buttons[4];
    this.updateSoundButton();
    return this.add.container(0, 0, [bg, title, ...buttons]).setDepth(10).setVisible(false);
  }

  private toggleSound(): void {
    this.sound.mute = !this.sound.mute;
    saveMuted(this.sound.mute);
    this.updateSoundButton();
  }

  private updateSoundButton(): void {
    this.pauseSoundButton.setText(this.sound.mute ? 'SOUND OFF' : 'SOUND ON');
  }

  /** Three lamps in a dark housing, like a real start gantry. */
  private createStartLights(): Phaser.GameObjects.Container {
    const spacing = 46;
    const housing = this.add.rectangle(0, 0, spacing * 3 + 16, 62, 0x10141a, 0.92).setStrokeStyle(2, 0xffffff, 0.2);
    this.lamps = [-1, 0, 1].map((i) => this.add.circle(i * spacing, 0, 18, LAMP_OFF).setStrokeStyle(2, 0x000000, 0.6));
    return this.add.container(0, 0, [housing, ...this.lamps]).setVisible(false).setDepth(5);
  }

  /** A red lamp lights each second of the countdown; all go green at the start. */
  private updateStartLights(racing: boolean, countdown: number, raceTime: number): void {
    const showGreen = racing && countdown === 0 && raceTime < 0.8;
    this.startLights.setVisible(racing && (countdown > 0 || showGreen));
    const lit = showGreen ? 3 : 3 - Math.ceil(countdown) + 1;
    this.lamps.forEach((lamp, i) => lamp.setFillStyle(i < lit ? (showGreen ? LAMP_GREEN : LAMP_RED) : LAMP_OFF));
  }

  private onLap(lap: LapEvent): void {
    // The last lap's time goes on the results screen instead.
    if (lap.totalLaps !== null && lap.lap === lap.totalLaps) return;
    let detail: string;
    if (lap.isBest) {
      detail = lap.previousBest === null ? 'First lap set' : `NEW BEST  ${formatDelta(lap.time - lap.previousBest)}`;
    } else {
      detail = formatDelta(lap.time - (lap.previousBest ?? lap.time));
    }
    if (lap.totalLaps !== null && lap.lap === lap.totalLaps - 1) detail += '\nFINAL LAP';
    this.lapMessage
      .setText(`LAP ${lap.lap}  ${formatTime(lap.time)}\n${detail}`)
      .setColor(lap.isBest ? '#7dff9a' : '#ffffff')
      .setAlpha(1);
    this.lapMessageTween?.stop();
    this.lapMessageTween = this.tweens.add({ targets: this.lapMessage, alpha: 0, delay: 2500, duration: 600 });
  }

  /** The results panel: built when the player finishes, then updated as the others come in. */
  private showResults(standings: Standing[], totalLaps: number): void {
    // As many rows as fit; if the player is further down, the last row is theirs.
    const fit = Math.max(3, Math.floor((this.scale.height - 16 - 164) / RESULT_ROW));
    if (!this.results) this.buildResults(Math.min(standings.length, fit));
    const position = standings.findIndex((s) => s.isPlayer) + 1;
    this.resultTitle?.setText(`You finished ${ordinal(position)}`);
    const rows = this.resultRows.length;
    const shown = standings.map((_, i) => i).slice(0, rows);
    if (position > rows) shown[rows - 1] = position - 1;
    shown.forEach((i, row) => {
      const s = standings[i];
      const time = s.finishTime !== null ? formatTime(s.finishTime) : `lap ${Math.max(s.lap, 1)}/${totalLaps}`;
      const best = s.bestLap !== null ? formatTime(s.bestLap) : '-:--.--';
      this.resultRows[row]
        .setText(`${String(i + 1).padStart(2)}  ${s.name.padEnd(6)} ${time.padStart(8)}  best ${best}`)
        .setColor(s.isPlayer ? '#ffd23f' : '#ffffff');
      const swatch = this.resultRows[row].getData('swatch') as Phaser.GameObjects.Rectangle;
      swatch.setFillStyle(s.color);
    });
  }

  private buildResults(rows: number): void {
    const { width, height } = this.scale;
    const panelWidth = Math.min(380, width - 24);
    const rowHeight = RESULT_ROW;
    const panelHeight = 60 + rows * rowHeight + 104;
    const container = this.add.container(width / 2, height / 2).setDepth(10);
    const bg = this.add
      .rectangle(0, 0, panelWidth, panelHeight, 0x10141a, 0.92)
      .setStrokeStyle(2, 0xffffff, 0.25)
      // Swallow taps on the panel so they don't reach the touch buttons underneath.
      .setInteractive();
    const top = -panelHeight / 2;
    this.resultTitle = this.add.text(0, top + 14, '', { ...FONT, fontSize: '22px', fontStyle: 'bold' }).setOrigin(0.5, 0);
    container.add([bg, this.resultTitle]);

    const left = -panelWidth / 2 + 18;
    for (let i = 0; i < rows; i++) {
      const y = top + 58 + i * rowHeight;
      const swatch = this.add.rectangle(left, y + 8, 10, 10, 0xffffff);
      const row = this.add.text(left + 14, y, '', { ...FONT, fontSize: '14px' }).setData('swatch', swatch);
      this.resultRows.push(row);
      container.add([swatch, row]);
    }

    // Two rows of two buttons.
    const race = this.scene.get('race');
    const buttons: [string, string, () => void][] = [
      ['RACE AGAIN', '#d7263d', () => race.events.emit(RESTART_EVENT)],
      ['NEW TRACK', '#2c333d', () => race.events.emit(NEW_TRACK_EVENT)],
      ['SAVE TRACK', '#2c333d', () => void this.saveTrack()],
      ['MENU', '#2c333d', () => race.events.emit(MENU_EVENT)],
    ];
    const buttonWidth = Math.min(150, (panelWidth - 40) / 2);
    buttons.forEach(([label, color, onTap], i) => {
      const button = this.add
        .text((i % 2 === 0 ? -1 : 1) * (buttonWidth / 2 + 6), panelHeight / 2 - 76 + Math.floor(i / 2) * 40, label, {
          ...BUTTON_STYLE,
          backgroundColor: color,
          fixedWidth: buttonWidth,
          align: 'center',
        })
        .setOrigin(0.5, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', onTap);
      if (label === 'SAVE TRACK') this.saveButtons.push(button);
      container.add(button);
    });
    this.results = container;
  }

  private layout(): void {
    const { width, height } = this.scale;
    const mapSize = Phaser.Math.Clamp(Math.min(width, height) * 0.3, 90, 170);
    this.minimap.layout(MARGIN, MARGIN, mapSize);
    let y = MARGIN + mapSize + 8;
    if (this.resetButton) {
      this.resetButton.setPosition(MARGIN, y);
      y += 36;
    }
    this.pauseButton.setPosition(MARGIN, y);
    this.pausePanel.setPosition(width / 2, height / 2);

    const right = width - MARGIN;
    // In time trial there's no position, so everything moves up into its space.
    const shift = this.mode === 'race' ? 34 : 0;
    this.positionText.setPosition(right, 8);
    this.lapText.setPosition(right, 10 + shift);
    this.timesText.setPosition(right, 36 + shift);
    this.speedText.setPosition(right, 76 + shift);

    // Clear of the cars on the grid: above them on wide screens; on a narrow portrait
    // screen the top is full, so below them (above the touch buttons).
    this.startLights.setPosition(width / 2, width < height ? height * 0.63 : height * 0.18);
    this.lapMessage.setPosition(width / 2, height * 0.22);
    this.missedText.setPosition(width / 2, height * 0.34);
    this.wrongWayText.setPosition(width / 2, height * 0.34 + 50);
    this.checkpointArrow.setPosition(width / 2, height * 0.34 + 54);
    this.results?.setPosition(width / 2, height / 2);
    this.helpText?.setY(height - 10);
    this.touch?.layout(width, height);
  }
}
