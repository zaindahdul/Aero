import { describe, expect, it } from 'vitest';
import { buildContour, raoAngleGuess } from '../src/core/nozzle/contour';
import { analyzeNozzle } from '../src/core/nozzle/analysis';
import { dischargeCoefficient } from '../src/core/nozzle/moc';
import {
  densityRatio,
  idealThrustCoefficient,
  machFromPrandtlMeyer,
  prandtlMeyer,
  pressureRatio,
  vandenkerckhove,
} from '../src/core/nozzle/isentropic';
import { supersonicMachFromArea } from '../src/core/thermo/rocket';

/**
 * Exact vacuum Isp efficiency of conical source flow: momentum thrust lambda*V on a
 * spherical exit cap of area eps/lambda, plus cap pressure on the projected exit area,
 * relative to ideal 1-D flow at the same planar area ratio (p0 = rho0 = 1, At = pi).
 */
function sourceFlowEfficiency(g: number, eps: number, halfAngleDeg: number): number {
  const lambda = (1 + Math.cos((halfAngleDeg * Math.PI) / 180)) / 2;
  const mdot = Math.PI * vandenkerckhove(g);
  const Ms = supersonicMachFromArea(eps / lambda, g);
  const ps = pressureRatio(Ms, g);
  const Vs = Ms * Math.sqrt((g * ps) / densityRatio(Ms, g));
  const ispSource = lambda * Vs + (ps * Math.PI * eps) / mdot;
  const isp1D = (idealThrustCoefficient(g, eps, pressureRatio(supersonicMachFromArea(eps, g), g)) * Math.PI) / mdot;
  return ispSource / isp1D;
}

const chamber = { rt: 0.05, contractionRatio: 4, lstar: 1.0, convergentAngle: 30, rcUpstream: 1.5, rcChamber: 1.0 };

describe('Prandtl-Meyer function', () => {
  it('round-trips across the supersonic range', () => {
    for (const g of [1.13, 1.2, 1.4, 1.67]) {
      for (const M of [1.0001, 1.01, 1.3, 2, 4, 8, 20]) {
        expect(machFromPrandtlMeyer(prandtlMeyer(M, g), g)).toBeCloseTo(M, 8);
      }
    }
  });
  it('matches the tabulated nu(M=2) = 26.38 deg for gamma = 1.4', () => {
    expect((prandtlMeyer(2, 1.4) * 180) / Math.PI).toBeCloseTo(26.38, 2);
  });
});

describe('method of characteristics', () => {
  for (const half of [10, 15, 20]) {
    it(`smooth ${half} deg cone matches conical source-flow theory`, () => {
      const g = buildContour(chamber, { kind: 'cone', eps: 25, rcDownstream: 8, halfAngle: half });
      const m = analyzeNozzle(g, 1.2, 60);
      expect(m.complete).toBe(true);
      expect(Math.abs(m.efficiency - sourceFlowEfficiency(1.2, m.eps, half))).toBeLessThan(1.5e-3);
      expect(m.balanceError).toBeLessThan(3e-3);
      expect(m.massBalanceError).toBeLessThan(3e-3);
    });
  }

  it('locates the internal shock of a sharp-throat cone consistently under refinement', () => {
    const g = buildContour(chamber, { kind: 'cone', eps: 25, rcDownstream: 0.382, halfAngle: 15 });
    const coarse = analyzeNozzle(g, 1.2, 30);
    const fine = analyzeNozzle(g, 1.2, 80);
    expect(coarse.shock).not.toBeNull();
    expect(fine.shock).not.toBeNull();
    expect(Math.abs(coarse.shock!.x - fine.shock!.x) / fine.shock!.x).toBeLessThan(0.05);
  });

  it('80% Rao bell efficiency is grid-converged and close to theory', () => {
    const a = raoAngleGuess(25);
    const g = buildContour(chamber, { kind: 'bell', eps: 25, rcDownstream: 0.382, lengthFraction: 0.8, ...a });
    const m40 = analyzeNozzle(g, 1.2, 40);
    const m80 = analyzeNozzle(g, 1.2, 80);
    expect(Math.abs(m40.efficiency - m80.efficiency)).toBeLessThan(5e-3);
    expect(m80.efficiency).toBeGreaterThan(0.982);
    expect(m80.efficiency).toBeLessThan(0.995);
  });

  it('Kliegel-Levine discharge coefficient rises toward 1 with throat radius', () => {
    const cd = [0.5, 1, 2, 4].map((R) => dischargeCoefficient(1.2, R));
    for (let i = 1; i < cd.length; i++) expect(cd[i]).toBeGreaterThan(cd[i - 1]);
    expect(cd[1]).toBeGreaterThan(0.98);
    expect(cd[3]).toBeLessThan(1);
  });
});
