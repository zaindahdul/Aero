/**
 * Axisymmetric method of characteristics (MoC) analysis of a supersonic nozzle
 * with a prescribed wall, for an irrotational, homentropic perfect gas.
 *
 * - Near-sonic uniform initial-value line in the throat plane, clustered
 *   toward the wall to resolve the throat-arc expansion; the curved-sonic-line
 *   mass-flow deficit is applied through the Kliegel-Levine discharge
 *   coefficient.
 * - Interior, wall and axis unit processes with a modified-Euler
 *   predictor/corrector (second order).
 * - Compatibility relations in arc-length form,
 *     C+ (dir theta + mu):  d(theta - nu) = -(sin mu sin theta / r) ds
 *     C- (dir theta - mu):  d(theta + nu) = +(sin mu sin theta / r) ds
 *   which stay finite where the characteristics are near-vertical (M -> 1).
 * - Weak internal shocks (characteristic coalescence, common in conical and
 *   thrust-optimized parabolic nozzles) are captured by merging the crossing
 *   characteristics, the isentropic weak-shock approximation; fronts are
 *   regridded to hold resolution.
 * - Thrust from the momentum flux across the initial-value line plus the
 *   integral of wall pressure, cross-checked against the exit-plane balance.
 *
 * All lengths are normalized by the throat radius; stagnation p0 = rho0 = 1.
 */
import { densityRatio, idealThrustCoefficient, machFromPrandtlMeyer, prandtlMeyer, pressureRatio, vandenkerckhove } from './isentropic';
import { supersonicMachFromArea } from '../thermo/rocket';
import { findRoot } from '../math/linalg';

export interface MocWall {
  /** Wall radius and slope angle (rad) at x >= 0; must extend beyond xExit. */
  (x: number): { r: number; angle: number };
}

export interface MocInput {
  gamma: number;
  wall: MocWall;
  xExit: number;
  /** Throat wall radius of curvature / Rt, for the discharge coefficient. */
  rcThroat: number;
  /** Number of intervals along the initial-value line. */
  resolution?: number;
  /** Mach number of the initial-value line. */
  startMach?: number;
  maxPoints?: number;
}

export interface MocResult {
  gamma: number;
  xExit: number;
  rExit: number;
  eps: number;
  /** Net points. */
  x: Float64Array;
  r: Float64Array;
  mach: Float64Array;
  theta: Float64Array;
  /** Upstream point along the C+ (left-running) and C- (right-running) characteristic, -1 if none. */
  parentPlus: Int32Array;
  parentMinus: Int32Array;
  /** Triangulation of the net for field rendering. */
  triangles: Uint32Array;
  wall: { x: number[]; r: number[]; mach: number[]; pressure: number[] };
  exitProfile: { r: number[]; mach: number[]; theta: number[]; pressure: number[] };
  /** Vacuum thrust coefficient F / (p0 At) including the discharge coefficient. */
  cfVac: number;
  /** Ideal 1-D vacuum thrust coefficient at the same area ratio. */
  cfVac1D: number;
  /** Kliegel-Levine discharge coefficient. */
  dischargeCoefficient: number;
  /** Specific-impulse efficiency vs ideal 1-D flow (divergence + non-uniformity). */
  efficiency: number;
  /** Exit-plane momentum balance vs IVL + wall integral (numerical-quality metric). */
  balanceError: number;
  massBalanceError: number;
  /** First characteristic coalescence (internal shock formation), normalized coordinates. */
  shock: { x: number; r: number } | null;
  mergedCharacteristics: number;
  complete: boolean;
}

interface Pt {
  x: number;
  r: number;
  th: number;
  nu: number;
  M: number;
  mu: number;
  id: number;
}

/**
 * Kliegel & Levine (1969) discharge coefficient of an axisymmetric nozzle with
 * throat wall radius of curvature R (normalized by the throat radius).
 */
export function dischargeCoefficient(g: number, R: number): number {
  const a = R + 1;
  return 1 - ((g + 1) / (a * a)) * (1 / 96 - (8 * g - 27) / (2304 * a) + (754 * g * g - 757 * g + 3633) / (276480 * a * a));
}

export function runMoc(input: MocInput): MocResult {
  const g = input.gamma;
  const N = input.resolution ?? 40;
  const maxPoints = input.maxPoints ?? 600_000;
  const M0 = input.startMach ?? 1.01;
  const { wall, xExit } = input;
  const rExit = wall(xExit).r;

  const X: number[] = [];
  const R: number[] = [];
  const MA: number[] = [];
  const TH: number[] = [];
  const PP: number[] = [];
  const PM: number[] = [];
  const tris: number[] = [];

  const make = (x: number, r: number, th: number, nu: number, pPlus: number, pMinus: number): Pt => {
    const M = machFromPrandtlMeyer(nu, g);
    const p: Pt = { x, r, th, nu, M, mu: Math.asin(1 / M), id: X.length };
    X.push(x);
    R.push(r);
    MA.push(M);
    TH.push(th);
    PP.push(pPlus);
    PM.push(pMinus);
    return p;
  };

  const Q = (th: number, mu: number, r: number) => (r > 1e-12 ? (Math.sin(mu) * Math.sin(th)) / r : 0);

  // ---------- Initial-value line: uniform near-sonic flow across the throat ----------
  const nu0 = prandtlMeyer(M0, g);
  const rt = wall(0).r;
  let line: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    line.push(make(0, rt * Math.sin((0.5 * Math.PI * k) / N), 0, nu0, -1, -1));
  }
  const ivl = line.slice();

  // ---------- Unit processes ----------
  const interior = (A: Pt, B: Pt): Pt => {
    let thA = A.th;
    let muA = A.mu;
    let qA = Q(A.th, A.mu, A.r);
    let thB = B.th;
    let muB = B.mu;
    let qB = Q(B.th, B.mu, B.r);
    let x = 0;
    let r = 0;
    let th = 0;
    let nu = 0;
    for (let it = 0; it < 4; it++) {
      const a1 = thA + muA;
      const a2 = thB - muB;
      const det = Math.sin(a1 - a2);
      const dx = B.x - A.x;
      const dr = B.r - A.r;
      const s1 = (dr * Math.cos(a2) - dx * Math.sin(a2)) / det;
      const s2 = (dr * Math.cos(a1) - dx * Math.sin(a1)) / det;
      x = A.x + s1 * Math.cos(a1);
      r = A.r + s1 * Math.sin(a1);
      const sum = B.th + B.nu + qB * Math.abs(s2);
      const dif = A.th - A.nu - qA * Math.abs(s1);
      th = 0.5 * (sum + dif);
      nu = Math.max(1e-9, 0.5 * (sum - dif));
      const M = machFromPrandtlMeyer(nu, g);
      const mu = Math.asin(1 / M);
      thA = 0.5 * (A.th + th);
      muA = 0.5 * (A.mu + mu);
      qA = Q(thA, muA, 0.5 * (A.r + r));
      thB = 0.5 * (B.th + th);
      muB = 0.5 * (B.mu + mu);
      qB = Q(thB, muB, 0.5 * (B.r + r));
    }
    return make(x, r, th, nu, A.id, B.id);
  };

  const wallPt = (A: Pt): Pt => {
    let a1 = A.th + A.mu;
    let qA = Q(A.th, A.mu, A.r);
    let x = 0;
    let r = 0;
    let th = 0;
    let nu = 0;
    for (let it = 0; it < 4; it++) {
      const c = Math.cos(a1);
      const s = Math.sin(a1);
      const f = (t: number) => A.r + t * s - wall(A.x + t * c).r;
      let hi = Math.max(1e-6, 0.05 * A.r);
      let guard = 0;
      while (f(hi) < 0 && guard++ < 80) hi *= 1.6;
      const t = f(0) >= 0 ? 0 : findRoot(f, 0, hi, 1e-13);
      x = A.x + t * c;
      const w = wall(x);
      r = w.r;
      th = w.angle;
      nu = Math.max(1e-9, th - (A.th - A.nu - qA * t));
      const M = machFromPrandtlMeyer(nu, g);
      const mu = Math.asin(1 / M);
      a1 = 0.5 * (A.th + th) + 0.5 * (A.mu + mu);
      qA = Q(0.5 * (A.th + th), 0.5 * (A.mu + mu), 0.5 * (A.r + r));
    }
    return make(x, r, th, nu, A.id, -1);
  };

  const axisPt = (B: Pt): Pt => {
    let a2 = B.th - B.mu;
    let qB = Q(B.th, B.mu, B.r);
    let x = 0;
    let nu = 0;
    for (let it = 0; it < 4; it++) {
      const t = -B.r / Math.sin(a2);
      x = B.x + t * Math.cos(a2);
      nu = Math.max(1e-9, B.th + B.nu + qB * t);
      const M = machFromPrandtlMeyer(nu, g);
      const mu = Math.asin(1 / M);
      a2 = 0.5 * B.th - 0.5 * (B.mu + mu);
      qB = Q(0.5 * B.th, 0.5 * (B.mu + mu), 0.5 * B.r);
    }
    return make(x, 0, 0, nu, -1, B.id);
  };

  const blend = (a: Pt, b: Pt, t: number): Pt =>
    make(a.x + t * (b.x - a.x), a.r + t * (b.r - a.r), a.th + t * (b.th - a.th), a.nu + t * (b.nu - a.nu), -1, -1);

  // ---------- March the net ----------
  // Lines alternate between "full" (axis + interior + wall) and "inner"
  // (interior points between consecutive points of a full line).
  const wallPoints: Pt[] = [ivl[N]];
  let shock: MocResult['shock'] = null;
  let merged = 0;
  let isFull = true;
  let lastWallX = 0;
  let complete = false;
  let prevFull = line;
  while (X.length < maxPoints) {
    let next: Pt[] = [];
    if (isFull) {
      for (let i = 0; i < line.length - 1; i++) next.push(interior(line[i], line[i + 1]));
    } else {
      next.push(axisPt(line[0]));
      for (let i = 0; i < line.length - 1; i++) next.push(interior(line[i], line[i + 1]));
      next.push(wallPt(line[line.length - 1]));
    }
    const nextIsFull = !isFull;

    // Coalescence: a fold in the radial ordering means same-family
    // characteristics crossed. Merge the offending pair (keeping boundary points).
    for (let pass = 0; pass < next.length; pass++) {
      let fixed = true;
      for (let i = 1; i < next.length; i++) {
        const bad = !(next[i].r > next[i - 1].r + 1e-12) || !Number.isFinite(next[i].nu);
        if (!bad) continue;
        fixed = false;
        if (!shock && Number.isFinite(next[i].x)) shock = { x: next[i].x, r: Math.max(0, next[i].r) };
        merged++;
        const last = next.length - 1;
        if (nextIsFull && i === 1) next.splice(1, 1);
        else if (nextIsFull && i === last) next.splice(last - 1, 1);
        else next.splice(i - 1, 2, blend(next[i - 1], next[i], 0.5));
        break;
      }
      if (fixed) break;
    }
    // Regrid: restore the nominal point count by splitting the longest gaps.
    const target = nextIsFull ? N + 1 : N;
    while (next.length < target && next.length >= 2) {
      let best = 0;
      let bestLen = -1;
      for (let i = 0; i + 1 < next.length; i++) {
        const len = Math.hypot(next[i + 1].x - next[i].x, next[i + 1].r - next[i].r);
        if (len > bestLen) {
          bestLen = len;
          best = i;
        }
      }
      next.splice(best + 1, 0, blend(next[best], next[best + 1], 0.5));
    }
    if (next.length < 3) break;

    zipper(line, next, tris);
    if (nextIsFull) {
      // Close the slivers along the axis and the wall between consecutive full lines.
      tris.push(prevFull[0].id, line[0].id, next[0].id);
      tris.push(prevFull[prevFull.length - 1].id, next[next.length - 1].id, line[line.length - 1].id);
      prevFull = next;
      const w = next[next.length - 1];
      wallPoints.push(w);
      lastWallX = w.x;
    }
    line = next;
    isFull = nextIsFull;
    let minX = Infinity;
    for (const p of line) minX = Math.min(minX, p.x);
    if (minX > xExit && lastWallX > xExit) {
      complete = true;
      break;
    }
  }

  // ---------- Integrals ----------
  const flux = (M: number, th: number) => {
    const p = pressureRatio(M, g);
    const rho = densityRatio(M, g);
    const V = M * Math.sqrt((g * p) / rho);
    return { p, rho, vx: V * Math.cos(th), vr: V * Math.sin(th) };
  };

  // Mass and axial momentum through the IVL (axis -> wall).
  let mdot = 0;
  let fIvl = 0;
  for (let k = 0; k < N; k++) {
    const a = ivl[k];
    const b = ivl[k + 1];
    const fa = flux(a.M, a.th);
    const fb = flux(b.M, b.th);
    const dx = b.x - a.x;
    const dr = b.r - a.r;
    mdot += Math.PI * (fa.rho * a.r * (fa.vx * dr - fa.vr * dx) + fb.rho * b.r * (fb.vx * dr - fb.vr * dx));
    const iA = a.r * (fa.rho * fa.vx * (fa.vx * dr - fa.vr * dx) + fa.p * dr);
    const iB = b.r * (fb.rho * fb.vx * (fb.vx * dr - fb.vr * dx) + fb.p * dr);
    fIvl += Math.PI * (iA + iB);
  }

  // Wall pressure integral up to the exit plane.
  const wx: number[] = [];
  const wr: number[] = [];
  const wm: number[] = [];
  for (let i = 0; i < wallPoints.length; i++) {
    const p = wallPoints[i];
    if (p.x > xExit && i > 0) {
      const prev = wallPoints[i - 1];
      const t = (xExit - prev.x) / (p.x - prev.x);
      wx.push(xExit);
      wr.push(rExit);
      wm.push(prev.M + t * (p.M - prev.M));
      break;
    }
    wx.push(p.x);
    wr.push(p.r);
    wm.push(p.M);
  }
  const wp = wm.map((M) => pressureRatio(M, g));
  let fWall = 0;
  for (let i = 0; i + 1 < wx.length; i++) fWall += 0.5 * (wp[i] + wp[i + 1]) * Math.PI * (wr[i + 1] ** 2 - wr[i] ** 2);

  const fVac = fIvl + fWall;
  const eps = rExit * rExit;
  const Me1D = supersonicMachFromArea(eps, g);
  const cfVac1D = idealThrustCoefficient(g, eps, pressureRatio(Me1D, g));
  const mdot1D = Math.PI * vandenkerckhove(g);
  const cd = dischargeCoefficient(g, input.rcThroat);
  // Isp efficiency: thrust per unit mass flow relative to ideal 1-D flow.
  const efficiency = fVac / mdot / (cfVac1D / vandenkerckhove(g));
  const cfVac = (fVac / mdot) * (mdot1D / Math.PI) * cd;

  // ---------- Exit-plane profile by interpolation on the triangulated net ----------
  const tri = Uint32Array.from(tris);
  const exitProfile = sampleAtX(X, R, MA, TH, tri, xExit, rExit, 48);
  let mdotE = 0;
  let fE = 0;
  for (let k = 0; k + 1 < exitProfile.r.length; k++) {
    const ra = exitProfile.r[k];
    const rb = exitProfile.r[k + 1];
    const fa = flux(exitProfile.mach[k], exitProfile.theta[k]);
    const fb = flux(exitProfile.mach[k + 1], exitProfile.theta[k + 1]);
    mdotE += Math.PI * (rb - ra) * (fa.rho * fa.vx * ra + fb.rho * fb.vx * rb);
    fE += Math.PI * (rb - ra) * ((fa.rho * fa.vx * fa.vx + fa.p) * ra + (fb.rho * fb.vx * fb.vx + fb.p) * rb);
  }
  exitProfile.pressure = exitProfile.mach.map((M) => pressureRatio(M, g));

  return {
    gamma: g,
    xExit,
    rExit,
    eps,
    x: Float64Array.from(X),
    r: Float64Array.from(R),
    mach: Float64Array.from(MA),
    theta: Float64Array.from(TH),
    parentPlus: Int32Array.from(PP),
    parentMinus: Int32Array.from(PM),
    triangles: tri,
    wall: { x: wx, r: wr, mach: wm, pressure: wp },
    exitProfile,
    cfVac,
    cfVac1D,
    dischargeCoefficient: cd,
    efficiency,
    balanceError: Math.abs(fE - fVac) / fVac,
    massBalanceError: Math.abs(mdotE - mdot) / mdot,
    shock,
    mergedCharacteristics: merged,
    complete,
  };
}

/** Triangulates the strip between two fronts ordered from axis to wall. */
function zipper(a: Pt[], b: Pt[], out: number[]) {
  let i = 0;
  let j = 0;
  const na = a.length;
  const nb = b.length;
  while (i < na - 1 || j < nb - 1) {
    const advanceA =
      j >= nb - 1 || (i < na - 1 && (a[i + 1].r + a[i].r) / (a[na - 1].r || 1) < (b[j + 1].r + b[j].r) / (b[nb - 1].r || 1));
    if (advanceA) {
      out.push(a[i].id, a[i + 1].id, b[j].id);
      i++;
    } else {
      out.push(a[i].id, b[j + 1].id, b[j].id);
      j++;
    }
  }
}

/** Samples Mach number and flow angle along the plane x = xe, r in [0, re], from the triangulated net. */
export function sampleAtX(
  X: ArrayLike<number>,
  R: ArrayLike<number>,
  M: ArrayLike<number>,
  TH: ArrayLike<number>,
  tri: Uint32Array,
  xe: number,
  re: number,
  n: number,
): { r: number[]; mach: number[]; theta: number[]; pressure: number[] } {
  const cand: number[] = [];
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t];
    const b = tri[t + 1];
    const c = tri[t + 2];
    const lo = Math.min(X[a], X[b], X[c]);
    const hi = Math.max(X[a], X[b], X[c]);
    if (lo <= xe && hi >= xe) cand.push(t);
  }
  const out = { r: [] as number[], mach: [] as number[], theta: [] as number[], pressure: [] as number[] };
  for (let k = 0; k <= n; k++) {
    const rr = re * Math.min(1 - 1e-9, Math.max(1e-9, k / n));
    let found = false;
    let mVal = 0;
    let thVal = 0;
    for (const t of cand) {
      const a = tri[t];
      const b = tri[t + 1];
      const c = tri[t + 2];
      const d = (R[b] - R[c]) * (X[a] - X[c]) + (X[c] - X[b]) * (R[a] - R[c]);
      if (Math.abs(d) < 1e-300) continue;
      const l1 = ((R[b] - R[c]) * (xe - X[c]) + (X[c] - X[b]) * (rr - R[c])) / d;
      const l2 = ((R[c] - R[a]) * (xe - X[c]) + (X[a] - X[c]) * (rr - R[c])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) {
        mVal = l1 * M[a] + l2 * M[b] + l3 * M[c];
        thVal = l1 * TH[a] + l2 * TH[b] + l3 * TH[c];
        found = true;
        break;
      }
    }
    if (!found) {
      // Outside the net (slivers from merged characteristics): nearest candidate vertex.
      let best = Infinity;
      for (const t of cand) {
        for (let q = 0; q < 3; q++) {
          const v = tri[t + q];
          const d = (X[v] - xe) ** 2 + (R[v] - rr) ** 2;
          if (d < best) {
            best = d;
            mVal = M[v];
            thVal = TH[v];
          }
        }
      }
    }
    out.r.push(rr);
    out.mach.push(mVal);
    out.theta.push(thVal);
  }
  return out;
}
