/**
 * Parametric thrust-chamber contour: injector face -> cylindrical chamber ->
 * blend arc -> conical convergent -> upstream throat arc -> throat ->
 * downstream throat arc -> Rao thrust-optimized parabola (or cone) -> exit.
 *
 * Coordinates: x along the axis with the throat at x = 0, r radial; metres.
 */
import { rad } from '../constants';

export interface ChamberSpec {
  /** Throat radius, m. */
  rt: number;
  /** Chamber-to-throat area ratio. */
  contractionRatio: number;
  /** Characteristic length L* = Vc / At, m. */
  lstar: number;
  /** Convergent cone half-angle, deg. */
  convergentAngle: number;
  /** Upstream throat arc radius / Rt (Rao: 1.5). */
  rcUpstream: number;
  /** Chamber-to-convergent blend radius / Rt. */
  rcChamber: number;
}

export type NozzleSpec =
  | {
      kind: 'bell';
      eps: number;
      /** Downstream throat arc radius / Rt (Rao: 0.382). */
      rcDownstream: number;
      /** Length as a fraction of the equivalent 15 deg cone. */
      lengthFraction: number;
      /** Inflection (initial parabola) angle and exit angle, deg. */
      thetaN: number;
      thetaE: number;
    }
  | {
      kind: 'cone';
      eps: number;
      rcDownstream: number;
      halfAngle: number;
    };

export interface ContourGeometry {
  chamber: ChamberSpec;
  nozzle: NozzleSpec;
  rt: number;
  rc: number;
  re: number;
  /** Axial positions of segment boundaries, m. */
  xInjector: number;
  xCylinderEnd: number;
  xConeStart: number;
  xConeEnd: number;
  xThroat: number;
  xArcEnd: number;
  xExit: number;
  cylinderLength: number;
  chamberVolume: number;
  /** Quadratic Bezier control points of the bell (N, Q, E), m. */
  bell?: { N: [number, number]; Q: [number, number]; E: [number, number] };
  warnings: string[];
}

/** Rao bell length: fraction of a 15-degree cone with the same throat arc and area ratio. */
export function bellLength(rt: number, eps: number, rcDown: number, fraction: number): number {
  const t15 = rad(15);
  return (fraction * ((Math.sqrt(eps) - 1) * rt + rcDown * rt * (1 / Math.cos(t15) - 1))) / Math.tan(t15);
}

/**
 * Initial-guess Rao angles for an 80% bell, log-interpolated from the
 * thrust-optimized parabola charts (Huzel & Huang fig. 4-16). The MoC
 * optimizer refines these.
 */
export function raoAngleGuess(eps: number): { thetaN: number; thetaE: number } {
  const E = [4, 10, 25, 50, 100];
  const TN = [21.5, 25.5, 29.5, 32.5, 35.5];
  const TE = [14.0, 11.0, 9.0, 7.5, 6.5];
  const le = Math.log(Math.min(Math.max(eps, 4), 100));
  for (let i = 0; i < E.length - 1; i++) {
    const a = Math.log(E[i]);
    const b = Math.log(E[i + 1]);
    if (le <= b) {
      const t = (le - a) / (b - a);
      return { thetaN: TN[i] + t * (TN[i + 1] - TN[i]), thetaE: TE[i] + t * (TE[i + 1] - TE[i]) };
    }
  }
  return { thetaN: TN[4], thetaE: TE[4] };
}

export function buildContour(chamber: ChamberSpec, nozzle: NozzleSpec): ContourGeometry {
  const warnings: string[] = [];
  const rt = chamber.rt;
  const rc = rt * Math.sqrt(chamber.contractionRatio);
  const re = rt * Math.sqrt(nozzle.eps);
  const beta = rad(chamber.convergentAngle);
  const Ru = chamber.rcUpstream * rt;
  const R1 = chamber.rcChamber * rt;
  const Rd = nozzle.rcDownstream * rt;

  // Upstream throat arc: center (0, rt + Ru), from angle -beta to 0.
  const xConeEnd = -Ru * Math.sin(beta);
  const rConeEnd = rt + Ru * (1 - Math.cos(beta));
  // Chamber blend arc: center (xCylinderEnd, rc - R1), sweeping from 0 to -beta.
  const rConeStart = rc - R1 * (1 - Math.cos(beta));
  if (rConeStart < rConeEnd) warnings.push('Convergent arcs overlap: reduce blend radii or increase contraction ratio.');
  const coneLen = Math.max(0, rConeStart - rConeEnd) / Math.tan(beta);
  const xConeStart = xConeEnd - coneLen;
  const xCylinderEnd = xConeStart - R1 * Math.sin(beta);

  // Divergent section.
  let xArcEnd: number;
  let xExit: number;
  let bell: ContourGeometry['bell'];
  if (nozzle.kind === 'bell') {
    const tn = rad(nozzle.thetaN);
    const te = rad(nozzle.thetaE);
    xArcEnd = Rd * Math.sin(tn);
    const rN = rt + Rd * (1 - Math.cos(tn));
    xExit = bellLength(rt, nozzle.eps, nozzle.rcDownstream, nozzle.lengthFraction);
    const m1 = Math.tan(tn);
    const m2 = Math.tan(te);
    const qx = (re - rN + m1 * xArcEnd - m2 * xExit) / (m1 - m2);
    const qr = rN + m1 * (qx - xArcEnd);
    if (!(qx > xArcEnd && qx < xExit) || nozzle.thetaE >= nozzle.thetaN) {
      warnings.push('Bell parabola is not realizable for these angles (control point outside the nozzle).');
    }
    bell = { N: [xArcEnd, rN], Q: [qx, qr], E: [xExit, re] };
  } else {
    const a = rad(nozzle.halfAngle);
    xArcEnd = Rd * Math.sin(a);
    const rA = rt + Rd * (1 - Math.cos(a));
    xExit = xArcEnd + (re - rA) / Math.tan(a);
  }

  const partial: ContourGeometry = {
    chamber,
    nozzle,
    rt,
    rc,
    re,
    xInjector: xCylinderEnd,
    xCylinderEnd,
    xConeStart,
    xConeEnd,
    xThroat: 0,
    xArcEnd,
    xExit,
    cylinderLength: 0,
    chamberVolume: 0,
    bell,
    warnings,
  };

  // Size the cylinder from L*: Vc = L* At = V(cylinder) + V(convergent).
  const vConv = integrateVolume(partial, xCylinderEnd, 0);
  const vTarget = chamber.lstar * Math.PI * rt * rt;
  let lcyl = (vTarget - vConv) / (Math.PI * rc * rc);
  if (lcyl < 0) {
    warnings.push('L* is too small for this convergent section; chamber cylinder set to zero length.');
    lcyl = 0;
  }
  partial.cylinderLength = lcyl;
  partial.xInjector = xCylinderEnd - lcyl;
  partial.chamberVolume = vConv + lcyl * Math.PI * rc * rc;
  return partial;
}

function integrateVolume(g: ContourGeometry, x0: number, x1: number): number {
  const n = 400;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const xa = x0 + ((x1 - x0) * i) / n;
    const xb = x0 + ((x1 - x0) * (i + 1)) / n;
    const ra = wallRadius(g, xa);
    const rb = wallRadius(g, xb);
    v += (Math.PI * (xb - xa) * (ra * ra + ra * rb + rb * rb)) / 3;
  }
  return v;
}

/** Parameter t of the quadratic Bezier with x(t) = x. */
function bezierT(x: number, x0: number, x1: number, x2: number): number {
  const a = x0 - 2 * x1 + x2;
  const b = 2 * (x1 - x0);
  const c = x0 - x;
  if (Math.abs(a) < 1e-14) return -c / b;
  const disc = Math.max(0, b * b - 4 * a * c);
  const s = Math.sqrt(disc);
  const t1 = (-b + s) / (2 * a);
  const t2 = (-b - s) / (2 * a);
  return t1 >= -1e-9 && t1 <= 1 + 1e-9 ? t1 : t2;
}

/** Wall radius at axial position x (any segment). */
export function wallRadius(g: ContourGeometry, x: number): number {
  return wallPoint(g, x).r;
}

/** Wall radius and slope angle (rad) at axial position x. */
export function wallPoint(g: ContourGeometry, x: number): { r: number; angle: number; segment: Segment } {
  const { rt, rc, chamber, nozzle } = g;
  const beta = rad(chamber.convergentAngle);
  const Ru = chamber.rcUpstream * rt;
  const R1 = chamber.rcChamber * rt;
  const Rd = nozzle.rcDownstream * rt;
  if (x <= g.xCylinderEnd) return { r: rc, angle: 0, segment: 'cylinder' };
  if (x <= g.xConeStart) {
    const dx = x - g.xCylinderEnd;
    const r = rc - R1 + Math.sqrt(Math.max(0, R1 * R1 - dx * dx));
    return { r, angle: -Math.asin(Math.min(1, dx / R1)), segment: 'blend' };
  }
  if (x <= g.xConeEnd) {
    const rConeEnd = rt + Ru * (1 - Math.cos(beta));
    return { r: rConeEnd + (g.xConeEnd - x) * Math.tan(beta), angle: -beta, segment: 'convergent' };
  }
  if (x <= 0) {
    return { r: rt + Ru - Math.sqrt(Math.max(0, Ru * Ru - x * x)), angle: Math.asin(x / Ru), segment: 'throat-upstream' };
  }
  if (x <= g.xArcEnd) {
    return { r: rt + Rd - Math.sqrt(Math.max(0, Rd * Rd - x * x)), angle: Math.asin(x / Rd), segment: 'throat-downstream' };
  }
  if (nozzle.kind === 'bell' && g.bell) {
    const { N, Q, E } = g.bell;
    if (x >= E[0]) {
      return { r: E[1] + (x - E[0]) * Math.tan(rad(nozzle.thetaE)), angle: rad(nozzle.thetaE), segment: 'extension' };
    }
    const t = bezierT(x, N[0], Q[0], E[0]);
    const r = (1 - t) * (1 - t) * N[1] + 2 * t * (1 - t) * Q[1] + t * t * E[1];
    const dxdt = 2 * (1 - t) * (Q[0] - N[0]) + 2 * t * (E[0] - Q[0]);
    const drdt = 2 * (1 - t) * (Q[1] - N[1]) + 2 * t * (E[1] - Q[1]);
    return { r, angle: Math.atan2(drdt, dxdt), segment: 'bell' };
  }
  const a = rad((nozzle as { halfAngle: number }).halfAngle);
  const rA = rt + Rd * (1 - Math.cos(a));
  const seg: Segment = x > g.xExit ? 'extension' : 'cone';
  return { r: rA + (x - g.xArcEnd) * Math.tan(a), angle: a, segment: seg };
}

export type Segment =
  | 'cylinder'
  | 'blend'
  | 'convergent'
  | 'throat-upstream'
  | 'throat-downstream'
  | 'bell'
  | 'cone'
  | 'extension';

export interface ContourStation {
  x: number;
  r: number;
  /** Wall slope angle, rad. */
  angle: number;
  /** Arc length from the injector face, m. */
  s: number;
  /** Local area ratio A/At. */
  areaRatio: number;
  supersonic: boolean;
  segment: Segment;
}

/**
 * Samples the wall from injector face to exit with spacing refined toward the
 * throat, where heat flux and contour curvature peak.
 */
export function sampleContour(g: ContourGeometry, count = 240): ContourStation[] {
  // Map a uniform parameter u to x with clustering around the throat.
  const L1 = -g.xInjector;
  const L2 = g.xExit;
  const nUp = Math.max(8, Math.round((count * Math.sqrt(L1)) / (Math.sqrt(L1) + Math.sqrt(L2))));
  const nDown = Math.max(8, count - nUp);
  const xs: number[] = [];
  for (let i = 0; i <= nUp; i++) {
    const u = i / nUp; // 0 at injector, 1 at throat
    xs.push(g.xInjector + L1 * (1 - Math.pow(1 - u, 1.6)));
  }
  for (let i = 1; i <= nDown; i++) {
    const u = i / nDown;
    xs.push(L2 * Math.pow(u, 1.6));
  }
  const out: ContourStation[] = [];
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    const p = wallPoint(g, xs[i]);
    if (i > 0) s += Math.hypot(xs[i] - xs[i - 1], p.r - out[i - 1].r);
    out.push({
      x: xs[i],
      r: p.r,
      angle: p.angle,
      s,
      areaRatio: (p.r / g.rt) ** 2,
      supersonic: xs[i] > 0,
      segment: p.segment,
    });
  }
  return out;
}
