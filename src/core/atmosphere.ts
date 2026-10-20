/** U.S. Standard Atmosphere 1976 pressure (geopotential layers to 84.85 km). */
const LAYERS = [
  { h: 0, T: 288.15, L: -0.0065, p: 101325 },
  { h: 11000, T: 216.65, L: 0, p: 22632.06 },
  { h: 20000, T: 216.65, L: 0.001, p: 5474.889 },
  { h: 32000, T: 228.65, L: 0.0028, p: 868.0187 },
  { h: 47000, T: 270.65, L: 0, p: 110.9063 },
  { h: 51000, T: 270.65, L: -0.0028, p: 66.93887 },
  { h: 71000, T: 214.65, L: -0.002, p: 3.956420 },
  { h: 84852, T: 186.946, L: 0, p: 0.3734 },
];
const G0 = 9.80665;
const R_AIR = 287.0531;
const R_EARTH = 6356766;

/** Ambient pressure at geometric altitude z [m], Pa. */
export function ambientPressure(z: number): number {
  const h = (R_EARTH * z) / (R_EARTH + z);
  let b = LAYERS[0];
  for (const l of LAYERS) if (h >= l.h) b = l;
  if (b.L === 0) return b.p * Math.exp((-G0 * (h - b.h)) / (R_AIR * b.T));
  return b.p * Math.pow(b.T / (b.T + b.L * (h - b.h)), G0 / (R_AIR * b.L));
}
