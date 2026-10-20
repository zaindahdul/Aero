import { describe, expect, it } from 'vitest';
import { G0 } from '../src/core/constants';
import { designEngine, mixtureRatioSweep } from '../src/core/design';
import { getFluid } from '../src/core/fluids/fluids';
import { PRESETS } from '../src/core/presets';

describe('end-to-end engine design', () => {
  for (const preset of PRESETS) {
    describe(preset.label, () => {
      const d = designEngine(preset.inputs);
      const p = d.performance;

      it('meets the thrust target at the reference ambient pressure', () => {
        expect(p.thrustAmbient).toBeCloseTo(preset.inputs.thrust, -1);
      });

      it('is self-consistent: F_vac = mdot * Isp_vac * g0, mixture ratio preserved', () => {
        expect(Math.abs(p.thrustVac - p.massFlow * p.ispVac * G0) / p.thrustVac).toBeLessThan(1e-9);
        expect(p.oxidizerFlow / p.fuelFlow).toBeCloseTo(preset.inputs.of, 9);
      });

      it('delivered Isp sits just below ideal', () => {
        expect(p.ispVac).toBeLessThan(p.ispVacIdeal);
        expect(p.ispVac).toBeGreaterThan(0.93 * p.ispVacIdeal);
        expect(p.nozzleEfficiency).toBeGreaterThan(0.97);
        expect(p.nozzleEfficiency).toBeLessThan(1);
      });

      it('thrust grows with altitude', () => {
        for (let i = 1; i < d.altitude.length; i++) expect(d.altitude[i].thrust).toBeGreaterThanOrEqual(d.altitude[i - 1].thrust);
      });

      it('wall temperatures stay below material limits with no structural warnings', () => {
        expect(d.thermal.maxTemperatureRatio).toBeLessThan(1);
        expect(d.thermal.minLiningSF).toBeGreaterThan(1.25);
        expect(d.warnings.filter((w) => /exceeds|exhausted|below the|safety factor/.test(w))).toEqual([]);
      });

      if (d.coolant) {
        it('coolant energy balance closes: Q = mdot_c (h_out - h_in)', () => {
          const t = d.thermal;
          const fluid = getFluid(d.coolant!);
          const c = preset.inputs.cooling;
          const mdotC = c.coolantFraction * (c.coolantSide === 'fuel' ? p.fuelFlow : p.oxidizerFlow);
          const dh = fluid.state(t.outletTemperature, t.outletPressure).h - fluid.state(c.inletTemperature, c.inletPressure).h;
          expect(Math.abs(mdotC * dh - t.heatLoad) / t.heatLoad).toBeLessThan(0.02);
        });
      }
    });
  }

  it('Isp peaks fuel-rich of stoichiometric for LOX/LH2', () => {
    const sweep = mixtureRatioSweep('LOX', 'LH2', 70e5, 40, false, 2.5, 8.5, 25);
    const best = sweep.reduce((a, b) => (b.ispVac > a.ispVac ? b : a));
    expect(best.of).toBeGreaterThan(3.5);
    expect(best.of).toBeLessThan(5.5); // stoichiometric is 7.94
  });
});
