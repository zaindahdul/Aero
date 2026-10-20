/**
 * Ideal rocket performance: infinite-area combustor, isentropic expansion with
 * shifting equilibrium or frozen composition (the classical CEA "rocket" problem).
 */
import { G0 } from '../constants';
import {
  buildSystem,
  type ChemSystem,
  type EqProperties,
  type EqState,
  equilibrate,
  frozenAtPressure,
  properties,
} from './equilibrium';
import { type Propellant, reactantMixture } from './propellants';

export interface Mixture {
  sys: ChemSystem;
  b0: Float64Array;
  /** Reactant enthalpy, J/kg. */
  h0: number;
}

const systemCache = new Map<string, ChemSystem>();

export function makeMixture(ox: Propellant, fuel: Propellant, of: number): Mixture {
  const { elements, enthalpy } = reactantMixture(ox, fuel, of);
  const els = Object.keys(elements)
    .filter((e) => elements[e] > 0)
    .sort();
  const key = els.join(',');
  let sys = systemCache.get(key);
  if (!sys) {
    sys = buildSystem(els);
    systemCache.set(key, sys);
  }
  return { sys, b0: Float64Array.from(sys.elements.map((e) => elements[e])), h0: enthalpy };
}

export interface Station extends EqProperties {
  /** Gas velocity, m/s. */
  u: number;
  /** Mach number based on the sound speed consistent with the flow model. */
  mach: number;
  /** Sound speed consistent with the flow model (equilibrium or frozen), m/s. */
  a: number;
  /** Isentropic exponent consistent with the flow model. */
  gamma: number;
  /** Mass flux rho*u, kg/(m^2 s). */
  massFlux: number;
  state: EqState;
}

export interface RocketSolution {
  ox: string;
  fuel: string;
  of: number;
  pc: number;
  frozen: boolean;
  chamber: Station;
  throat: Station;
  exit: Station;
  eps: number;
  cstar: number;
  ispVac: number;
  cfVac: number;
  pcOverPe: number;
  pcOverPt: number;
}

/** Shared state for a chamber condition: the mixture and its equilibrium chamber state. */
export class RocketExpansion {
  readonly mix: Mixture;
  readonly chamberState: EqState;
  readonly chamber: Station;
  readonly frozen: boolean;
  private lastGuess: EqState;
  private throatCache?: Station;

  constructor(
    readonly ox: Propellant,
    readonly fuel: Propellant,
    readonly of: number,
    readonly pc: number,
    frozen = false,
  ) {
    this.frozen = frozen;
    this.mix = makeMixture(ox, fuel, of);
    this.chamberState = equilibrate(this.mix.sys, this.mix.b0, { kind: 'HP', h: this.mix.h0, P: pc });
    this.lastGuess = this.chamberState;
    this.chamber = this.toStation(this.chamberState, 0);
  }

  private toStation(st: EqState, u: number): Station {
    const p = properties(this.mix.sys, st);
    const a = this.frozen ? p.aFr : p.aEq;
    return {
      ...p,
      u,
      a,
      mach: u / a,
      gamma: this.frozen ? p.gammaFr : p.gammaEq,
      massFlux: p.rho * u,
      state: st,
    };
  }

  /** State after isentropic expansion from the chamber to pressure P. */
  at(P: number): Station {
    if (P >= this.pc) return this.chamber;
    const s = this.chamber.s;
    let st: EqState;
    if (this.frozen) {
      st = frozenAtPressure(this.mix.sys, this.chamberState, s, P, this.lastGuess.T);
    } else {
      st = equilibrate(this.mix.sys, this.mix.b0, { kind: 'SP', s, P }, this.lastGuess);
    }
    this.lastGuess = st;
    const props = properties(this.mix.sys, st);
    const u = Math.sqrt(Math.max(0, 2 * (this.chamber.h - props.h)));
    const a = this.frozen ? props.aFr : props.aEq;
    return {
      ...props,
      u,
      a,
      mach: u / a,
      gamma: this.frozen ? props.gammaFr : props.gammaEq,
      massFlux: props.rho * u,
      state: st,
    };
  }

  /** Sonic point: the pressure where u equals the (equilibrium or frozen) sound speed. */
  throat(): Station {
    if (this.throatCache) return this.throatCache;
    const g = this.frozen ? this.chamber.gammaFr : this.chamber.gammaEq;
    let lnP = Math.log(this.pc / Math.pow((g + 1) / 2, g / (g - 1)));
    let st = this.at(Math.exp(lnP));
    for (let i = 0; i < 40; i++) {
      const f = st.u * st.u - st.a * st.a;
      if (Math.abs(f) / (st.a * st.a) < 1e-10) break;
      // d(u^2)/dlnP = -2 P / rho along an isentrope; the sound-speed change is second order.
      const step = (f * st.rho) / (2 * st.P);
      lnP += Math.max(-0.3, Math.min(0.3, step));
      st = this.at(Math.exp(lnP));
    }
    this.throatCache = st;
    return st;
  }

  /** Area ratio A/At of a station. */
  areaRatio(st: Station): number {
    return this.throat().massFlux / st.massFlux;
  }

  /** Supersonic station with the given exit area ratio. */
  exitForAreaRatio(eps: number): Station {
    const t = this.throat();
    if (eps <= 1) return t;
    // Perfect-gas guess from the throat isentropic exponent.
    const g = t.gamma;
    const M = supersonicMachFromArea(eps, g);
    let lnP = Math.log(this.pc) - (g / (g - 1)) * Math.log(1 + 0.5 * (g - 1) * M * M);
    let st = this.at(Math.exp(lnP));
    for (let i = 0; i < 60; i++) {
      const lnA = Math.log(t.massFlux / st.massFlux);
      const r = lnA - Math.log(eps);
      if (Math.abs(r) < 1e-10) break;
      const dlnA = (st.P / st.rho) * (1 / (st.u * st.u) - 1 / (st.a * st.a));
      const step = -r / dlnA;
      lnP += Math.max(-1, Math.min(1, step));
      st = this.at(Math.exp(lnP));
    }
    return st;
  }

  solve(eps: number): RocketSolution {
    const throat = this.throat();
    const exit = this.exitForAreaRatio(eps);
    const cstar = this.pc / throat.massFlux;
    const ispVac = (exit.u + exit.P / exit.massFlux) / G0;
    return {
      ox: this.ox.id,
      fuel: this.fuel.id,
      of: this.of,
      pc: this.pc,
      frozen: this.frozen,
      chamber: this.chamber,
      throat,
      exit,
      eps,
      cstar,
      ispVac,
      cfVac: (ispVac * G0) / cstar,
      pcOverPe: this.pc / exit.P,
      pcOverPt: this.pc / throat.P,
    };
  }

  /** Area ratio for ideal expansion to ambient pressure pa. */
  optimumAreaRatio(pa: number): number {
    if (pa >= this.throat().P) return 1;
    return this.areaRatio(this.at(pa));
  }
}

/** Isp at ambient pressure pa from the vacuum value: Isp = Ivac - pa * eps * c* / (Pc g0). */
export function ambientIsp(sol: Pick<RocketSolution, 'ispVac' | 'eps' | 'cstar' | 'pc'>, pa: number): number {
  return sol.ispVac - (pa * sol.eps * sol.cstar) / (sol.pc * G0);
}

export function solveRocket(ox: Propellant, fuel: Propellant, of: number, pc: number, eps: number, frozen = false) {
  return new RocketExpansion(ox, fuel, of, pc, frozen).solve(eps);
}

/** Perfect-gas area-Mach relation A/A*. */
export function areaRatioFromMach(M: number, g: number): number {
  const t = (2 / (g + 1)) * (1 + 0.5 * (g - 1) * M * M);
  return Math.pow(t, (g + 1) / (2 * (g - 1))) / M;
}

export function supersonicMachFromArea(eps: number, g: number): number {
  let M = 1 + Math.sqrt(eps - 1) * 1.2 + 0.1;
  for (let i = 0; i < 100; i++) {
    const f = areaRatioFromMach(M, g) - eps;
    const h = 1e-6 * M;
    const df = (areaRatioFromMach(M + h, g) - areaRatioFromMach(M - h, g)) / (2 * h);
    const dM = -f / df;
    M = Math.max(1.0000001, M + dM);
    if (Math.abs(dM) < 1e-12) break;
  }
  return M;
}

export function subsonicMachFromArea(eps: number, g: number): number {
  let M = 0.5 / eps;
  for (let i = 0; i < 100; i++) {
    const f = areaRatioFromMach(M, g) - eps;
    const h = 1e-7;
    const df = (areaRatioFromMach(M + h, g) - areaRatioFromMach(M - h, g)) / (2 * h);
    const dM = -f / df;
    M = Math.min(0.9999999, Math.max(1e-6, M + dM));
    if (Math.abs(dM) < 1e-13) break;
  }
  return M;
}
