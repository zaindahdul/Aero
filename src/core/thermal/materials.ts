/**
 * Temperature-dependent properties of thrust-chamber materials. Values are
 * representative handbook/literature figures (e.g. NASA GRCop-42 reports,
 * MMPDS-style data for Inconel 718 and 316L); use supplier data for design.
 */
import { interp1 } from '../math/linalg';

export interface Material {
  id: string;
  name: string;
  density: number;
  poisson: number;
  /** Recommended maximum hot-wall temperature, K. */
  maxTemperature: number;
  /** Tables vs temperature [K]. */
  T: number[];
  conductivity: number[]; // W/(m K)
  modulus: number[]; // Pa
  expansion: number[]; // 1/K (mean)
  yieldStrength: number[]; // Pa
}

const MPa = 1e6;
const GPa = 1e9;

export const MATERIALS: Record<string, Material> = {
  GRCop42: {
    id: 'GRCop42',
    name: 'GRCop-42 (AM copper alloy)',
    density: 8790,
    poisson: 0.33,
    maxTemperature: 950,
    T: [293, 500, 700, 900, 1100],
    conductivity: [320, 315, 305, 290, 270],
    modulus: [110 * GPa, 100 * GPa, 90 * GPa, 78 * GPa, 65 * GPa],
    expansion: [16.5e-6, 17.3e-6, 18.0e-6, 18.8e-6, 19.6e-6],
    yieldStrength: [190 * MPa, 170 * MPa, 145 * MPa, 110 * MPa, 60 * MPa],
  },
  CuCrZr: {
    id: 'CuCrZr',
    name: 'CuCrZr (C18150)',
    density: 8890,
    poisson: 0.33,
    maxTemperature: 800,
    T: [293, 473, 623, 773, 923],
    conductivity: [330, 335, 335, 330, 320],
    modulus: [128 * GPa, 120 * GPa, 112 * GPa, 104 * GPa, 95 * GPa],
    expansion: [16.7e-6, 17.2e-6, 17.6e-6, 18.1e-6, 18.6e-6],
    yieldStrength: [310 * MPa, 280 * MPa, 240 * MPa, 160 * MPa, 70 * MPa],
  },
  Inconel718: {
    id: 'Inconel718',
    name: 'Inconel 718',
    density: 8190,
    poisson: 0.29,
    maxTemperature: 980,
    T: [293, 500, 700, 900, 1100],
    conductivity: [11.4, 14.2, 17.0, 20.0, 23.5],
    modulus: [200 * GPa, 188 * GPa, 177 * GPa, 165 * GPa, 150 * GPa],
    expansion: [13.0e-6, 13.6e-6, 14.2e-6, 14.9e-6, 15.8e-6],
    yieldStrength: [1030 * MPa, 980 * MPa, 940 * MPa, 860 * MPa, 600 * MPa],
  },
  SS316L: {
    id: 'SS316L',
    name: 'Stainless steel 316L',
    density: 8000,
    poisson: 0.29,
    maxTemperature: 1000,
    T: [293, 500, 700, 900, 1100],
    conductivity: [14.0, 17.0, 20.0, 23.0, 26.0],
    modulus: [193 * GPa, 178 * GPa, 163 * GPa, 148 * GPa, 132 * GPa],
    expansion: [16.0e-6, 16.9e-6, 17.7e-6, 18.4e-6, 19.0e-6],
    yieldStrength: [240 * MPa, 180 * MPa, 155 * MPa, 130 * MPa, 95 * MPa],
  },
  AlSi10Mg: {
    id: 'AlSi10Mg',
    name: 'AlSi10Mg (AM aluminium)',
    density: 2670,
    poisson: 0.33,
    maxTemperature: 520,
    T: [293, 373, 473, 573, 673],
    conductivity: [140, 150, 155, 158, 160],
    modulus: [70 * GPa, 67 * GPa, 62 * GPa, 55 * GPa, 45 * GPa],
    expansion: [20.0e-6, 21.0e-6, 22.0e-6, 23.0e-6, 24.0e-6],
    yieldStrength: [230 * MPa, 210 * MPa, 150 * MPa, 60 * MPa, 25 * MPa],
  },
  C103: {
    id: 'C103',
    name: 'C-103 niobium alloy (silicide coated)',
    density: 8860,
    poisson: 0.35,
    maxTemperature: 1650,
    T: [293, 800, 1200, 1500, 1700],
    conductivity: [42, 46, 50, 54, 56],
    modulus: [90 * GPa, 85 * GPa, 80 * GPa, 74 * GPa, 70 * GPa],
    expansion: [7.0e-6, 7.5e-6, 8.0e-6, 8.4e-6, 8.7e-6],
    yieldStrength: [300 * MPa, 230 * MPa, 190 * MPa, 140 * MPa, 100 * MPa],
  },
  CarbonCarbon: {
    id: 'CarbonCarbon',
    name: 'Carbon-carbon composite (coated)',
    density: 1800,
    poisson: 0.2,
    maxTemperature: 2000,
    T: [293, 1000, 1500, 2000, 2400],
    conductivity: [40, 35, 32, 30, 30],
    modulus: [70 * GPa, 72 * GPa, 74 * GPa, 76 * GPa, 76 * GPa],
    expansion: [0.8e-6, 1.2e-6, 1.6e-6, 2.0e-6, 2.2e-6],
    yieldStrength: [140 * MPa, 145 * MPa, 150 * MPa, 155 * MPa, 150 * MPa],
  },
  Ti64: {
    id: 'Ti64',
    name: 'Ti-6Al-4V',
    density: 4430,
    poisson: 0.34,
    maxTemperature: 700,
    T: [293, 473, 673, 873],
    conductivity: [6.7, 8.8, 11.4, 14.0],
    modulus: [114 * GPa, 105 * GPa, 96 * GPa, 85 * GPa],
    expansion: [8.6e-6, 9.2e-6, 9.7e-6, 10.1e-6],
    yieldStrength: [880 * MPa, 700 * MPa, 590 * MPa, 450 * MPa],
  },
};

export const materialProps = (m: Material, T: number) => ({
  conductivity: interp1(m.T, m.conductivity, T),
  modulus: interp1(m.T, m.modulus, T),
  expansion: interp1(m.T, m.expansion, T),
  yieldStrength: interp1(m.T, m.yieldStrength, T),
});
