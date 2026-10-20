/**
 * Space-marching solver for the steady axisymmetric Euler equations in the
 * supersonic part of a nozzle (shock-capturing, conservative).
 *
 * With x as the marching (time-like) direction, valid while the axial Mach
 * number exceeds one, the equations in the wall-fitted coordinate
 * eta = r / r_w(x) read
 *
 *   d(eta r_w^2 F)/dx + d(eta r_w (G - eta r_w' F))/d eta = r_w [0, 0, p, 0]
 *
 * with F = [rho u, rho u^2 + p, rho u v, rho u H], G = [rho v, rho u v, rho v^2 + p, rho v H].
 * Finite volumes in eta, MUSCL (minmod) reconstruction, Rusanov fluxes with
 * the characteristic slopes as wave speeds, and Heun (RK2) marching. The wall
 * flux is the pressure flux of a slip wall, with the wall pressure from the
 * linearized characteristic (Prandtl-Meyer) turning relation. Mass is
 * conserved to round-off; weak shocks satisfy the Rankine-Hugoniot conditions.
 *
 * Lengths normalized by the throat radius; stagnation p0 = rho0 = 1.
 */
import type { MocWall } from './moc';

export interface EulerInput {
  gamma: number;
  wall: MocWall;
  xStart: number;
  xExit: number;
  /** Start-plane state at normalized radius eta in (0, 1). */
  start: (eta: number) => { M: number; theta: number };
  cells?: number;
  cfl?: number;
}

export interface EulerResult {
  /** Vacuum thrust integrated over the exit plane, normalized by p0 rt^2. */
  thrust: number;
  massFlow: number;
  /** Mass-flow drift start -> exit (should be round-off). */
  massDrift: number;
  steps: number;
  /** Sampled field for visualization: rows of cell-centre values every few steps. */
  field: { x: number[]; rw: number[]; mach: Float32Array[]; pressure: Float32Array[] };
  wall: { x: number[]; r: number[]; pressure: number[] };
  exit: { r: number[]; mach: number[]; theta: number[]; pressure: number[] };
  /** Peak pressure-gradient indicator (weak-shock detector) along the wall. */
  maxEntropyRise: number;
}

interface Prim {
  rho: number;
  u: number;
  v: number;
  p: number;
}

export function marchEuler(input: EulerInput): EulerResult {
  const g = input.gamma;
  const n = input.cells ?? 80;
  const cfl = input.cfl ?? 0.45;
  const { wall, xExit } = input;
  const deta = 1 / n;
  const etaC = Float64Array.from({ length: n }, (_, j) => (j + 0.5) * deta);
  const gm1 = g - 1;

  const fluxF = (q: Prim, out: number[]) => {
    const H = (g / gm1) * (q.p / q.rho) + 0.5 * (q.u * q.u + q.v * q.v);
    out[0] = q.rho * q.u;
    out[1] = q.rho * q.u * q.u + q.p;
    out[2] = q.rho * q.u * q.v;
    out[3] = q.rho * q.u * H;
  };
  const fluxG = (q: Prim, out: number[]) => {
    const H = (g / gm1) * (q.p / q.rho) + 0.5 * (q.u * q.u + q.v * q.v);
    out[0] = q.rho * q.v;
    out[1] = q.rho * q.u * q.v;
    out[2] = q.rho * q.v * q.v + q.p;
    out[3] = q.rho * q.v * H;
  };

  /** Recovers primitives from F (supersonic root of the energy quadratic). */
  const decode = (f: ArrayLike<number>): Prim => {
    const v = f[2] / f[0];
    const H = f[3] / f[0];
    const a = -(g + 1) / (2 * gm1);
    const b = (g * f[1]) / (gm1 * f[0]);
    const c = 0.5 * v * v - H;
    const disc = Math.max(0, b * b - 4 * a * c);
    const u = (-b - Math.sqrt(disc)) / (2 * a);
    const p = f[1] - f[0] * u;
    return { rho: f[0] / u, u, v, p };
  };

  const slopes = (q: Prim) => {
    const a2 = (g * q.p) / q.rho;
    const den = q.u * q.u - a2;
    const root = Math.sqrt(Math.max(0, a2 * (q.u * q.u + q.v * q.v - a2)));
    return [(q.u * q.v + root) / den, (q.u * q.v - root) / den];
  };

  // ---- initial state ----
  let x = input.xStart;
  const E = new Float64Array(n * 4);
  const tmp = [0, 0, 0, 0];
  {
    const w = wall(x);
    for (let j = 0; j < n; j++) {
      const s = input.start(etaC[j]);
      const T = 1 / (1 + 0.5 * gm1 * s.M * s.M);
      const p = Math.pow(T, g / gm1);
      const rho = Math.pow(T, 1 / gm1);
      const V = s.M * Math.sqrt((g * p) / rho);
      fluxF({ rho, u: V * Math.cos(s.theta), v: V * Math.sin(s.theta), p }, tmp);
      for (let k = 0; k < 4; k++) E[j * 4 + k] = etaC[j] * w.r * w.r * tmp[k];
    }
  }
  const massOf = (e: Float64Array) => {
    let m = 0;
    for (let j = 0; j < n; j++) m += e[j * 4] * deta;
    return 2 * Math.PI * m;
  };
  const m0 = massOf(E);

  const prims: Prim[] = new Array(n);
  const decodeAll = (e: Float64Array, rw: number) => {
    for (let j = 0; j < n; j++) {
      const s = etaC[j] * rw * rw;
      prims[j] = decode([e[j * 4] / s, e[j * 4 + 1] / s, e[j * 4 + 2] / s, e[j * 4 + 3] / s]);
    }
  };

  const minmod = (a: number, b: number) => (a * b <= 0 ? 0 : Math.abs(a) < Math.abs(b) ? a : b);
  const fL = [0, 0, 0, 0];
  const fR = [0, 0, 0, 0];
  const gL = [0, 0, 0, 0];
  const gR = [0, 0, 0, 0];
  const PHI = new Float64Array((n + 1) * 4);
  let lastWallP = 0;

  /** Residual dE/dx and the maximum wave speed. */
  const residual = (e: Float64Array, xx: number, out: Float64Array): number => {
    const w = wall(xx);
    const rw = w.r;
    const rwp = Math.tan(w.angle);
    decodeAll(e, rw);
    let amax = 1e-9;
    // Reconstructed face states (MUSCL on primitives, mirrored ghost at the axis).
    const get = (j: number): Prim => (j < 0 ? { ...prims[-j - 1], v: -prims[-j - 1].v } : prims[Math.min(j, n - 1)]);
    PHI.fill(0, 0, 4); // axis face: eta = 0
    for (let f = 1; f < n; f++) {
      const jl = f - 1;
      const jr = f;
      const recon = (j: number, sign: number): Prim => {
        const qm = get(j - 1);
        const q = get(j);
        const qp = get(j + 1);
        const s = j === n - 1 ? 0 : 0.5 * sign;
        return {
          rho: q.rho + s * minmod(q.rho - qm.rho, qp.rho - q.rho),
          u: q.u + s * minmod(q.u - qm.u, qp.u - q.u),
          v: q.v + s * minmod(q.v - qm.v, qp.v - q.v),
          p: q.p + s * minmod(q.p - qm.p, qp.p - q.p),
        };
      };
      const L = recon(jl, +1);
      const R = recon(jr, -1);
      const ef = f * deta;
      fluxF(L, fL);
      fluxF(R, fR);
      fluxG(L, gL);
      fluxG(R, gR);
      let alpha = 0;
      for (const q of [L, R]) for (const sl of slopes(q)) alpha = Math.max(alpha, Math.abs((sl - ef * rwp) / rw));
      amax = Math.max(amax, alpha);
      for (let k = 0; k < 4; k++) {
        const phiL = ef * rw * (gL[k] - ef * rwp * fL[k]);
        const phiR = ef * rw * (gR[k] - ef * rwp * fR[k]);
        PHI[f * 4 + k] = 0.5 * (phiL + phiR) - 0.5 * alpha * ef * rw * rw * (fR[k] - fL[k]);
      }
    }
    // Wall face (eta = 1): slip wall, pressure from linearized characteristic turning.
    {
      const q = prims[n - 1];
      const V = Math.hypot(q.u, q.v);
      const M = V / Math.sqrt((g * q.p) / q.rho);
      const delta = w.angle - Math.atan2(q.v, q.u);
      const pw = q.p * Math.max(0.2, 1 - ((g * M * M) / Math.sqrt(Math.max(1e-6, M * M - 1))) * delta);
      lastWallP = pw;
      PHI[n * 4 + 0] = 0;
      PHI[n * 4 + 1] = -rw * rwp * pw;
      PHI[n * 4 + 2] = rw * pw;
      PHI[n * 4 + 3] = 0;
    }
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < 4; k++) out[j * 4 + k] = -(PHI[(j + 1) * 4 + k] - PHI[j * 4 + k]) / deta;
      out[j * 4 + 2] += rw * prims[j].p;
    }
    return amax;
  };

  const R1 = new Float64Array(n * 4);
  const R2 = new Float64Array(n * 4);
  const Es = new Float64Array(n * 4);
  const field: EulerResult['field'] = { x: [], rw: [], mach: [], pressure: [] };
  const wallOut: EulerResult['wall'] = { x: [], r: [], pressure: [] };
  const record = (xx: number) => {
    const rw = wall(xx).r;
    decodeAll(E, rw);
    const mach = new Float32Array(n);
    const pres = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      const q = prims[j];
      mach[j] = Math.hypot(q.u, q.v) / Math.sqrt((g * q.p) / q.rho);
      pres[j] = q.p;
    }
    field.x.push(xx);
    field.rw.push(rw);
    field.mach.push(mach);
    field.pressure.push(pres);
  };

  let steps = 0;
  record(x);
  let maxEntropyRise = 0;
  while (x < xExit - 1e-12 && steps < 200000) {
    const amax = residual(E, x, R1);
    wallOut.x.push(x);
    wallOut.r.push(wall(x).r);
    wallOut.pressure.push(lastWallP);
    const dx = Math.min((cfl * deta) / amax, xExit - x);
    for (let i = 0; i < E.length; i++) Es[i] = E[i] + dx * R1[i];
    residual(Es, x + dx, R2);
    for (let i = 0; i < E.length; i++) E[i] = E[i] + 0.5 * dx * (R1[i] + R2[i]);
    x += dx;
    steps++;
    if (steps % 6 === 0 || x >= xExit - 1e-12) record(x);
  }

  // Exit plane.
  const rwE = wall(xExit).r;
  decodeAll(E, rwE);
  let thrust = 0;
  const exit: EulerResult['exit'] = { r: [], mach: [], theta: [], pressure: [] };
  for (let j = 0; j < n; j++) {
    thrust += E[j * 4 + 1] * deta;
    const q = prims[j];
    exit.r.push(etaC[j] * rwE);
    exit.mach.push(Math.hypot(q.u, q.v) / Math.sqrt((g * q.p) / q.rho));
    exit.theta.push(Math.atan2(q.v, q.u));
    exit.pressure.push(q.p);
    // Entropy rise s/cv = ln(p / rho^g) relative to the isentrope.
    maxEntropyRise = Math.max(maxEntropyRise, Math.log(q.p / Math.pow(q.rho, g)));
  }
  const m1 = massOf(E);
  return {
    thrust: 2 * Math.PI * thrust,
    massFlow: m1,
    massDrift: Math.abs(m1 - m0) / m0,
    steps,
    field,
    wall: wallOut,
    exit,
    maxEntropyRise,
  };
}
