/**
 * All the game's sound, synthesised with the Web Audio API so there are no
 * audio files to load: engines, tyre squeal, the rumble of grass, gravel
 * and dirt, sloshing through water and mud, crashes, and the countdown and
 * lap chimes.
 *
 * It plays into Phaser's sound output, so Phaser's mute switch and its
 * unlock-on-first-tap handling (needed on iPhones) apply to it too.
 */

import type { SurfaceKind } from '../car/CarPhysics';

export interface EngineState {
  /** px/s */
  speed: number;
  throttle: number;
  /** Sideways sliding speed, px/s. */
  slide: number;
  surface: SurfaceKind;
  /** Position relative to the player's car, for other cars' volume and stereo position. */
  dx: number;
  dy: number;
}

/** Speed range of each "gear", so the engine note rises and drops like it's changing up. */
const GEAR_SPAN = 170;
const VOLUME = 0.8;
/** Other cars' engines heard at once (the nearest ones); more is muddy and costly on phones. */
const AUDIBLE_OPPONENTS = 4;

export class RaceAudio {
  private readonly out: GainNode;
  private readonly engines: Engine[] = [];
  private readonly squeal: Loop;
  private readonly rumble: Loop;
  private readonly slosh: Loop;
  private readonly noise: AudioBuffer;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    cars: number,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = VOLUME;
    this.out.connect(destination);
    this.noise = makeNoise(ctx);
    const engines = Math.min(cars, AUDIBLE_OPPONENTS + 1);
    for (let i = 0; i < engines; i++) this.engines.push(new Engine(ctx, this.out, i === 0));
    this.squeal = new Loop(ctx, this.out, this.noise, 'bandpass', 2200, 6);
    this.rumble = new Loop(ctx, this.out, this.noise, 'lowpass', 260, 1);
    this.slosh = new Loop(ctx, this.out, this.noise, 'bandpass', 700, 1.5);
  }

  /**
   * Call every frame. `cars[0]` is the player; of the rest, only the nearest
   * few are heard, quieter the further away they are.
   */
  update(cars: EngineState[]): void {
    const [player, ...others] = cars;
    const nearest = others.sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
    [player, ...nearest].forEach((car, i) => this.engines[i]?.update(car));
    const { surface, speed, slide } = player;
    // Tyres only squeal on a hard surface; loose ones rumble and crunch instead.
    const hard = surface === 'road' || surface === 'kerb' || surface === 'bridge';
    this.squeal.set(hard ? clamp01((slide - 90) / 250) * 0.12 : 0, 1900 + Math.min(speed, 600));
    // Grass, gravel, deep snow and soft sand rumble; dirt and packed snow crunch as you slide on them.
    const rumble =
      surface === 'grass' || surface === 'gravel' || surface === 'drift' || surface === 'sand'
        ? clamp01(speed / 300) * 0.25
        : surface === 'dirt' || surface === 'snow'
          ? clamp01(speed / 600) * 0.08 + clamp01(slide / 300) * 0.12
          : 0;
    this.rumble.set(rumble);
    const wet = surface === 'water' ? 0.3 : surface === 'mud' ? 0.18 : 0;
    this.slosh.set(wet * clamp01(speed / 250), surface === 'mud' ? 400 : 900);
  }

  /** A thump for a hit; `impulse` is how hard (≈ speed lost, px/s). */
  crash(impulse: number): void {
    const volume = clamp01(impulse / 700) * 0.6;
    if (volume < 0.03) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const gain = this.envelope(t, volume, 0.28);
    src.connect(filter).connect(gain);
    src.start(t, Math.random());
    src.stop(t + 0.3);
    this.tone(70, t, 0.2, volume * 0.8, 'sine');
  }

  /** A splash, driving into water; bigger the faster you go. */
  splash(speed: number): void {
    const volume = clamp01(speed / 500) * 0.5;
    if (volume < 0.04) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, t);
    filter.frequency.exponentialRampToValueAtTime(500, t + 0.4);
    filter.Q.value = 0.8;
    src.connect(filter).connect(this.envelope(t, volume, 0.45));
    src.start(t, Math.random());
    src.stop(t + 0.5);
  }

  /** The hollow "tock" of a cone being clipped. */
  cone(): void {
    this.tone(620, this.ctx.currentTime, 0.07, 0.15, 'triangle');
  }

  /** A startled "whoa!" from someone knocked off their feet. */
  yelp(): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(1150, t + 0.09);
    osc.frequency.exponentialRampToValueAtTime(640, t + 0.22);
    osc.connect(this.envelope(t, 0.12, 0.24));
    osc.start(t);
    osc.stop(t + 0.3);
  }

  /** A parked car's alarm going off: a few rising whoops. */
  alarm(): void {
    const t = this.ctx.currentTime;
    for (let k = 0; k < 4; k++) {
      const at = t + k * 0.32;
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(700, at);
      osc.frequency.exponentialRampToValueAtTime(1400, at + 0.28);
      osc.connect(this.envelope(at, 0.035, 0.3));
      osc.start(at);
      osc.stop(at + 0.32);
    }
  }

  /** Countdown beep: low for each red light, high for green. */
  startBeep(go: boolean): void {
    this.tone(go ? 880 : 440, this.ctx.currentTime, go ? 0.45 : 0.18, 0.18, 'square');
  }

  /** Lap complete; a rising arpeggio for a new best. */
  lapChime(best: boolean): void {
    const t = this.ctx.currentTime;
    const notes = best ? [660, 830, 990, 1320] : [660, 990];
    notes.forEach((f, i) => this.tone(f, t + i * 0.09, 0.22, 0.12, 'triangle'));
  }

  finish(): void {
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.12, 0.25, 0.13, 'triangle'));
  }

  /** Silences everything while paused (a quick fade, so it doesn't click), and brings it back on resume. */
  setPaused(paused: boolean): void {
    this.out.gain.setTargetAtTime(paused ? 0 : VOLUME, this.ctx.currentTime, 0.03);
  }

  destroy(): void {
    for (const e of this.engines) e.stop();
    this.squeal.stop();
    this.rumble.stop();
    this.slosh.stop();
    this.out.disconnect();
  }

  private tone(freq: number, at: number, length: number, volume: number, type: OscillatorType): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(this.envelope(at, volume, length));
    osc.start(at);
    osc.stop(at + length + 0.05);
  }

  /** A gain node that starts at `volume` and dies away over `length` seconds. */
  private envelope(at: number, volume: number, length: number): GainNode {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    gain.connect(this.out);
    return gain;
  }
}

/** One car's engine: a sawtooth plus a sub-octave square, through a filter that opens with the throttle. */
class Engine {
  private readonly saw: OscillatorNode;
  private readonly sub: OscillatorNode;
  private readonly filter: BiquadFilterNode;
  private readonly gain: GainNode;
  private readonly pan: StereoPannerNode | null;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    private readonly isPlayer: boolean,
  ) {
    this.saw = ctx.createOscillator();
    this.saw.type = 'sawtooth';
    this.sub = ctx.createOscillator();
    this.sub.type = 'square';
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 4;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    // Older browsers lack stereo panning; the engine still plays, just centred.
    this.pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    this.saw.connect(this.filter);
    this.sub.connect(this.filter);
    this.filter.connect(this.gain);
    if (this.pan) this.gain.connect(this.pan).connect(out);
    else this.gain.connect(out);
    this.saw.start();
    this.sub.start();
  }

  update({ speed, throttle, dx, dy }: EngineState): void {
    const gear = Math.floor(speed / GEAR_SPAN);
    const rev = (speed % GEAR_SPAN) / GEAR_SPAN;
    const freq = 52 + rev * 70 + gear * 10 + throttle * 6;
    const t = this.ctx.currentTime;
    this.saw.frequency.setTargetAtTime(freq, t, 0.04);
    this.sub.frequency.setTargetAtTime(freq / 2, t, 0.04);
    this.filter.frequency.setTargetAtTime(400 + throttle * 900 + speed, t, 0.05);
    const distance = Math.hypot(dx, dy);
    const volume = this.isPlayer ? 0.06 + throttle * 0.05 : 0.07 / (1 + distance / 250);
    this.gain.gain.setTargetAtTime(volume, t, 0.05);
    this.pan?.pan.setTargetAtTime(this.isPlayer ? 0 : clamp(dx / 600, -0.8, 0.8), t, 0.05);
  }

  stop(): void {
    this.saw.stop();
    this.sub.stop();
    this.gain.disconnect();
  }
}

/** Looping filtered noise whose volume is set continuously (tyre squeal, grass rumble). */
class Loop {
  private readonly src: AudioBufferSourceNode;
  private readonly filter: BiquadFilterNode;
  private readonly gain: GainNode;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    noise: AudioBuffer,
    type: BiquadFilterType,
    freq: number,
    q: number,
  ) {
    this.src = ctx.createBufferSource();
    this.src.buffer = noise;
    this.src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = type;
    this.filter.frequency.value = freq;
    this.filter.Q.value = q;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.src.connect(this.filter).connect(this.gain).connect(out);
    this.src.start();
  }

  set(volume: number, freq?: number): void {
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(volume, t, 0.06);
    if (freq !== undefined) this.filter.frequency.setTargetAtTime(freq, t, 0.06);
  }

  stop(): void {
    this.src.stop();
    this.gain.disconnect();
  }
}

/** Two seconds of white noise, shared by everything that needs it. */
function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
