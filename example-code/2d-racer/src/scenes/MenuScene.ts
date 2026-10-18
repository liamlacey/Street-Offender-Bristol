import * as Phaser from 'phaser';
import { AI_DRIVERS, MAX_OPPONENTS, MIN_OPPONENTS } from '../ai/drivers';
import { LOCATIONS, LOCATION_LIST, type Location, type LocationId } from '../locations/locations';
import { loadBestLap } from '../race/bestLaps';
import { formatTime } from '../race/formatTime';
import { type SavedTrack, CLASSIC, deleteTrack, listTracks } from '../race/savedTracks';
import {
  DIFFICULTIES,
  type Difficulty,
  MAX_LAPS,
  MIN_LAPS,
  loadDifficulty,
  loadLaps,
  loadOpponents,
  loadLength,
  loadLocation,
  loadTrackDifficulty,
  loadMuted,
  saveDifficulty,
  saveLaps,
  saveOpponents,
  saveLength,
  saveLocation,
  saveTrackDifficulty,
  saveMuted,
} from '../settings';
import { TRACK_DIFFICULTIES, TRACK_LENGTHS, type TrackDifficulty, type TrackLength } from '../track/generate';
import { type Track, buildTrack, poseAt } from '../track/Track';
import { type RaceMode, type RaceSettings, newTrackSettings } from './RaceScene';
import { deleteIsland, listIslands } from '../tank/savedIslands';

const FONT = { fontFamily: 'monospace', color: '#ffffff' };
const BUTTON = { ...FONT, fontSize: '16px', padding: { x: 12, y: 8 }, align: 'center' as const };
const RED = '#d7263d';
const GREY = '#2c333d';
const PLAYER_COLOR = 0xd7263d;

type Page = 'home' | 'tracks' | 'newTrack' | 'setup' | 'islands';

/** What's been chosen so far; kept while moving between pages. */
interface MenuState {
  page: Page;
  location: LocationId;
  length: TrackLength;
  trackDifficulty: TrackDifficulty;
  /** The saved track picked on the tracks page, or null when setting up a new one. */
  saved: SavedTrack | null;
  mode: RaceMode;
  difficulty: Difficulty;
  laps: number;
  opponents: number;
  /** Which page of the saved-tracks list is showing. */
  listPage: number;
  /** Saved track awaiting a second tap on DEL to confirm. */
  confirmDelete: string | null;
}

/**
 * The menus, as pages: home (Play) → tracks (new or saved) → new track
 * (location and length) → race setup (mode, AI, laps, opponents) → race. A track map
 * with cars lapping it sits behind everything.
 */
export class MenuScene extends Phaser.Scene {
  private state!: MenuState;
  private map = { scale: 1, x: 0, y: 0 };
  private mapTrack!: Track;
  private dots: { dot: Phaser.GameObjects.Arc; speed: number; along: number }[] = [];

  constructor() {
    super('menu');
  }

  init(data: Partial<MenuState>): void {
    this.state = {
      page: 'home',
      location: loadLocation(),
      length: loadLength(),
      trackDifficulty: loadTrackDifficulty(),
      saved: null,
      mode: 'race',
      difficulty: loadDifficulty(),
      laps: loadLaps(),
      opponents: loadOpponents(),
      listPage: 0,
      confirmDelete: null,
      ...data,
    };
  }

  create(): void {
    this.sound.mute = loadMuted();
    const { width, height } = this.scale;
    const location = LOCATIONS[this.state.location];
    this.cameras.main.setBackgroundColor(Phaser.Display.Color.IntegerToColor(location.ground.base).rgba);

    // The map shows the chosen saved track, or the classic one.
    this.mapTrack = buildTrack((this.state.saved ?? CLASSIC).definition);
    this.drawMap(width, height, location);
    this.add.rectangle(width / 2, height / 2, Math.min(360, width - 24), height, 0x10141a, 0.8);

    ({ home: this.homePage, tracks: this.tracksPage, newTrack: this.newTrackPage, setup: this.setupPage, islands: this.islandsPage })[
      this.state.page
    ].call(this, width, height);

    if (this.sys.game.device.input.touch && height > width) {
      this.add
        .text(width / 2, height - 12, 'Turn your phone sideways for the best view', { ...FONT, fontSize: '12px', color: '#d0d7de' })
        .setOrigin(0.5, 1);
    }

    // Simplest way to re-fit everything after a rotation or resize.
    const relayout = () => this.go({});
    this.scale.once(Phaser.Scale.Events.RESIZE, relayout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, relayout));
  }

  update(_time: number, deltaMs: number): void {
    // Cars lapping the map, just for show.
    for (const d of this.dots) {
      d.along += d.speed * (deltaMs / 1000);
      const p = poseAt(this.mapTrack, d.along);
      d.dot.setPosition(p.x * this.map.scale + this.map.x, p.y * this.map.scale + this.map.y);
    }
  }

  // --- Pages ---

  private homePage(width: number, height: number): void {
    const row = this.rows(height, 5);
    this.add.text(width / 2, row(), '2D RACER', { ...FONT, fontSize: '38px', fontStyle: 'bold' }).setOrigin(0.5).setShadow(2, 2, '#000', 4);
    this.button(width / 2, row(), 'PLAY', RED, 200, () => this.go({ page: 'tracks' }));
    // A different game: an island to drive a tank round and blow up.
    this.button(width / 2, row(), 'TANK WORLD', '#4f5d33', 200, () => this.go({ page: 'islands', listPage: 0 }));
    const sound = this.button(width / 2, row(), '', GREY, 200, () => {
      this.sound.mute = !this.sound.mute;
      saveMuted(this.sound.mute);
      sound.setText(this.sound.mute ? 'SOUND OFF' : 'SOUND ON');
    });
    sound.setText(this.sound.mute ? 'SOUND OFF' : 'SOUND ON');
    this.input.keyboard?.once('keydown-ENTER', () => this.go({ page: 'tracks' }));
  }

  /** Tank World: a new island, or one of the saved ones. */
  private islandsPage(width: number, height: number): void {
    const islands = listIslands();
    const perPage = Math.max(2, Math.floor((height - 170) / 42));
    const pages = Math.max(1, Math.ceil(islands.length / perPage));
    const listPage = Math.min(this.state.listPage, pages - 1);
    const shown = islands.slice(listPage * perPage, (listPage + 1) * perPage);

    let y = 34;
    this.title(width / 2, y, 'TANK WORLD');
    y += 48;
    this.button(width / 2, y, 'NEW ISLAND', '#4f5d33', 300, () => this.scene.start('tank'));
    y += 46;
    if (islands.length === 0) {
      this.add
        .text(width / 2, y, 'Islands you save will be listed here', { ...FONT, fontSize: '12px', color: '#9aa4ae' })
        .setOrigin(0.5);
    }
    const columnWidth = Math.min(340, width - 32);
    for (const island of shown) {
      const left = width / 2 - columnWidth / 2;
      const deleteWidth = 64;
      this.add
        .rectangle(left, y - 17, columnWidth - deleteWidth - 6, 36, 0x2c333d)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.scene.start('tank', { seed: island.seed, savedId: island.id }));
      this.add.text(left + 10, y - 13, island.name, { ...FONT, fontSize: '14px', fontStyle: 'bold' });
      this.add.text(left + 10, y + 3, `Saved ${new Date(island.savedAt).toLocaleDateString()}`, { ...FONT, fontSize: '11px', color: '#9aa4ae' });
      const confirming = this.state.confirmDelete === island.id;
      this.button(left + columnWidth - deleteWidth / 2, y + 1, confirming ? 'SURE?' : 'DEL', confirming ? RED : GREY, deleteWidth, () => {
        if (confirming) deleteIsland(island.id);
        this.go({ confirmDelete: confirming ? null : island.id });
      }).setFontSize(12);
      y += 42;
    }
    const bottom = height - 30;
    if (pages > 1) {
      this.add.text(width / 2, bottom - 44, `${listPage + 1} / ${pages}`, { ...FONT, fontSize: '12px', color: '#9aa4ae' }).setOrigin(0.5);
      if (listPage > 0) this.button(width / 2 - 90, bottom - 44, '<', GREY, 50, () => this.go({ listPage: listPage - 1 }));
      if (listPage < pages - 1) this.button(width / 2 + 90, bottom - 44, '>', GREY, 50, () => this.go({ listPage: listPage + 1 }));
    }
    this.button(width / 2, bottom, 'BACK', GREY, 140, () => this.go({ page: 'home' }));
  }

  private tracksPage(width: number, height: number): void {
    const tracks = listTracks();
    const perPage = Math.max(2, Math.floor((height - 170) / 42));
    const pages = Math.ceil(tracks.length / perPage);
    const listPage = Math.min(this.state.listPage, pages - 1);
    const shown = tracks.slice(listPage * perPage, (listPage + 1) * perPage);

    let y = 34;
    this.title(width / 2, y, 'CHOOSE A TRACK');
    y += 48;
    this.button(width / 2, y, 'NEW TRACK', RED, 300, () => this.go({ page: 'newTrack', saved: null }));
    y += 46;

    const columnWidth = Math.min(340, width - 32);
    for (const track of shown) {
      const best = loadBestLap(track.id);
      const trackDifficulty = track.definition.difficulty;
      const detail = [LOCATIONS[track.location].name, track.length, trackDifficulty && `${trackDifficulty} track`, best === null ? null : formatTime(best)]
        .filter(Boolean)
        .join(' · ');
      const left = width / 2 - columnWidth / 2;
      const deleteWidth = track.builtIn ? 0 : 64;
      this.add
        .rectangle(left, y - 17, columnWidth - deleteWidth - (deleteWidth ? 6 : 0), 36, 0x2c333d)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.go({ page: 'setup', saved: track, location: track.location, length: track.length }));
      this.add.text(left + 10, y - 13, track.name, { ...FONT, fontSize: '14px', fontStyle: 'bold' });
      this.add.text(left + 10, y + 3, detail, { ...FONT, fontSize: '11px', color: '#9aa4ae' });
      if (!track.builtIn) {
        const confirming = this.state.confirmDelete === track.id;
        this.button(left + columnWidth - deleteWidth / 2, y + 1, confirming ? 'SURE?' : 'DEL', confirming ? RED : GREY, deleteWidth, () => {
          if (confirming) deleteTrack(track.id);
          this.go({ confirmDelete: confirming ? null : track.id });
        }).setFontSize(12);
      }
      y += 42;
    }

    const bottom = height - 30;
    if (pages > 1) {
      this.add.text(width / 2, bottom - 44, `${listPage + 1} / ${pages}`, { ...FONT, fontSize: '12px', color: '#9aa4ae' }).setOrigin(0.5);
      if (listPage > 0) this.button(width / 2 - 90, bottom - 44, '<', GREY, 50, () => this.go({ listPage: listPage - 1 }));
      if (listPage < pages - 1) this.button(width / 2 + 90, bottom - 44, '>', GREY, 50, () => this.go({ listPage: listPage + 1 }));
    }
    this.button(width / 2, bottom, 'BACK', GREY, 140, () => this.go({ page: 'home' }));
  }

  private newTrackPage(width: number, height: number): void {
    const row = this.rows(height, 5);
    const titleRow = row() - 8;
    this.title(width / 2, titleRow, 'NEW TRACK');
    this.add
      .text(width / 2, titleRow + 22, LOCATIONS[this.state.location].description, { ...FONT, fontSize: '11px', color: '#d0d7de' })
      .setOrigin(0.5);
    const locationRow = row();
    // Two by two in the width of the panel, or when there are more, in rows of three lined up with the rows below.
    const columns = LOCATION_LIST.length > 4 ? 3 : 2;
    const panel = Math.min(360, width - 24);
    const buttonWidth = columns === 3 ? 96 : (panel - 18) / columns;
    LOCATION_LIST.forEach((loc, i) => {
      const col = i % columns;
      const line = Math.floor(i / columns);
      const lines = Math.ceil(LOCATION_LIST.length / columns);
      const x = width / 2 + (col - (columns - 1) / 2) * (buttonWidth + 6);
      const y = locationRow - 6 + (line - (lines - 1) / 2) * 28;
      this.button(x, y, loc.name.toUpperCase(), loc.id === this.state.location ? RED : GREY, buttonWidth, () => {
        saveLocation(loc.id);
        this.go({ location: loc.id });
      })
        .setFontSize(14)
        .setPadding(6, 4, 6, 4);
    });
    const lengthRow = row();
    this.label(width / 2, lengthRow - 26, 'LENGTH');
    this.segmented(width / 2, lengthRow, TRACK_LENGTHS, this.state.length, (length) => {
      saveLength(length);
      this.go({ length });
    });
    const difficultyRow = row();
    this.label(width / 2, difficultyRow - 26, 'TRACK DIFFICULTY');
    this.segmented(width / 2, difficultyRow, TRACK_DIFFICULTIES, this.state.trackDifficulty, (trackDifficulty) => {
      saveTrackDifficulty(trackDifficulty);
      this.go({ trackDifficulty });
    });
    this.bottomRow(width, row(), 'NEXT', () => this.go({ page: 'setup', saved: null }), () => this.go({ page: 'tracks' }));
  }

  private setupPage(width: number, height: number): void {
    const { saved, mode } = this.state;
    const location = LOCATIONS[this.state.location];
    const row = this.rows(height, 5);
    const titleRow = row() - 8;
    this.title(width / 2, titleRow, saved ? saved.name.toUpperCase() : `NEW ${location.name.toUpperCase()} TRACK`);
    const best = saved ? loadBestLap(saved.id) : null;
    const difficulty = saved ? saved.definition.difficulty : this.state.trackDifficulty;
    // "hard track", so it can't be mistaken for the AI difficulty below it.
    const subtitle = [location.name, this.state.length, difficulty && `${difficulty} track`, best === null ? null : `best ${formatTime(best)}`]
      .filter(Boolean)
      .join(' · ');
    this.add.text(width / 2, titleRow + 22, subtitle, { ...FONT, fontSize: '12px', color: '#d0d7de' }).setOrigin(0.5);

    this.segmented(width / 2, row(), ['race', 'timeTrial'] as RaceMode[], mode, (m) => this.go({ mode: m }), (m) =>
      m === 'race' ? 'RACE' : 'TIME TRIAL',
    );
    const aiRow = row();
    const lapsRow = row();
    if (mode === 'race') {
      this.label(width / 2, aiRow - 26, 'AI DIFFICULTY');
      this.segmented(width / 2, aiRow, DIFFICULTIES, this.state.difficulty, (difficulty) => {
        saveDifficulty(difficulty);
        this.go({ difficulty });
      });
      this.stepper(width / 2 - 82, lapsRow, 'LAPS', this.state.laps, MIN_LAPS, MAX_LAPS, (laps) => {
        saveLaps(laps);
        this.go({ laps });
      });
      this.stepper(width / 2 + 82, lapsRow, 'OPPONENTS', this.state.opponents, MIN_OPPONENTS, MAX_OPPONENTS, (opponents) => {
        saveOpponents(opponents);
        this.go({ opponents });
      });
    } else {
      this.add
        .text(width / 2, (aiRow + lapsRow) / 2, 'Just you against the clock.\nSet your best lap.', {
          ...FONT,
          fontSize: '13px',
          color: '#d0d7de',
          align: 'center',
        })
        .setOrigin(0.5);
    }
    this.bottomRow(width, row(), saved ? 'PLAY' : 'GENERATE & PLAY', () => this.play(), () =>
      this.go({ page: saved ? 'tracks' : 'newTrack' }),
    );
    this.input.keyboard?.once('keydown-ENTER', () => this.play());
  }

  // --- Actions ---

  private play(): void {
    const { saved, mode, difficulty, laps, opponents } = this.state;
    const race = { mode, difficulty, laps, opponents };
    if (saved) {
      const settings: RaceSettings = {
        ...race,
        track: saved.definition,
        location: saved.location,
        length: saved.length,
        trackDifficulty: saved.definition.difficulty ?? 'medium',
        trackId: saved.id,
        trackName: saved.name,
      };
      this.scene.start('race', settings);
      return;
    }
    // Let "Generating..." draw before the work starts.
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x10141a, 0.85).setDepth(20).setInteractive();
    this.add.text(width / 2, height / 2, 'Generating track...', { ...FONT, fontSize: '20px' }).setOrigin(0.5).setDepth(21);
    this.time.delayedCall(60, () =>
      this.scene.start(
        'race',
        newTrackSettings(LOCATIONS[this.state.location], this.state.length, this.state.trackDifficulty, race),
      ),
    );
  }

  /** Re-shows the menu with some choices changed (any pending delete is forgotten unless set again). */
  private go(change: Partial<MenuState>): void {
    this.scene.restart({ ...this.state, confirmDelete: null, ...change });
  }

  // --- Building blocks ---

  /** Evenly spaced rows that fit the screen height; call the returned function for each row's y. */
  private rows(height: number, count: number): () => number {
    const gap = Phaser.Math.Clamp((height - 40) / count, 38, 64);
    let y = height / 2 - (gap * (count - 1)) / 2;
    return () => (y += gap) - gap;
  }

  /** BACK on the left and the page's main action on the right, on one row. */
  private bottomRow(width: number, y: number, action: string, onAction: () => void, onBack: () => void): void {
    this.button(width / 2 - 100, y, 'BACK', GREY, 100, onBack);
    this.button(width / 2 + 60, y, action, RED, 200, onAction);
  }

  private title(x: number, y: number, text: string): void {
    this.add.text(x, y, text, { ...FONT, fontSize: '22px', fontStyle: 'bold' }).setOrigin(0.5).setShadow(2, 2, '#000', 3);
  }

  private label(x: number, y: number, text: string): void {
    this.add.text(x, y, text, { ...FONT, fontSize: '11px', color: '#9aa4ae' }).setOrigin(0.5);
  }

  private button(x: number, y: number, label: string, color: string, width: number, onTap: () => void) {
    return this.add
      .text(x, y, label, { ...BUTTON, backgroundColor: color, fixedWidth: width })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', onTap);
  }

  /** A labelled number with - and + buttons, kept within min..max. */
  private stepper(
    x: number,
    y: number,
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (value: number) => void,
  ): void {
    this.label(x, y - 26, label);
    const dim = '#1d2128';
    this.button(x - 52, y, '-', value > min ? GREY : dim, 44, () => value > min && onChange(value - 1));
    this.add.text(x, y, String(value), { ...FONT, fontSize: '20px', fontStyle: 'bold' }).setOrigin(0.5);
    this.button(x + 52, y, '+', value < max ? GREY : dim, 44, () => value < max && onChange(value + 1));
  }

  /** A row of options with the current one highlighted. */
  private segmented<T extends string>(
    x: number,
    y: number,
    options: readonly T[],
    current: T,
    onPick: (value: T) => void,
    labelFor: (value: T) => string = (v) => v.toUpperCase(),
  ): void {
    const width = options.length > 2 ? 96 : 140;
    options.forEach((option, i) => {
      const bx = x + (i - (options.length - 1) / 2) * (width + 6);
      this.button(bx, y, labelFor(option), option === current ? RED : GREY, width, () => onPick(option));
    });
  }

  /** The track as a map filling the screen, in the location's colours, with cars lapping it. */
  private drawMap(width: number, height: number, location: Location): void {
    const { minX, minY, maxX, maxY } = this.mapTrack.bounds;
    const pad = 40;
    const scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY));
    this.map = {
      scale,
      x: (width - (maxX - minX) * scale) / 2 - minX * scale,
      y: (height - (maxY - minY) * scale) / 2 - minY * scale,
    };
    const g = this.add.graphics();
    const road = Math.max(6, this.mapTrack.width * scale);
    const path = (thickness: number, color: number) => {
      g.lineStyle(thickness, color);
      g.beginPath();
      this.mapTrack.points.forEach((p, i) => {
        const x = p.x * scale + this.map.x;
        const y = p.y * scale + this.map.y;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
      g.strokePath();
    };
    path(road + 6, location.road.kerbColors[0]);
    path(road, location.road.surface);

    const colors = [...AI_DRIVERS.map((d) => d.color), PLAYER_COLOR];
    this.dots = colors.map((color, i) => ({
      dot: this.add.circle(0, 0, Math.max(4, road * 0.3), color).setStrokeStyle(1.5, 0xffffff),
      speed: 520 + i * 25,
      along: i * 140,
    }));
  }
}
