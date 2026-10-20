/**
 * Coolant thermophysical properties, bilinearly interpolated in (T, ln P)
 * from tables generated with CoolProp (scripts/reference/build_fluid_tables.py).
 * Valid through the supercritical region, where cp and density change steeply
 * near the pseudo-critical line.
 */
import data from './data/coolprop-tables.json';

export type CoolantId = 'hydrogen' | 'methane' | 'rp1' | 'ethanol' | 'oxygen' | 'water';

export interface FluidState {
  T: number;
  P: number;
  rho: number;
  cp: number;
  mu: number;
  k: number;
  h: number;
  prandtl: number;
}

interface RawFluid {
  label: string;
  T: number[];
  P: number[];
  Tcrit: number;
  Pcrit: number;
  molarMass: number;
  Tsat: (number | null)[];
  rho: string;
  cp: string;
  mu: string;
  k: string;
  h: string;
}

function decodeFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export class Fluid {
  readonly label: string;
  readonly Tcrit: number;
  readonly Pcrit: number;
  readonly tmin: number;
  readonly tmax: number;
  /** Molar mass, kg/mol. */
  readonly molarMass: number;
  private readonly T: number[];
  private readonly lnP0: number;
  private readonly dlnP: number;
  private readonly nT: number;
  private readonly nP: number;
  private readonly Tsat: (number | null)[];
  private readonly grid: Record<'rho' | 'cp' | 'mu' | 'k' | 'h', Float32Array>;

  constructor(readonly id: CoolantId, raw: RawFluid) {
    this.label = raw.label;
    this.Tcrit = raw.Tcrit;
    this.Pcrit = raw.Pcrit;
    this.T = raw.T;
    this.Tsat = raw.Tsat;
    this.nT = raw.T.length;
    this.nP = raw.P.length;
    this.tmin = raw.T[0];
    this.tmax = raw.T[this.nT - 1];
    this.molarMass = raw.molarMass;
    this.lnP0 = Math.log(raw.P[0]);
    this.dlnP = (Math.log(raw.P[this.nP - 1]) - this.lnP0) / (this.nP - 1);
    this.grid = {
      rho: decodeFloat32(raw.rho),
      cp: decodeFloat32(raw.cp),
      mu: decodeFloat32(raw.mu),
      k: decodeFloat32(raw.k),
      h: decodeFloat32(raw.h),
    };
  }

  private pIndex(P: number): [number, number] {
    const f = (Math.log(Math.max(P, 1)) - this.lnP0) / this.dlnP;
    const j = Math.min(this.nP - 2, Math.max(0, Math.floor(f)));
    return [j, Math.min(1, Math.max(0, f - j))];
  }

  private tIndex(T: number): [number, number] {
    const ts = this.T;
    if (T <= ts[0]) return [0, 0];
    if (T >= ts[this.nT - 1]) return [this.nT - 2, 1];
    let lo = 0;
    let hi = this.nT - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= T) lo = mid;
      else hi = mid;
    }
    return [lo, (T - ts[lo]) / (ts[lo + 1] - ts[lo])];
  }

  private lookup(g: Float32Array, i: number, ti: number, j: number, pj: number): number {
    const n = this.nT;
    const a = g[j * n + i] * (1 - ti) + g[j * n + i + 1] * ti;
    const b = g[(j + 1) * n + i] * (1 - ti) + g[(j + 1) * n + i + 1] * ti;
    return a * (1 - pj) + b * pj;
  }

  /** Properties at temperature T [K] and pressure P [Pa] (clamped to the table). */
  state(T: number, P: number): FluidState {
    const [i, ti] = this.tIndex(T);
    const [j, pj] = this.pIndex(P);
    const g = this.grid;
    const cp = this.lookup(g.cp, i, ti, j, pj);
    const mu = this.lookup(g.mu, i, ti, j, pj);
    const k = this.lookup(g.k, i, ti, j, pj);
    return {
      T,
      P,
      rho: this.lookup(g.rho, i, ti, j, pj),
      cp,
      mu,
      k,
      h: this.lookup(g.h, i, ti, j, pj),
      prandtl: (mu * cp) / k,
    };
  }

  /** Temperature with specific enthalpy h [J/kg] at pressure P. */
  temperatureFromEnthalpy(h: number, P: number): number {
    const [j, pj] = this.pIndex(P);
    const g = this.grid.h;
    const n = this.nT;
    const hAt = (i: number) => g[j * n + i] * (1 - pj) + g[(j + 1) * n + i] * pj;
    if (h <= hAt(0)) return this.T[0];
    if (h >= hAt(n - 1)) return this.T[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (hAt(mid) <= h) lo = mid;
      else hi = mid;
    }
    const h0 = hAt(lo);
    const h1 = hAt(hi);
    return this.T[lo] + ((h - h0) / (h1 - h0)) * (this.T[hi] - this.T[lo]);
  }

  /** Saturation temperature at P, or null above the critical pressure. */
  saturationTemperature(P: number): number | null {
    if (P >= this.Pcrit) return null;
    const [j, pj] = this.pIndex(P);
    const a = this.Tsat[j];
    const b = this.Tsat[j + 1];
    if (a == null) return null;
    if (b == null) return a;
    return a * (1 - pj) + b * pj;
  }
}

const raw = (data as unknown as { fluids: Record<CoolantId, RawFluid> }).fluids;
const cache = new Map<CoolantId, Fluid>();

export function getFluid(id: CoolantId): Fluid {
  let f = cache.get(id);
  if (!f) {
    f = new Fluid(id, raw[id]);
    cache.set(id, f);
  }
  return f;
}

export const COOLANTS: { id: CoolantId; label: string }[] = (Object.keys(raw) as CoolantId[]).map((id) => ({
  id,
  label: raw[id].label,
}));
