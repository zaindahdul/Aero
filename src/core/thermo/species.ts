import data from './data/nasa9-gas.json';

/** One temperature interval of a NASA-9 polynomial fit. */
export interface Nasa9Range {
  tmin: number;
  tmax: number;
  /** a1..a7 of Cp/R = a1 T^-2 + a2 T^-1 + a3 + a4 T + a5 T^2 + a6 T^3 + a7 T^4 */
  a: number[];
  /** Integration constants b1 (enthalpy) and b2 (entropy). */
  b: number[];
}

export interface Species {
  name: string;
  elements: Record<string, number>;
  /** Molecular weight, g/mol. */
  mw: number;
  /** Heat of formation at 298.15 K, J/mol. */
  hf: number;
  ranges: Nasa9Range[];
}

export const GAS_SPECIES: readonly Species[] = (data as { species: Species[] }).species;

const byName = new Map(GAS_SPECIES.map((s) => [s.name, s]));
export function getSpecies(name: string): Species {
  const s = byName.get(name);
  if (!s) throw new Error(`unknown species ${name}`);
  return s;
}

/** Selects the polynomial interval for T, clamping to the end intervals outside the fit range. */
export function rangeFor(sp: Species, T: number): Nasa9Range {
  const r = sp.ranges;
  if (T <= r[0].tmax) return r[0];
  for (let i = 1; i < r.length; i++) if (T <= r[i].tmax) return r[i];
  return r[r.length - 1];
}

/**
 * Dimensionless standard-state properties at temperature T:
 * Cp/R, H/(RT) and S/R (S at the 1 bar standard state).
 */
export function cpR(sp: Species, T: number): number {
  const { a } = rangeFor(sp, T);
  return a[0] / (T * T) + a[1] / T + a[2] + T * (a[3] + T * (a[4] + T * (a[5] + T * a[6])));
}

export function hRT(sp: Species, T: number): number {
  const { a, b } = rangeFor(sp, T);
  return (
    -a[0] / (T * T) +
    (a[1] * Math.log(T)) / T +
    a[2] +
    T * (a[3] / 2 + T * (a[4] / 3 + T * (a[5] / 4 + (T * a[6]) / 5))) +
    b[0] / T
  );
}

export function sR(sp: Species, T: number): number {
  const { a, b } = rangeFor(sp, T);
  return (
    -a[0] / (2 * T * T) -
    a[1] / T +
    a[2] * Math.log(T) +
    T * (a[3] + T * (a[4] / 2 + T * (a[5] / 3 + (T * a[6]) / 4))) +
    b[1]
  );
}
