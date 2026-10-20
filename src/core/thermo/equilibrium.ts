/**
 * Chemical equilibrium by Gibbs free-energy minimization.
 *
 * Implements the reduced Newton-Raphson iteration on element potentials of
 * Gordon & McBride, "Computer Program for Calculation of Complex Chemical
 * Equilibrium Compositions and Applications", NASA RP-1311 (1994), for an
 * ideal-gas mixture. Equation numbers below refer to that report.
 *
 * Units: n_j in mol per kg of mixture, T in K, P in Pa, h in J/kg, s in J/(kg K).
 */
import { P_STANDARD, R_UNIVERSAL } from '../constants';
import { GAS_SPECIES, type Species, cpR, hRT, sR } from './species';
import { solveLinear } from '../math/linalg';

export interface ChemSystem {
  elements: string[];
  species: Species[];
  /** Stoichiometric matrix, a[i * ns + j] = atoms of element i in species j. */
  a: Float64Array;
  ns: number;
  nl: number;
}

export interface EqState {
  T: number;
  P: number;
  /** ln of moles of each species per kg. */
  lnn: Float64Array;
  /** Total gas moles per kg. */
  n: number;
  iterations: number;
}

export interface EqProperties {
  T: number;
  P: number;
  /** Molecular weight, g/mol. */
  mw: number;
  rho: number;
  h: number;
  s: number;
  /** Equilibrium and frozen specific heats, J/(kg K). */
  cpEq: number;
  cpFr: number;
  /** Isentropic exponents: equilibrium (gamma_s) and frozen. */
  gammaEq: number;
  gammaFr: number;
  aEq: number;
  aFr: number;
  dlnVdlnT: number;
  dlnVdlnP: number;
  /** Mole fractions keyed by species name (species above 1e-12). */
  moleFractions: Record<string, number>;
}

const LN_TRACE = -18.420681; // ln(1e-8), RP-1311 eq. 3.1
const LN_TRACE_HALF = 9.2103404;

/** Builds a chemical system for the given elements, using every species composed only of them. */
export function buildSystem(elements: string[], pool: readonly Species[] = GAS_SPECIES): ChemSystem {
  const els = elements.map((e) => e.toUpperCase());
  const species = pool.filter((sp) => Object.keys(sp.elements).every((e) => els.includes(e)));
  const ns = species.length;
  const nl = els.length;
  const a = new Float64Array(nl * ns);
  species.forEach((sp, j) => {
    els.forEach((el, i) => {
      a[i * ns + j] = sp.elements[el] ?? 0;
    });
  });
  return { elements: els, species, a, ns, nl };
}

interface ThermoArrays {
  H: Float64Array; // H/RT
  S: Float64Array; // S°/R
  Cp: Float64Array; // Cp/R
}

function evalThermo(sys: ChemSystem, T: number, out?: ThermoArrays): ThermoArrays {
  const t = out ?? {
    H: new Float64Array(sys.ns),
    S: new Float64Array(sys.ns),
    Cp: new Float64Array(sys.ns),
  };
  for (let j = 0; j < sys.ns; j++) {
    const sp = sys.species[j];
    t.H[j] = hRT(sp, T);
    t.S[j] = sR(sp, T);
    t.Cp[j] = cpR(sp, T);
  }
  return t;
}

export type EqProblem =
  | { kind: 'TP'; T: number; P: number }
  | { kind: 'HP'; h: number; P: number }
  | { kind: 'SP'; s: number; P: number };

export class EquilibriumError extends Error {}

/**
 * Solves for the equilibrium composition. `guess` (e.g. the previous station of
 * a nozzle expansion) dramatically speeds up convergence.
 */
export function equilibrate(sys: ChemSystem, b0: Float64Array, prob: EqProblem, guess?: EqState): EqState {
  const { ns, nl, a } = sys;
  const lnn = new Float64Array(ns);
  let lnN: number;
  let lnT: number;
  if (guess) {
    lnn.set(guess.lnn);
    lnN = Math.log(guess.n);
    lnT = Math.log(prob.kind === 'TP' ? prob.T : guess.T);
  } else {
    lnN = Math.log(0.1);
    lnn.fill(Math.log(0.1 / ns));
    lnT = Math.log(prob.kind === 'TP' ? prob.T : 3800);
  }
  const solveT = prob.kind !== 'TP';
  const m = nl + (solveT ? 2 : 1);
  const G = new Float64Array(m * m);
  const rhs = new Float64Array(m);
  const nj = new Float64Array(ns);
  const mu = new Float64Array(ns);
  const Sj = new Float64Array(ns);
  const dlnnj = new Float64Array(ns);
  const bArr = new Float64Array(nl);
  let th: ThermoArrays | undefined;
  const lnP = Math.log(prob.P / P_STANDARD);
  let b0max = 0;
  for (let i = 0; i < nl; i++) b0max = Math.max(b0max, b0[i]);

  const maxIter = 300;
  for (let iter = 1; iter <= maxIter; iter++) {
    const T = Math.exp(lnT);
    th = evalThermo(sys, T, th);
    const N = Math.exp(lnN);
    let sumN = 0;
    for (let j = 0; j < ns; j++) {
      nj[j] = Math.exp(lnn[j]);
      sumN += nj[j];
      mu[j] = th.H[j] - th.S[j] + lnn[j] - lnN + lnP; // eq. 2.11, mu_j / RT
      Sj[j] = th.S[j] - (lnn[j] - lnN) - lnP;
    }

    // Assemble the reduced Newton system, eqs. 2.24, 2.26, 2.27/2.28.
    G.fill(0);
    rhs.fill(0);
    for (let k = 0; k < nl; k++) {
      let bk = 0;
      for (let j = 0; j < ns; j++) bk += a[k * ns + j] * nj[j];
      bArr[k] = bk;
    }
    for (let k = 0; k < nl; k++) {
      for (let i = k; i < nl; i++) {
        let s = 0;
        for (let j = 0; j < ns; j++) s += a[k * ns + j] * a[i * ns + j] * nj[j];
        G[k * m + i] = s;
        G[i * m + k] = s;
      }
      let amu = 0;
      let aH = 0;
      for (let j = 0; j < ns; j++) {
        const akn = a[k * ns + j] * nj[j];
        amu += akn * mu[j];
        aH += akn * th.H[j];
      }
      G[k * m + nl] = bArr[k];
      G[nl * m + k] = bArr[k];
      rhs[k] = b0[k] - bArr[k] + amu;
      if (solveT) G[k * m + nl + 1] = aH;
    }
    let nmu = 0;
    let nH = 0;
    let nCp = 0;
    let nH2 = 0;
    let nS = 0;
    let nHS = 0;
    let nSmu = 0;
    let nHmu = 0;
    for (let j = 0; j < ns; j++) {
      nmu += nj[j] * mu[j];
      nH += nj[j] * th.H[j];
      nCp += nj[j] * th.Cp[j];
      nH2 += nj[j] * th.H[j] * th.H[j];
      nS += nj[j] * Sj[j];
      nHS += nj[j] * th.H[j] * Sj[j];
      nSmu += nj[j] * Sj[j] * mu[j];
      nHmu += nj[j] * th.H[j] * mu[j];
    }
    G[nl * m + nl] = sumN - N;
    rhs[nl] = N - sumN + nmu;
    if (solveT) {
      G[nl * m + nl + 1] = nH;
      const r = nl + 1;
      if (prob.kind === 'HP') {
        for (let i = 0; i < nl; i++) {
          let s = 0;
          for (let j = 0; j < ns; j++) s += a[i * ns + j] * nj[j] * th.H[j];
          G[r * m + i] = s;
        }
        G[r * m + nl] = nH;
        G[r * m + r] = nCp + nH2;
        rhs[r] = prob.h / (R_UNIVERSAL * T) - nH + nHmu;
      } else if (prob.kind === 'SP') {
        for (let i = 0; i < nl; i++) {
          let s = 0;
          for (let j = 0; j < ns; j++) s += a[i * ns + j] * nj[j] * Sj[j];
          G[r * m + i] = s;
        }
        G[r * m + nl] = nS;
        G[r * m + r] = nCp + nHS;
        rhs[r] = prob.s / R_UNIVERSAL - nS + N - sumN + nSmu;
      }
    }

    const x = solveLinear(G, rhs, m);
    if (!x) throw new EquilibriumError('singular equilibrium matrix');
    const dlnN = x[nl];
    const dlnT = solveT ? x[nl + 1] : 0;

    // Species corrections, eq. 2.18 rearranged.
    for (let j = 0; j < ns; j++) {
      let s = 0;
      for (let i = 0; i < nl; i++) s += a[i * ns + j] * x[i];
      dlnnj[j] = -mu[j] + s + dlnN + th.H[j] * dlnT;
    }

    // Control factor lambda, eqs. 3.1-3.3.
    let big = Math.max(5 * Math.abs(dlnT), 5 * Math.abs(dlnN));
    let lambda2 = Infinity;
    for (let j = 0; j < ns; j++) {
      const lnFrac = lnn[j] - lnN;
      if (lnFrac > LN_TRACE) {
        if (dlnnj[j] > 0) big = Math.max(big, Math.abs(dlnnj[j]));
      } else if (dlnnj[j] >= 0) {
        const denom = dlnnj[j] - dlnN;
        if (denom !== 0) lambda2 = Math.min(lambda2, Math.abs((-lnFrac - LN_TRACE_HALF) / denom));
      }
    }
    const lambda1 = big > 0 ? 2 / big : Infinity;
    const lambda = Math.min(1, lambda1, lambda2);

    // Convergence tests (RP-1311 section 3.3) on the unrelaxed corrections.
    let converged = Math.abs(dlnT) <= 1e-4 && (N * Math.abs(dlnN)) / sumN <= 0.5e-5;
    if (converged) {
      for (let j = 0; j < ns; j++) {
        if ((nj[j] * Math.abs(dlnnj[j])) / sumN > 0.5e-5) {
          converged = false;
          break;
        }
      }
    }
    if (converged) {
      for (let i = 0; i < nl; i++) {
        if (Math.abs(b0[i] - bArr[i]) > b0max * 1e-6) {
          converged = false;
          break;
        }
      }
    }

    for (let j = 0; j < ns; j++) lnn[j] += lambda * dlnnj[j];
    lnN += lambda * dlnN;
    lnT += lambda * dlnT;
    // Keep vanishing species finite and temperature inside the data range.
    for (let j = 0; j < ns; j++) if (lnn[j] < lnN - 160) lnn[j] = lnN - 160;
    lnT = Math.min(Math.max(lnT, Math.log(120)), Math.log(6800));

    if (converged) {
      return { T: Math.exp(lnT), P: prob.P, lnn, n: Math.exp(lnN), iterations: iter };
    }
  }
  throw new EquilibriumError(`equilibrium did not converge (${prob.kind}, P=${prob.P.toExponential(3)} Pa)`);
}

/**
 * Mixture properties, including the equilibrium derivatives of eqs. 2.50-2.71
 * that give the equilibrium sound speed and isentropic exponent.
 */
export function properties(sys: ChemSystem, st: EqState): EqProperties {
  const { ns, nl, a } = sys;
  const { T, P } = st;
  const th = evalThermo(sys, T);
  const lnN = Math.log(st.n);
  const lnP = Math.log(P / P_STANDARD);
  const nj = new Float64Array(ns);
  let sumN = 0;
  let nH = 0;
  let nS = 0;
  let nCp = 0;
  let nH2 = 0;
  for (let j = 0; j < ns; j++) {
    nj[j] = Math.exp(st.lnn[j]);
    sumN += nj[j];
    nH += nj[j] * th.H[j];
    nCp += nj[j] * th.Cp[j];
    nH2 += nj[j] * th.H[j] * th.H[j];
    nS += nj[j] * (th.S[j] - (st.lnn[j] - lnN) - lnP);
  }
  const m = nl + 1;
  const G = new Float64Array(m * m);
  const rT = new Float64Array(m);
  const rP = new Float64Array(m);
  const aH = new Float64Array(nl);
  for (let k = 0; k < nl; k++) {
    let bk = 0;
    let akH = 0;
    for (let j = 0; j < ns; j++) {
      bk += a[k * ns + j] * nj[j];
      akH += a[k * ns + j] * nj[j] * th.H[j];
    }
    aH[k] = akH;
    for (let i = k; i < nl; i++) {
      let s = 0;
      for (let j = 0; j < ns; j++) s += a[k * ns + j] * a[i * ns + j] * nj[j];
      G[k * m + i] = s;
      G[i * m + k] = s;
    }
    G[k * m + nl] = bk;
    G[nl * m + k] = bk;
    rT[k] = -akH;
    rP[k] = bk;
  }
  G[nl * m + nl] = 0;
  rT[nl] = -nH;
  rP[nl] = sumN;
  const xT = solveLinear(new Float64Array(G), rT, m);
  const xP = solveLinear(new Float64Array(G), rP, m);
  if (!xT || !xP) throw new EquilibriumError('singular derivative matrix');

  const dlnVdlnT = 1 + xT[nl];
  const dlnVdlnP = -1 + xP[nl];
  let cpEqR = nCp + nH2;
  for (let i = 0; i < nl; i++) cpEqR += aH[i] * xT[i];
  cpEqR += nH * xT[nl];
  const cvEqR = cpEqR + (st.n * dlnVdlnT * dlnVdlnT) / dlnVdlnP;
  const gammaEq = -(cpEqR / cvEqR) / dlnVdlnP;
  const gammaFr = nCp / (nCp - st.n);
  const Rmix = st.n * R_UNIVERSAL; // J/(kg K)

  const moleFractions: Record<string, number> = {};
  for (let j = 0; j < ns; j++) {
    const x = nj[j] / sumN;
    if (x > 1e-12) moleFractions[sys.species[j].name] = x;
  }
  return {
    T,
    P,
    mw: 1000 / st.n,
    rho: P / (Rmix * T),
    h: R_UNIVERSAL * T * nH,
    s: R_UNIVERSAL * nS,
    cpEq: cpEqR * R_UNIVERSAL,
    cpFr: nCp * R_UNIVERSAL,
    gammaEq,
    gammaFr,
    aEq: Math.sqrt(gammaEq * Rmix * T),
    aFr: Math.sqrt(gammaFr * Rmix * T),
    dlnVdlnT,
    dlnVdlnP,
    moleFractions,
  };
}

/**
 * Isentropic change of state at frozen composition: finds T at pressure P with
 * entropy s, holding the moles of every species fixed.
 */
export function frozenAtPressure(sys: ChemSystem, frozen: EqState, s: number, P: number, Tguess = frozen.T): EqState {
  const { ns } = sys;
  const lnN = Math.log(frozen.n);
  const lnP = Math.log(P / P_STANDARD);
  let T = Tguess;
  for (let iter = 0; iter < 60; iter++) {
    let sR_ = 0;
    let cp = 0;
    for (let j = 0; j < ns; j++) {
      const n = Math.exp(frozen.lnn[j]);
      const sp = sys.species[j];
      sR_ += n * (sR(sp, T) - (frozen.lnn[j] - lnN) - lnP);
      cp += n * cpR(sp, T);
    }
    const dlnT = (s / R_UNIVERSAL - sR_) / cp;
    T *= Math.exp(Math.max(-0.5, Math.min(0.5, dlnT)));
    if (Math.abs(dlnT) < 1e-10) break;
  }
  return { T, P, lnn: frozen.lnn, n: frozen.n, iterations: 0 };
}
