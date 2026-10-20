import { describe, expect, it } from 'vitest';
import { buildContour } from '../src/core/nozzle/contour';
import { analyzeNozzle } from '../src/core/nozzle/analysis';
import { optimizeBell } from '../src/core/nozzle/optimize';

const chamber = { rt: 0.05, contractionRatio: 4, lstar: 1.0, convergentAngle: 30, rcUpstream: 1.5, rcChamber: 1.0 };

describe('hybrid MoC / Euler nozzle analysis', () => {
  it('conserves mass to round-off in the Euler march', () => {
    const g = buildContour(chamber, { kind: 'bell', eps: 25, rcDownstream: 0.382, lengthFraction: 0.8, thetaN: 30, thetaE: 9 });
    const a = analyzeNozzle(g, 1.2);
    expect(a.euler).not.toBeNull();
    expect(a.euler!.massDrift).toBeLessThan(1e-12);
  });

  for (const [label, nozzle] of [
    ['smooth 15 deg cone', { kind: 'cone', eps: 25, rcDownstream: 8, halfAngle: 15 }],
    ['smooth-throat bell', { kind: 'bell', eps: 25, rcDownstream: 2, lengthFraction: 0.8, thetaN: 30, thetaE: 9 }],
  ] as const) {
    it(`MoC and Euler agree on a shock-free ${label}`, () => {
      const a = analyzeNozzle(buildContour(chamber, nozzle), 1.2, 40, 100);
      expect(Math.abs(a.efficiencyMoc - a.efficiencyEuler)).toBeLessThan(1e-3);
    });
  }

  it('Euler efficiency is grid-converged for a TOP bell with an internal shock', () => {
    const g = buildContour(chamber, { kind: 'bell', eps: 25, rcDownstream: 0.382, lengthFraction: 0.8, thetaN: 30, thetaE: 11 });
    const coarse = analyzeNozzle(g, 1.2, 40, 60);
    const fine = analyzeNozzle(g, 1.2, 40, 120);
    expect(coarse.moc.shock).not.toBeNull();
    expect(Math.abs(coarse.efficiencyEuler - fine.efficiencyEuler)).toBeLessThan(5e-4);
  });
});

describe('thrust-optimized bell', () => {
  it('improves on the chart guess and lands near Rao (eps 25, 80% bell)', () => {
    const o = optimizeBell(chamber, { eps: 25, rcDownstream: 0.382, lengthFraction: 0.8 }, 1.2);
    expect(o.efficiency).toBeGreaterThanOrEqual(o.initial.efficiency);
    expect(o.efficiency).toBeLessThan(1);
    expect(o.thetaN).toBeGreaterThan(27);
    expect(o.thetaN).toBeLessThan(37);
    expect(o.thetaE).toBeGreaterThan(5);
    expect(o.thetaE).toBeLessThan(11);
  });

  it('longer bells are more efficient', () => {
    const e = [0.7, 0.8, 0.9].map((lf) => optimizeBell(chamber, { eps: 25, rcDownstream: 0.382, lengthFraction: lf }, 1.2).efficiency);
    expect(e[1]).toBeGreaterThan(e[0]);
    expect(e[2]).toBeGreaterThan(e[1]);
  });
});
