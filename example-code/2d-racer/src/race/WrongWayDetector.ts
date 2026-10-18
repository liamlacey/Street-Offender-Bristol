/**
 * Flags driving the wrong way round the track. A brief wiggle backwards
 * (spinning out, reversing out of a wall) shouldn't trigger it, so the car has
 * to be moving against the track for a while first.
 */
export class WrongWayDetector {
  wrongWay = false;
  private backwardsFor = 0;

  constructor(
    /** Speed in px/s along the track, backwards, before it counts. */
    private readonly minSpeed = 60,
    /** Seconds of driving backwards before the warning shows. */
    private readonly delay = 0.8,
  ) {}

  /** `speedAlongTrack` is the car's velocity projected on the track direction (negative = backwards). */
  update(speedAlongTrack: number, dt: number): boolean {
    if (speedAlongTrack < -this.minSpeed) {
      this.backwardsFor += dt;
      if (this.backwardsFor >= this.delay - 1e-9) this.wrongWay = true;
    } else if (speedAlongTrack > this.minSpeed) {
      this.backwardsFor = 0;
      this.wrongWay = false;
    }
    return this.wrongWay;
  }
}
