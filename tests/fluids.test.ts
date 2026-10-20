import { describe, expect, it } from 'vitest';
import points from './fixtures/coolprop_points.json';
import { type CoolantId, getFluid } from '../src/core/fluids/fluids';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('coolant property tables vs CoolProp', () => {
  for (const p of points) {
    it(`${p.id} at ${p.T} K, ${(p.P / 1e5).toFixed(0)} bar`, () => {
      const s = getFluid(p.id as CoolantId).state(p.T, p.P);
      expect(rel(s.rho, p.rho)).toBeLessThan(0.01);
      expect(rel(s.cp, p.cp)).toBeLessThan(0.03);
      expect(rel(s.mu, p.mu)).toBeLessThan(0.02);
      expect(rel(s.k, p.k)).toBeLessThan(0.02);
    });
  }
  it('inverts enthalpy to temperature', () => {
    const f = getFluid('methane');
    for (const T of [120, 190, 230, 400]) {
      const h = f.state(T, 150e5).h;
      expect(f.temperatureFromEnthalpy(h, 150e5)).toBeCloseTo(T, 1);
    }
  });
  it('reports saturation below the critical pressure only', () => {
    const f = getFluid('methane');
    expect(f.saturationTemperature(10e5)).toBeGreaterThan(140);
    expect(f.saturationTemperature(60e5)).toBeNull();
  });
});
