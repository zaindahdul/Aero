import { describe, expect, it } from 'vitest';
import type { CycleKind } from '../src/core/cycle';
import { designEngine, type EngineInputs } from '../src/core/design';
import { PRESETS } from '../src/core/presets';

const preset = (id: string) => PRESETS.find((p) => p.id === id)!.inputs;
const solve = (inputs: EngineInputs, kind?: CycleKind, patch: Partial<EngineInputs['cycle']> = {}) =>
  designEngine({ ...inputs, nozzle: { ...inputs.nozzle, optimize: false }, cycle: { ...inputs.cycle, ...(kind ? { kind } : {}), ...patch } });

const pumpPower = (d: ReturnType<typeof designEngine>) => d.cycle!.pumps.reduce((s, p) => s + p.power, 0);
const turbinePower = (d: ReturnType<typeof designEngine>) => d.cycle!.turbines.reduce((s, t) => s + t.power, 0);

describe('engine cycles', () => {
  it('pressure-fed tanks supply the injector, and the designed coolant inlet when regen cooled', () => {
    const d = solve(preset('student-ethalox'));
    const c = d.cycle!;
    expect(c.pumps).toEqual([]);
    expect(c.pressureBudget[0].pressure).toBeCloseTo(d.inputs.cooling.inletPressure, 6);
    expect(c.pressureBudget.at(-1)!.pressure).toBe(d.inputs.pc);
  });

  it('gas generator balances turbine and pump power and pays an Isp penalty', () => {
    const d = solve(preset('kerolox-booster'), 'gas-generator');
    const c = d.cycle!;
    expect(Math.abs(turbinePower(d) - pumpPower(d)) / pumpPower(d)).toBeLessThan(1e-6);
    const ggFraction = c.combustors[0].massFlow / c.totalMassFlow;
    expect(ggFraction).toBeGreaterThan(0.005);
    expect(ggFraction).toBeLessThan(0.1);
    expect(c.ispVac).toBeLessThan(d.performance.ispVac);
    expect(c.combustors[0].temperature).toBeCloseTo(d.inputs.cycle.turbineInletTemperature, -1);
  });

  it('closed expander is heat-limited: margin falls as chamber pressure rises', () => {
    const base = preset('hydrolox-upper');
    const low = solve(base, 'expander');
    const high = solve({ ...base, pc: 70e5, cooling: { ...base.cooling, inletPressure: 150e5 } }, 'expander');
    expect(low.cycle!.closes).toBe(true);
    expect(low.cycle!.powerMargin).toBeGreaterThan(high.cycle!.powerMargin);
    expect(low.cycle!.turbines[0].pressureRatio).toBeGreaterThan(1);
  });

  it('full-flow staged combustion closes both shafts with an ordered pressure ladder', () => {
    const d = solve(preset('methalox-booster'), 'full-flow');
    const c = d.cycle!;
    expect(c.closes).toBe(true);
    expect(c.turbines).toHaveLength(2);
    expect(Math.abs(turbinePower(d) - pumpPower(d)) / pumpPower(d)).toBeLessThan(1e-6);
    for (const t of c.turbines) {
      expect(t.pressureRatio).toBeGreaterThan(1);
      expect(t.pressureRatio).toBeLessThan(4);
      expect(t.outletPressure).toBeGreaterThan(d.inputs.pc);
    }
    expect(c.ispVac).toBe(d.performance.ispVac);
  });

  it('single-shaft fuel-rich staged combustion cannot close a 200 bar methalox engine', () => {
    // Low-gamma methane-rich gas yields too little work per unit pressure ratio,
    // which is why full-flow staged combustion is used for this propellant.
    const c = solve(preset('methalox-booster'), 'staged-combustion').cycle!;
    expect(c.closes).toBe(false);
    expect(c.powerMargin).toBeLessThan(0);
  });

  it('kerosene staged combustion runs oxidizer-rich and closes', () => {
    const c = solve(preset('kerolox-booster'), 'staged-combustion', { turbineInletTemperature: 750, turbineEfficiency: 0.75 }).cycle!;
    expect(c.closes).toBe(true);
    expect(c.combustors[0].label).toContain('Oxidizer-rich');
    expect(c.combustors[0].mixtureRatio).toBeGreaterThan(20);
  });
});
