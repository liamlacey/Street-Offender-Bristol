/**
 * The old top-down games' perspective: the camera looks straight down from
 * high above the car, so anything higher than the car (a roof, a treetop, a
 * hill) is nearer the camera and drawn pushed out from the middle of the
 * view, and anything lower is drawn pulled in towards it. Everything that
 * stands up off the map (or lies on the hills) is drawn through this.
 */
export class Perspective {
  /** The middle of the view, map px. */
  cx = 0;
  cy = 0;
  /** How high the camera is above `ground`, px. */
  height = 1250;
  /** The height the camera's measured from (the car's ground), px. */
  ground = 0;

  /** How much a point at height `z` (px, the same scale as `ground`) is scaled out from the middle of the view. */
  lift(z: number): number {
    const h = Math.min(z - this.ground, this.height * 0.8);
    return 1 + h / (this.height - h);
  }

  x(x: number, s: number): number {
    return this.cx + (x - this.cx) * s;
  }

  y(y: number, s: number): number {
    return this.cy + (y - this.cy) * s;
  }
}
