/**
 * Latitude and longitude (WGS84, as OpenStreetMap uses) to the Ordnance
 * Survey's National Grid (eastings and northings in metres, as the
 * Environment Agency's LIDAR uses): a Helmert shift onto the Airy 1830
 * ellipsoid, then the National Grid's transverse Mercator. Good to a few
 * metres, and the map tool lines the LIDAR up with the buildings to take
 * out what's left.
 */

const WGS84 = { a: 6378137, b: 6356752.3142 };
const AIRY = { a: 6377563.396, b: 6356256.909 };

/** WGS84 to OSGB36. */
const HELMERT = { tx: -446.448, ty: 125.157, tz: -542.06, s: 20.4894e-6, rx: -0.1502, ry: -0.247, rz: -0.8421 };

const DEG = Math.PI / 180;
const ARCSEC = DEG / 3600;

function toCartesian(lat: number, lon: number, { a, b }: { a: number; b: number }): [number, number, number] {
  const e2 = 1 - (b * b) / (a * a);
  const sin = Math.sin(lat);
  const nu = a / Math.sqrt(1 - e2 * sin * sin);
  return [nu * Math.cos(lat) * Math.cos(lon), nu * Math.cos(lat) * Math.sin(lon), nu * (1 - e2) * sin];
}

function fromCartesian(x: number, y: number, z: number, { a, b }: { a: number; b: number }): [number, number] {
  const e2 = 1 - (b * b) / (a * a);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 10; i++) {
    const sin = Math.sin(lat);
    const nu = a / Math.sqrt(1 - e2 * sin * sin);
    lat = Math.atan2(z + e2 * nu * sin, p);
  }
  return [lat, Math.atan2(y, x)];
}

/** Eastings and northings, metres, for a WGS84 latitude and longitude in degrees. */
export function toNationalGrid(latDeg: number, lonDeg: number): [number, number] {
  const [x1, y1, z1] = toCartesian(latDeg * DEG, lonDeg * DEG, WGS84);
  const { tx, ty, tz, s, rx, ry, rz } = HELMERT;
  const [rX, rY, rZ] = [rx * ARCSEC, ry * ARCSEC, rz * ARCSEC];
  const x2 = tx + (1 + s) * x1 - rZ * y1 + rY * z1;
  const y2 = ty + rZ * x1 + (1 + s) * y1 - rX * z1;
  const z2 = tz - rY * x1 + rX * y1 + (1 + s) * z1;
  const [lat, lon] = fromCartesian(x2, y2, z2, AIRY);

  // The National Grid's projection.
  const { a, b } = AIRY;
  const F0 = 0.9996012717;
  const lat0 = 49 * DEG;
  const lon0 = -2 * DEG;
  const N0 = -100000;
  const E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const sin = Math.sin(lat);
  const cos = Math.cos(lat);
  const tan = Math.tan(lat);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sin * sin);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sin * sin, 1.5);
  const eta2 = nu / rho - 1;
  const dLat = lat - lat0;
  const sLat = lat + lat0;
  const M =
    b *
    F0 *
    ((1 + n + (5 / 4) * n * n + (5 / 4) * n ** 3) * dLat -
      (3 * n + 3 * n * n + (21 / 8) * n ** 3) * Math.sin(dLat) * Math.cos(sLat) +
      ((15 / 8) * n * n + (15 / 8) * n ** 3) * Math.sin(2 * dLat) * Math.cos(2 * sLat) -
      (35 / 24) * n ** 3 * Math.sin(3 * dLat) * Math.cos(3 * sLat));
  const I = M + N0;
  const II = (nu / 2) * sin * cos;
  const III = (nu / 24) * sin * cos ** 3 * (5 - tan * tan + 9 * eta2);
  const IIIA = (nu / 720) * sin * cos ** 5 * (61 - 58 * tan * tan + tan ** 4);
  const IV = nu * cos;
  const V = (nu / 6) * cos ** 3 * (nu / rho - tan * tan);
  const VI = (nu / 120) * cos ** 5 * (5 - 18 * tan * tan + tan ** 4 + 14 * eta2 - 58 * tan * tan * eta2);
  const dLon = lon - lon0;
  const N = I + II * dLon ** 2 + III * dLon ** 4 + IIIA * dLon ** 6;
  const E = E0 + IV * dLon + V * dLon ** 3 + VI * dLon ** 5;
  return [E, N];
}
