import { describe, expect, it } from 'vitest';
import { buildEngineModel, triangleCount } from '../src/core/cad/engineModel';
import { profileDXF, toBinarySTL } from '../src/core/cad/exporters';
import { isWatertight, revolve, signedVolume } from '../src/core/cad/mesh';
import { designEngine } from '../src/core/design';
import { PRESETS } from '../src/core/presets';

describe('mesh primitives', () => {
  it('revolved annulus is watertight with the analytic volume', () => {
    const loop = [
      { x: 0, r: 1 },
      { x: 2, r: 1 },
      { x: 2, r: 1.5 },
      { x: 0, r: 1.5 },
    ];
    const m = revolve(loop, 720);
    expect(isWatertight(m)).toBe(true);
    expect(signedVolume(m)).toBeCloseTo(Math.PI * (1.5 ** 2 - 1) * 2, 2);
  });

  it('revolved disk touching the axis closes at the poles', () => {
    const m = revolve(
      [
        { x: 0, r: 0 },
        { x: 1, r: 0 },
        { x: 1, r: 1 },
        { x: 0, r: 1 },
      ],
      360,
    );
    expect(isWatertight(m)).toBe(true);
    expect(signedVolume(m)).toBeCloseTo(Math.PI, 3);
  });
});

describe('engine solid model', () => {
  for (const id of ['student-ethalox', 'hydrolox-upper', 'hypergolic-apogee']) {
    const preset = PRESETS.find((p) => p.id === id)!;
    const design = designEngine({ ...preset.inputs, nozzle: { ...preset.inputs.nozzle, optimize: false } });
    const parts = buildEngineModel(design, { segments: 96 });

    it(`${preset.label}: every body is closed and outward-oriented`, () => {
      for (const p of parts) {
        expect(isWatertight(p.mesh), p.id).toBe(true);
        expect(signedVolume(p.mesh), p.id).toBeGreaterThan(0);
      }
    });

    it(`${preset.label}: STL and DXF export`, () => {
      const stl = toBinarySTL(parts);
      expect(stl.byteLength).toBe(84 + 50 * triangleCount(parts));
      const dxf = profileDXF(design);
      expect(dxf).toContain('GAS_WALL');
      expect(dxf.trim().endsWith('EOF')).toBe(true);
    });
  }

  it('liner + rib volume of the solid model matches the thermal model mass', () => {
    const preset = PRESETS.find((p) => p.id === 'student-ethalox')!;
    const design = designEngine({ ...preset.inputs, nozzle: { ...preset.inputs.nozzle, optimize: false } });
    const parts = buildEngineModel(design, { segments: 256 });
    const rho = 8790; // GRCop-42
    const vol = parts
      .filter((p) => p.group === 'liner' || p.group === 'ribs')
      .reduce((v, p) => v + signedVolume(p.mesh) * (p.instances?.length ?? 1), 0);
    expect(Math.abs(vol * rho - design.mass.liner) / design.mass.liner).toBeLessThan(0.06);
  });
});
