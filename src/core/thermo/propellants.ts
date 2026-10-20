import { ATOMIC_WEIGHT, CAL } from '../constants';
import type { CoolantId } from '../fluids/fluids';

export interface PropellantComponent {
  /** Element counts per formula unit, e.g. { C: 1, H: 1.9423 }. */
  formula: Record<string, number>;
  /** Enthalpy at the delivery temperature, J/mol (heat of formation + sensible). */
  enthalpy: number;
  massFraction: number;
}

export interface Propellant {
  id: string;
  name: string;
  role: 'oxidizer' | 'fuel';
  components: PropellantComponent[];
  /** Delivery temperature, K. */
  temperature: number;
  /** Liquid density at delivery conditions, kg/m^3 (for injector sizing). */
  density: number;
  /** Fluid property model to use when this propellant is the regenerative coolant. */
  coolant?: CoolantId;
}

const cal = (c: number) => c * CAL;

/**
 * Reactant definitions. Enthalpies match the CEA reactant cards used by
 * RocketCEA so the fixtures in tests/fixtures are an apples-to-apples check.
 */
export const PROPELLANTS: Record<string, Propellant> = {
  LOX: {
    id: 'LOX',
    name: 'Liquid oxygen',
    role: 'oxidizer',
    components: [{ formula: { O: 2 }, enthalpy: cal(-3102), massFraction: 1 }],
    temperature: 90.18,
    density: 1141,
    coolant: 'oxygen',
  },
  N2O4: {
    id: 'N2O4',
    name: 'Nitrogen tetroxide',
    role: 'oxidizer',
    components: [{ formula: { N: 2, O: 4 }, enthalpy: cal(-4676), massFraction: 1 }],
    temperature: 298.15,
    density: 1440,
  },
  N2O: {
    id: 'N2O',
    name: 'Nitrous oxide',
    role: 'oxidizer',
    components: [{ formula: { N: 2, O: 1 }, enthalpy: cal(19467), massFraction: 1 }],
    temperature: 298.15,
    density: 745,
  },
  H2O2_90: {
    id: 'H2O2_90',
    name: 'Hydrogen peroxide (90%)',
    role: 'oxidizer',
    components: [
      { formula: { H: 2, O: 2 }, enthalpy: cal(-44880), massFraction: 0.9 },
      { formula: { H: 2, O: 1 }, enthalpy: cal(-68317), massFraction: 0.1 },
    ],
    temperature: 298.15,
    density: 1390,
  },
  LH2: {
    id: 'LH2',
    name: 'Liquid hydrogen',
    role: 'fuel',
    components: [{ formula: { H: 2 }, enthalpy: cal(-2154), massFraction: 1 }],
    temperature: 20.27,
    density: 70.85,
    coolant: 'hydrogen',
  },
  LCH4: {
    id: 'LCH4',
    name: 'Liquid methane',
    role: 'fuel',
    components: [{ formula: { C: 1, H: 4 }, enthalpy: cal(-21390), massFraction: 1 }],
    temperature: 111.66,
    density: 422.6,
    coolant: 'methane',
  },
  RP1: {
    id: 'RP1',
    name: 'RP-1 kerosene',
    role: 'fuel',
    components: [{ formula: { C: 1, H: 1.9423 }, enthalpy: cal(-5430), massFraction: 1 }],
    temperature: 298.15,
    density: 810,
    coolant: 'rp1',
  },
  ETHANOL: {
    id: 'ETHANOL',
    name: 'Ethanol',
    role: 'fuel',
    components: [{ formula: { C: 2, H: 6, O: 1 }, enthalpy: cal(-66370), massFraction: 1 }],
    temperature: 298.15,
    density: 789,
    coolant: 'ethanol',
  },
  MMH: {
    id: 'MMH',
    name: 'Monomethylhydrazine',
    role: 'fuel',
    components: [{ formula: { C: 1, H: 6, N: 2 }, enthalpy: cal(12900), massFraction: 1 }],
    temperature: 298.15,
    density: 874,
  },
};

export const OXIDIZERS = Object.values(PROPELLANTS).filter((p) => p.role === 'oxidizer');
export const FUELS = Object.values(PROPELLANTS).filter((p) => p.role === 'fuel');

export function formulaWeight(formula: Record<string, number>): number {
  let m = 0;
  for (const [el, n] of Object.entries(formula)) {
    const w = ATOMIC_WEIGHT[el.toUpperCase()];
    if (w === undefined) throw new Error(`no atomic weight for ${el}`);
    m += w * n;
  }
  return m;
}

/** Element amounts (mol/kg) and enthalpy (J/kg) of a propellant blend at oxidizer/fuel mass ratio `of`. */
export function reactantMixture(ox: Propellant, fuel: Propellant, of: number) {
  const elements: Record<string, number> = {};
  let enthalpy = 0;
  const add = (p: Propellant, massFraction: number) => {
    for (const c of p.components) {
      const molPerKg = (massFraction * c.massFraction) / (formulaWeight(c.formula) / 1000);
      enthalpy += molPerKg * c.enthalpy;
      for (const [el, n] of Object.entries(c.formula)) {
        const key = el.toUpperCase();
        elements[key] = (elements[key] ?? 0) + molPerKg * n;
      }
    }
  };
  add(ox, of / (1 + of));
  add(fuel, 1 / (1 + of));
  return { elements, enthalpy };
}

/** Stoichiometric O/F ratio (complete oxidation to CO2, H2O, N2). */
export function stoichiometricOF(ox: Propellant, fuel: Propellant): number {
  // Oxidizing valence: C +4, H +1, O -2, N 0.
  const valence = (p: Propellant) => {
    let v = 0;
    for (const c of p.components) {
      const mol = c.massFraction / (formulaWeight(c.formula) / 1000);
      v += mol * ((c.formula.C ?? 0) * 4 + (c.formula.H ?? 0) - (c.formula.O ?? 0) * 2);
    }
    return v;
  };
  return valence(fuel) / -valence(ox);
}
