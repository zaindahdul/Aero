/**
 * Dilute-gas transport properties of combustion products (frozen, i.e. without
 * the chemical-reaction contribution to conductivity, which is the convention
 * for the Bartz heat-transfer correlation).
 *
 * Species viscosities and conductivities use the NASA CEA transport fits
 * (Svehla, NASA TM-4647) where available; other species fall back to
 * Chapman-Enskog theory with Lennard-Jones potentials (Neufeld collision
 * integral, Brokaw polar correction) and the Eucken conductivity relation.
 * Mixing follows NASA RP-1311 section 5 (Wilke-type rules with binary
 * interaction viscosities where they exist).
 */
import { R_UNIVERSAL } from '../constants';
import data from './data/nasa-transport.json';
import { cpR, getSpecies } from './species';

interface Fit {
  tmin: number;
  tmax: number;
  c: number[];
}
interface SpeciesFits {
  V: Fit[];
  C: Fit[];
}
const NASA = data as { species: Record<string, SpeciesFits>; binary: Record<string, Fit[]> };

function evalFit(fits: Fit[], T: number): number {
  let f = fits[0];
  for (const g of fits) {
    f = g;
    if (T <= g.tmax) break;
  }
  const [A, B, C, D] = f.c;
  return Math.exp(A * Math.log(T) + B / T + C / (T * T) + D);
}

interface LJ {
  /** Well depth / Boltzmann constant, K. */
  eps: number;
  /** Collision diameter, Angstrom. */
  sigma: number;
  /** Dipole moment, Debye. */
  dipole?: number;
}

/** Lennard-Jones parameters (GRI-Mech 3.0 transport database) for the fallback model. */
const LJ_PARAMS: Record<string, LJ> = {
  H2: { eps: 38.0, sigma: 2.92 },
  H: { eps: 145.0, sigma: 2.05 },
  O: { eps: 80.0, sigma: 2.75 },
  O2: { eps: 107.4, sigma: 3.458 },
  OH: { eps: 80.0, sigma: 2.75 },
  H2O: { eps: 572.4, sigma: 2.605, dipole: 1.844 },
  HO2: { eps: 107.4, sigma: 3.458 },
  H2O2: { eps: 107.4, sigma: 3.458 },
  CO: { eps: 98.1, sigma: 3.65 },
  CO2: { eps: 244.0, sigma: 3.763 },
  CH4: { eps: 141.4, sigma: 3.746 },
  CH3: { eps: 144.0, sigma: 3.8 },
  HCO: { eps: 498.0, sigma: 3.59 },
  'HCHO,formaldehy': { eps: 498.0, sigma: 3.59 },
  C: { eps: 71.4, sigma: 3.298 },
  N2: { eps: 97.53, sigma: 3.621 },
  N: { eps: 71.4, sigma: 3.298 },
  NO: { eps: 97.53, sigma: 3.621 },
  NO2: { eps: 200.0, sigma: 3.5 },
  N2O: { eps: 232.4, sigma: 3.828 },
  NH: { eps: 80.0, sigma: 2.65 },
  NH2: { eps: 80.0, sigma: 2.65 },
  NH3: { eps: 481.0, sigma: 2.92, dipole: 1.47 },
  HCN: { eps: 569.0, sigma: 3.63 },
  HNO: { eps: 116.7, sigma: 3.492 },
  NCO: { eps: 232.4, sigma: 3.828 },
  'C2H2,acetylene': { eps: 209.0, sigma: 4.1 },
  C2H4: { eps: 280.8, sigma: 3.971 },
  Ar: { eps: 136.5, sigma: 3.33 },
  He: { eps: 10.2, sigma: 2.576 },
};

const KB_CGS = 1.380649e-16; // erg/K

/** Reduced collision integral Omega(2,2)* (Neufeld, Janzen & Aziz 1972). */
function omega22(Tstar: number): number {
  return 1.16145 * Math.pow(Tstar, -0.14874) + 0.52487 * Math.exp(-0.7732 * Tstar) + 2.16178 * Math.exp(-2.43787 * Tstar);
}

function ljViscosity(name: string, T: number): number | undefined {
  const lj = LJ_PARAMS[name];
  if (!lj) return undefined;
  const Tstar = T / lj.eps;
  let omega = omega22(Tstar);
  if (lj.dipole) {
    // Brokaw: Omega_v = Omega_LJ + 0.2 delta^2 / T*, delta = mu^2 / (2 eps sigma^3)
    const mu = lj.dipole * 1e-18;
    const delta = (mu * mu) / (2 * lj.eps * KB_CGS * Math.pow(lj.sigma * 1e-8, 3));
    omega += (0.2 * delta * delta) / Tstar;
  }
  return (2.6693e-6 * Math.sqrt(getSpecies(name).mw * T)) / (lj.sigma * lj.sigma * omega);
}

/** Pure-species dilute-gas viscosity, Pa s. */
export function speciesViscosity(name: string, T: number): number | undefined {
  const fits = NASA.species[name];
  if (fits?.V.length) return evalFit(fits.V, T) * 1e-7;
  return ljViscosity(name, T);
}

/** Pure-species thermal conductivity (translational + internal), W/(m K). */
export function speciesConductivity(name: string, T: number, viscosity: number): number {
  const fits = NASA.species[name];
  if (fits?.C.length) return evalFit(fits.C, T) * 1e-4;
  const sp = getSpecies(name);
  // Eucken: k = mu (cp + 5/4 R/M), mass-specific cp.
  return (viscosity * ((cpR(sp, T) + 1.25) * R_UNIVERSAL)) / (sp.mw / 1000);
}

function interactionViscosity(a: string, b: string, T: number): number | undefined {
  const fits = NASA.binary[`${a}|${b}`] ?? NASA.binary[`${b}|${a}`];
  return fits ? evalFit(fits, T) * 1e-7 : undefined;
}

export interface GasTransport {
  viscosity: number;
  conductivity: number;
  cp: number;
  prandtl: number;
}

/**
 * Frozen transport properties of a gas mixture from mole fractions. Species
 * with no data (all are trace in rocket exhaust) are dropped and the remainder
 * renormalized.
 */
export function mixtureTransport(moleFractions: Record<string, number>, T: number): GasTransport {
  const names: string[] = [];
  const x: number[] = [];
  const mu: number[] = [];
  const k: number[] = [];
  const M: number[] = [];
  const cpMolar: number[] = [];
  let xs = 0;
  for (const [name, xi] of Object.entries(moleFractions)) {
    if (xi < 1e-7) continue;
    const m = speciesViscosity(name, T);
    if (m === undefined) continue;
    const sp = getSpecies(name);
    names.push(name);
    x.push(xi);
    mu.push(m);
    k.push(speciesConductivity(name, T, m));
    M.push(sp.mw);
    cpMolar.push(cpR(sp, T) * R_UNIVERSAL);
    xs += xi;
  }
  const n = names.length;
  for (let i = 0; i < n; i++) x[i] /= xs;
  let muMix = 0;
  let kMix = 0;
  for (let i = 0; i < n; i++) {
    let dMu = x[i];
    let dK = x[i];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const etaIJ = interactionViscosity(names[i], names[j], T);
      // RP-1311 eqs. 5.2-5.3 (viscosity) and 5.7 (conductivity).
      const phi =
        etaIJ !== undefined
          ? (mu[i] / etaIJ) * ((2 * M[j]) / (M[i] + M[j]))
          : 0.25 * Math.pow(1 + Math.sqrt(mu[i] / mu[j]) * Math.pow(M[j] / M[i], 0.25), 2) * Math.sqrt((2 * M[j]) / (M[i] + M[j]));
      const psi = phi * (1 + (2.41 * (M[i] - M[j]) * (M[i] - 0.142 * M[j])) / Math.pow(M[i] + M[j], 2));
      dMu += x[j] * phi;
      dK += x[j] * psi;
    }
    muMix += (x[i] * mu[i]) / dMu;
    kMix += (x[i] * k[i]) / dK;
  }
  let cpm = 0;
  let mw = 0;
  for (let i = 0; i < n; i++) {
    cpm += x[i] * cpMolar[i];
    mw += x[i] * M[i];
  }
  const cp = cpm / (mw / 1000);
  return { viscosity: muMix, conductivity: kMix, cp, prandtl: (muMix * cp) / kMix };
}
