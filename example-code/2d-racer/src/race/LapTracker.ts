/**
 * Lap counting from distance along the track.
 *
 * The track is split into equal sectors; the start of each sector is a
 * checkpoint, with checkpoint 0 on the start/finish line. A checkpoint only
 * counts when it's the next one expected, so a lap needs every sector driven in
 * order. Cutting across the grass past a whole sector means going back for the
 * missed checkpoint, and reversing back and forth over the line does nothing.
 *
 * Skipping a checkpoint is flagged as soon as it happens (the car turns up in a
 * sector past the one it should be in) and stays flagged until the car goes
 * back and drives through the missed checkpoint.
 */

export interface LapResult {
  /** The lap just completed (1 = first lap). */
  lap: number;
  /** Lap time in seconds. */
  time: number;
  /** True if this lap beat the previous best (or there was none). */
  isBest: boolean;
  /** The best lap before this one, if any. */
  previousBest: number | null;
}

export class LapTracker {
  /** Current lap number; 0 until the car first crosses the start line. */
  lap = 0;
  lastLap: number | null = null;
  bestLap: number | null;
  /** True from skipping a checkpoint until the car goes back through it. */
  missedCheckpoint = false;
  private lapStartTime = 0;
  private nextSector = 0;
  private readonly sectorLength: number;

  constructor(
    trackLength: number,
    private readonly sectors = 12,
    bestLap: number | null = null,
  ) {
    this.sectorLength = trackLength / sectors;
    this.bestLap = bestLap;
  }

  /**
   * Call every physics step with the car's distance along the track and the race
   * clock in seconds. Returns the result when a lap is completed.
   */
  update(along: number, time: number): LapResult | null {
    const sector = Math.min(this.sectors - 1, Math.max(0, Math.floor(along / this.sectorLength)));
    if (sector !== this.nextSector) {
      // How many sectors past the expected one the car is. Small = it skipped
      // ahead; large = it's behind (driving backwards), which isn't a miss.
      const ahead = (sector - this.nextSector + this.sectors) % this.sectors;
      const current = (this.nextSector - 1 + this.sectors) % this.sectors;
      if (sector !== current && ahead <= this.sectors / 2) this.missedCheckpoint = true;
      return null;
    }

    this.missedCheckpoint = false;
    this.nextSector = (sector + 1) % this.sectors;
    if (sector !== 0) return null;

    // Crossed the start/finish line with every checkpoint done.
    let result: LapResult | null = null;
    if (this.lap > 0) {
      const lapTime = time - this.lapStartTime;
      const previousBest = this.bestLap;
      const isBest = previousBest === null || lapTime < previousBest;
      if (isBest) this.bestLap = lapTime;
      this.lastLap = lapTime;
      result = { lap: this.lap, time: lapTime, isBest, previousBest };
    }
    this.lap++;
    this.lapStartTime = time;
    return result;
  }

  /** Distance along the track of the next checkpoint the car must pass (0 = start/finish line). */
  get nextCheckpointAlong(): number {
    return this.nextSector * this.sectorLength;
  }

  /**
   * Total distance raced from the start line, for working out race positions.
   * Negative before the first crossing (on the grid).
   */
  progress(along: number): number {
    const length = this.sectorLength * this.sectors;
    let a = along;
    // Early in a lap but showing a position near the end of the track: the car
    // has backed over the line, so it's at the end of the previous lap.
    if (this.nextSector !== 0 && this.nextSector <= this.sectors / 2 && a > length / 2) a -= length;
    return (this.lap - 1) * length + a;
  }

  /** Time into the current lap in seconds (0 before the first lap starts). */
  currentLapTime(time: number): number {
    return this.lap > 0 ? time - this.lapStartTime : 0;
  }
}
