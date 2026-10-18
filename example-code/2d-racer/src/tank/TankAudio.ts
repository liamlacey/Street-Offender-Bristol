/**
 * Tank World's sound, synthesised like the racing's: the tank's diesel and
 * the clatter of its tracks, rockets launching, explosions near and far,
 * stone crumbling, wood splintering, buildings coming down, and the crackle
 * of whatever's burning nearby. Plays into Phaser's sound output, so its mute
 * switch and the iPhone unlock apply.
 */

const VOLUME = 0.8;

export class TankAudio {
  private readonly out: GainNode;
  private readonly noise: AudioBuffer;
  private readonly engine: OscillatorNode;
  private readonly engineSub: OscillatorNode;
  private readonly engineGain: GainNode;
  private readonly tracks: Loop;
  private readonly fire: Loop;
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = VOLUME;
    this.out.connect(destination);
    this.noise = makeNoise(ctx);
    // A low, lumpy diesel: a sawtooth and a square an octave down, through a low filter.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.05;
    this.engine = ctx.createOscillator();
    this.engine.type = 'sawtooth';
    this.engine.frequency.value = 42;
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    this.engineSub.frequency.value = 21;
    const sub = ctx.createGain();
    sub.gain.value = 0.5;
    this.engine.connect(filter);
    this.engineSub.connect(sub).connect(filter);
    filter.connect(this.engineGain).connect(this.out);
    this.engine.start();
    this.engineSub.start();
    this.tracks = new Loop(ctx, this.out, this.noise, 'bandpass', 900, 3);
    this.fire = new Loop(ctx, this.out, this.noise, 'bandpass', 2400, 0.7);
  }

  /** The police siren, wailing up and down: `near` 0 (none, or far off) to 1 (right here); `time` in s. */
  siren(near: number, time: number): void {
    if (!this.sirenOsc) {
      if (near <= 0) return;
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain).connect(this.out);
      this.sirenOsc.start();
    }
    const t = this.ctx.currentTime;
    this.sirenOsc.frequency.setTargetAtTime(700 + Math.sin(time * Math.PI * 1.4) * 220, t, 0.05);
    this.sirenGain!.gain.setTargetAtTime(near * near * 0.05, t, 0.1);
  }

  /** Each frame: how fast the tank's going (0..1), and how much is burning within earshot (0..1). */
  update(speed: number, burning: number): void {
    const t = this.ctx.currentTime;
    this.engine.frequency.setTargetAtTime(42 + speed * 38, t, 0.1);
    this.engineSub.frequency.setTargetAtTime(21 + speed * 19, t, 0.1);
    this.engineGain.gain.setTargetAtTime(0.05 + speed * 0.07, t, 0.1);
    this.tracks.set(speed * 0.1, 700 + speed * 600);
    // The fire's crackle flickers.
    this.fire.set(burning * (0.05 + Math.random() * 0.07), 1800 + Math.random() * 1600);
  }

  /** A rocket leaving the barrel: a thump and a rushing hiss. */
  launch(): void {
    const t = this.ctx.currentTime;
    this.burst(t, 0.25, 0.45, 'bandpass', 1400, 400);
    this.tone(90, 40, t, 0.18, 0.4, 'sine');
  }

  /** An explosion: a deep boom and a roar, quieter and duller the further off; bigger blasts are longer. */
  explosion(size: number, distance: number): void {
    const near = Math.max(0, 1 - distance / 1600);
    if (near <= 0) return;
    const t = this.ctx.currentTime;
    const big = Math.min(2, size / 80);
    this.burst(t, 0.5 * near * Math.min(1.2, big), 0.6 + big * 0.5, 'lowpass', 1200 * near + 300, 150);
    this.tone(70, 28, t, 0.8 + big * 0.4, 0.7 * near, 'sine');
  }

  /** Stone breaking up: a gravelly rattle. */
  crumble(distance: number): void {
    const near = Math.max(0, 1 - distance / 1200);
    if (near > 0) this.burst(this.ctx.currentTime, 0.3 * near, 0.5, 'bandpass', 600, 300);
  }

  /** Wood cracking and splintering. */
  splinter(distance: number): void {
    const near = Math.max(0, 1 - distance / 1200);
    if (near <= 0) return;
    const t = this.ctx.currentTime;
    for (let k = 0; k < 3; k++) this.burst(t + k * 0.05, 0.22 * near, 0.08, 'highpass', 2500, 2500);
  }

  /** A building coming down: a long low rumble. */
  collapse(distance: number): void {
    const near = Math.max(0, 1 - distance / 1500);
    if (near > 0) this.burst(this.ctx.currentTime, 0.4 * near, 1.4, 'lowpass', 400, 120);
  }

  setPaused(paused: boolean): void {
    this.out.gain.setTargetAtTime(paused ? 0 : VOLUME, this.ctx.currentTime, 0.03);
  }

  destroy(): void {
    this.engine.stop();
    this.engineSub.stop();
    this.tracks.stop();
    this.fire.stop();
    this.sirenOsc?.stop();
    this.out.disconnect();
  }

  /** A burst of filtered noise, its filter sweeping from `from` to `to` Hz. */
  private burst(at: number, volume: number, length: number, type: BiquadFilterType, from: number, to: number): void {
    if (volume < 0.01) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + length);
    src.connect(filter).connect(this.envelope(at, volume, length));
    src.start(at, Math.random());
    src.stop(at + length + 0.05);
  }

  private tone(from: number, to: number, at: number, length: number, volume: number, type: OscillatorType): void {
    if (volume < 0.01) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + length);
    osc.connect(this.envelope(at, volume, length));
    osc.start(at);
    osc.stop(at + length + 0.05);
  }

  private envelope(at: number, volume: number, length: number): GainNode {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    gain.connect(this.out);
    return gain;
  }
}

/** Looping filtered noise whose volume is set continuously. */
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

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
