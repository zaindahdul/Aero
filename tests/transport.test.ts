import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/cea_reference.json';
import { PROPELLANTS } from '../src/core/thermo/propellants';
import { RocketExpansion } from '../src/core/thermo/rocket';
import { mixtureTransport } from '../src/core/thermo/transport';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('frozen chamber transport vs NASA CEA', () => {
  for (const c of fixtures.cases.filter((_, i) => i % 2 === 0)) {
    it(`${c.ox}/${c.fuel} O/F=${c.of} Pc=${(c.pc / 1e5).toFixed(0)} bar`, () => {
      const ch = new RocketExpansion(PROPELLANTS[c.ox], PROPELLANTS[c.fuel], c.of, c.pc).chamber;
      const t = mixtureTransport(ch.moleFractions, ch.T);
      const ref = c.chamberTransportFrozen;
      expect(rel(t.viscosity, ref.viscosity)).toBeLessThan(2e-3);
      expect(rel(t.conductivity, ref.conductivity)).toBeLessThan(5e-3);
      expect(rel(t.prandtl, ref.prandtl)).toBeLessThan(5e-3);
      expect(rel(t.cp, ref.cp)).toBeLessThan(2e-3);
    });
  }
});
