/**
 * The car's sound, synthesised with the Web Audio API so there are no audio
 * files to load: the engine, tyres squealing, the rumble of grass, sloshing
 * through water, crashes, splashes and the knock of street furniture.
 * (Adapted from 2D Racer's RaceAudio.)
 *
 * It plays into Phaser's sound output, so Phaser's unlock-on-first-tap
 * handling (needed on iPhones) applies to it too.
 */

import type { SurfaceKind } from '../car/CarPhysics';
import type { Material } from '../world/damage';

export interface EngineState {
  /** px/s */
  speed: number;
  throttle: number;
  /** Sideways sliding speed, px/s. */
  slide: number;
  surface: SurfaceKind;
}

/** Speed range of each "gear", so the engine note rises and drops like it's changing up. */
const GEAR_SPAN = 110;
const VOLUME = 0.8;

export class CarAudio {
  private readonly out: GainNode;
  private readonly engine: Engine;
  private readonly squeal: Loop;
  private readonly rumble: Loop;
  private readonly slosh: Loop;
  private readonly noise: AudioBuffer;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = VOLUME;
    this.out.connect(destination);
    this.noise = makeNoise(ctx);
    this.engine = new Engine(ctx, this.out);
    this.squeal = new Loop(ctx, this.out, this.noise, 'bandpass', 2200, 6);
    this.rumble = new Loop(ctx, this.out, this.noise, 'lowpass', 260, 1);
    this.slosh = new Loop(ctx, this.out, this.noise, 'bandpass', 700, 1.5);
  }

  /** Call every frame. */
  update(car: EngineState): void {
    this.engine.update(car);
    const { surface, speed, slide } = car;
    // Tyres only squeal on a hard surface; grass and soil rumble instead.
    const hard = surface === 'road' || surface === 'pavement';
    this.squeal.set(hard ? clamp01((slide - 70) / 200) * 0.12 : 0, 1900 + Math.min(speed, 600));
    this.rumble.set(surface === 'grass' || surface === 'mud' ? clamp01(speed / 200) * 0.25 : surface === 'dirt' ? clamp01(speed / 400) * 0.1 + clamp01(slide / 200) * 0.1 : 0);
    this.slosh.set(surface === 'water' ? 0.3 * clamp01(speed / 160) : 0, 900);
  }

  /** A thump for a hit; `impulse` is how hard (≈ speed lost, px/s). */
  crash(impulse: number): void {
    const volume = clamp01(impulse / 450) * 0.6;
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
    const volume = clamp01(speed / 320) * 0.5;
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

  /**
   * Something breaking, by what it's made of: wood splitting, metal
   * clanging and fizzing, glass shattering, stone crumbling, a hedge torn
   * through, planks smashing. Louder the harder the hit.
   */
  shatter(material: Material, speed: number): void {
    const t = this.ctx.currentTime;
    const loud = 0.25 + clamp01(speed / 500) * 0.35;
    switch (material) {
      case 'wood':
        // A deep crack, then the splintering.
        this.noiseBurst(t, 'lowpass', 300, 0.6, loud, 0.5);
        this.noiseBurst(t + 0.05, 'bandpass', 1400, 2, loud * 0.5, 0.35);
        this.tone(55, t, 0.4, loud * 0.7, 'sine');
        break;
      case 'electric':
      case 'metal':
      case 'iron':
        // A clang: a few tones that don't quite go together, ringing on.
        for (const f of [220, 347, 581]) this.tone(f * (material === 'iron' ? 0.6 : 1), t, 0.6, loud * 0.25, 'triangle');
        this.noiseBurst(t, 'highpass', 3000, 1, loud * 0.3, 0.2);
        if (material === 'electric') this.noiseBurst(t + 0.1, 'bandpass', 5000, 4, loud * 0.25, 0.6);
        break;
      case 'glass':
        this.noiseBurst(t, 'highpass', 4000, 1, loud * 0.8, 0.5);
        for (const f of [2600, 3300, 4100]) this.tone(f, t + Math.random() * 0.1, 0.25, loud * 0.08, 'sine');
        break;
      case 'stone':
        // A thump and a long rumble of falling rubble.
        this.noiseBurst(t, 'lowpass', 400, 0.7, loud, 0.9);
        this.tone(45, t, 0.3, loud * 0.8, 'sine');
        break;
      case 'plant':
        this.noiseBurst(t, 'bandpass', 2200, 0.8, loud * 0.6, 0.45);
        break;
      case 'timber':
      case 'plastic':
        this.noiseBurst(t, 'bandpass', 900, 1.5, loud * 0.7, 0.25);
        this.tone(180, t, 0.12, loud * 0.4, 'triangle');
        break;
    }
  }

  /** The fizz of a broken light's wires sparking. */
  fizz(): void {
    this.noiseBurst(this.ctx.currentTime, 'bandpass', 5500, 5, 0.06, 0.12);
  }

  private noiseBurst(at: number, type: BiquadFilterType, freq: number, q: number, volume: number, length: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    src.connect(filter).connect(this.envelope(at, volume, length));
    src.start(at, Math.random());
    src.stop(at + length + 0.05);
  }

  /** Another car's horn, honked at you: two flat notes together, held; `volume` 0 to 1 (by how near it is). */
  horn(volume: number, long = false): void {
    if (volume < 0.03) return;
    const t = this.ctx.currentTime;
    const length = long ? 0.7 : 0.28;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06 * volume, t + 0.02);
    gain.gain.setValueAtTime(0.06 * volume, t + length - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    filter.connect(gain).connect(this.out);
    for (const f of [392, 494]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + length + 0.05);
    }
  }

  /** A car alarm's beep, `volume` 0 to 1 (by how near it is). */
  beep(volume: number): void {
    if (volume < 0.03) return;
    const t = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05 * volume, t + 0.01);
    gain.gain.setValueAtTime(0.05 * volume, t + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    gain.connect(this.out);
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1250, t);
    osc.frequency.setValueAtTime(950, t + 0.1);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  /** The hollow knock of a bench or bin sent flying. */
  knock(): void {
    this.tone(260, this.ctx.currentTime, 0.09, 0.18, 'triangle');
  }

  /** Bubbling as the car goes under. */
  sink(): void {
    const t = this.ctx.currentTime;
    for (let k = 0; k < 6; k++) {
      const at = t + 0.15 + k * 0.17 + Math.random() * 0.08;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(300 + Math.random() * 200, at);
      osc.frequency.exponentialRampToValueAtTime(700 + Math.random() * 300, at + 0.08);
      osc.connect(this.envelope(at, 0.08, 0.1));
      osc.start(at);
      osc.stop(at + 0.12);
    }
  }

  destroy(): void {
    this.engine.stop();
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

/** The engine: a sawtooth plus a sub-octave square, through a filter that opens with the throttle. */
class Engine {
  private readonly saw: OscillatorNode;
  private readonly sub: OscillatorNode;
  private readonly filter: BiquadFilterNode;
  private readonly gain: GainNode;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
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
    this.saw.connect(this.filter);
    this.sub.connect(this.filter);
    this.filter.connect(this.gain).connect(out);
    this.saw.start();
    this.sub.start();
  }

  update({ speed, throttle }: EngineState): void {
    const gear = Math.floor(speed / GEAR_SPAN);
    const rev = (speed % GEAR_SPAN) / GEAR_SPAN;
    const freq = 52 + rev * 70 + gear * 10 + throttle * 6;
    const t = this.ctx.currentTime;
    this.saw.frequency.setTargetAtTime(freq, t, 0.04);
    this.sub.frequency.setTargetAtTime(freq / 2, t, 0.04);
    this.filter.frequency.setTargetAtTime(400 + throttle * 900 + speed * 1.5, t, 0.05);
    this.gain.gain.setTargetAtTime(0.06 + throttle * 0.05, t, 0.05);
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
