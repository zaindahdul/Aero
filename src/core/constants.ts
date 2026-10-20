/** Universal gas constant, J/(mol K). Value used by NASA CEA. */
export const R_UNIVERSAL = 8.31451;
/** Standard gravity, m/s^2. */
export const G0 = 9.80665;
/** Standard-state pressure of the NASA thermodynamic data, Pa. */
export const P_STANDARD = 1e5;
/** Stefan-Boltzmann constant, W/(m^2 K^4). */
export const SIGMA_SB = 5.670374419e-8;
/** One thermochemical calorie, J. */
export const CAL = 4.184;
export const PSI = 6894.757293168;
export const ATM = 101325;

/** Atomic weights, g/mol (the set used by CEA). */
export const ATOMIC_WEIGHT: Record<string, number> = {
  H: 1.00794,
  C: 12.0107,
  N: 14.0067,
  O: 15.9994,
  AR: 39.948,
  HE: 4.002602,
};

export const deg = (rad: number) => (rad * 180) / Math.PI;
export const rad = (degrees: number) => (degrees * Math.PI) / 180;
