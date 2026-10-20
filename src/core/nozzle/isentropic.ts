/** Calorically-perfect-gas isentropic relations. */

/** Prandtl-Meyer function nu(M), rad. */
export function prandtlMeyer(M: number, g: number): number {
  if (M <= 1) return 0;
  const k = (g + 1) / (g - 1);
  const s = Math.sqrt(M * M - 1);
  return Math.sqrt(k) * Math.atan(s / Math.sqrt(k)) - Math.atan(s);
}

/**
 * Inverse Prandtl-Meyer function: safeguarded Newton iteration on
 * s = sqrt(M^2 - 1) inside a maintained bracket (nu(s) is convex near s = 0
 * and concave for large s, so unguarded Newton can overshoot).
 */
export function machFromPrandtlMeyer(nu: number, g: number): number {
  if (nu <= 0) return 1;
  const k = (g + 1) / (g - 1);
  const sk = Math.sqrt(k);
  const numax = (sk - 1) * (Math.PI / 2);
  if (nu >= numax) return 1e6;
  const f = (s: number) => sk * Math.atan(s / sk) - Math.atan(s) - nu;
  let lo = 0;
  let hi = 1;
  while (f(hi) < 0) {
    lo = hi;
    hi *= 2;
  }
  // Small-nu expansion nu ~ s^3 (1 - 1/k) / 3 gives the starting guess.
  let s = Math.min(hi, Math.max(lo, Math.cbrt((3 * nu) / (1 - 1 / k))));
  for (let i = 0; i < 100; i++) {
    const fs = f(s);
    if (fs < 0) lo = s;
    else hi = s;
    const s2 = s * s;
    const df = 1 / (1 + s2 / k) - 1 / (1 + s2);
    let next = s - fs / df;
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
    if (Math.abs(next - s) < 1e-14 * (1 + s)) {
      s = next;
      break;
    }
    s = next;
  }
  return Math.sqrt(1 + s * s);
}

export const pressureRatio = (M: number, g: number) => Math.pow(1 + 0.5 * (g - 1) * M * M, -g / (g - 1));
export const densityRatio = (M: number, g: number) => Math.pow(1 + 0.5 * (g - 1) * M * M, -1 / (g - 1));
export const temperatureRatio = (M: number, g: number) => 1 / (1 + 0.5 * (g - 1) * M * M);

/** Mach number from the critical-speed ratio W = V / a*. */
export function machFromCriticalRatio(W: number, g: number): number {
  const W2 = W * W;
  return Math.sqrt(((2 / (g + 1)) * W2) / (1 - ((g - 1) / (g + 1)) * W2));
}

/** Mass-flow function Gamma(g) = sqrt(g) (2/(g+1))^((g+1)/(2(g-1))). */
export const vandenkerckhove = (g: number) => Math.sqrt(g) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));

/** Ideal 1-D thrust coefficient for area ratio eps with exit pressure ratio pe/p0 and ambient pa/p0. */
export function idealThrustCoefficient(g: number, eps: number, peOverP0: number, paOverP0 = 0): number {
  const G = vandenkerckhove(g);
  return G * Math.sqrt(((2 * g) / (g - 1)) * (1 - Math.pow(peOverP0, (g - 1) / g))) + (peOverP0 - paOverP0) * eps;
}
