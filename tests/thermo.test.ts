import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/cea_reference.json';
import { PROPELLANTS } from '../src/core/thermo/propellants';
import { RocketExpansion } from '../src/core/thermo/rocket';

type Case = (typeof fixtures.cases)[number];

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const TOL = 2e-4; // 0.02 %

function label(c: Case) {
  return `${c.ox}/${c.fuel} O/F=${c.of} Pc=${(c.pc / 1e5).toFixed(1)} bar eps=${c.eps}`;
}

describe('rocket performance vs NASA CEA', () => {
  for (const c of fixtures.cases) {
    for (const mode of ['equilibrium', 'frozen'] as const) {
      it(`${label(c)} [${mode}]`, () => {
        const ref = c[mode];
        const ex = new RocketExpansion(PROPELLANTS[c.ox], PROPELLANTS[c.fuel], c.of, c.pc, mode === 'frozen');
        const sol = ex.solve(c.eps);
        expect(rel(sol.chamber.T, ref.Tc)).toBeLessThan(TOL);
        expect(rel(sol.chamber.mw, ref.mwChamber)).toBeLessThan(TOL);
        expect(rel(sol.chamber.gammaEq, ref.gammaChamber)).toBeLessThan(TOL);
        expect(rel(sol.chamber.rho, ref.rhoChamber)).toBeLessThan(TOL);
        expect(rel(sol.ispVac, ref.ispVac)).toBeLessThan(TOL);
        expect(rel(sol.pcOverPe, ref.pcOverPe)).toBeLessThan(1e-3);
        expect(rel(sol.exit.T, ref.Te)).toBeLessThan(TOL);
        expect(rel(sol.throat.T, ref.Tt)).toBeLessThan(TOL);
        expect(rel(sol.throat.a, ref.aThroat)).toBeLessThan(TOL);
        expect(rel(sol.exit.a, ref.aExit)).toBeLessThan(TOL);
        expect(rel(sol.exit.mach, ref.machExit)).toBeLessThan(TOL);
        // RocketCEA reports the equilibrium c* and throat pressure regardless of the frozen flag.
        if (mode === 'equilibrium') {
          expect(rel(sol.cstar, ref.cstar)).toBeLessThan(TOL);
          expect(rel(sol.pcOverPt, ref.pcOverPt)).toBeLessThan(TOL);
        }
      });
    }
  }
});
