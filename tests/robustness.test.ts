import { expect, it } from 'vitest';
import { designEngine, type EngineInputs } from '../src/core/design';
import { PRESETS } from '../src/core/presets';
import { FUELS, OXIDIZERS, PROPELLANTS, stoichiometricOF } from '../src/core/thermo/propellants';

// Deterministic PRNG (mulberry32).
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it('never crashes or returns non-finite results on randomized inputs', () => {
  const r = rng(12345);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const rows: string[] = [];
  let ok = 0;
  let handled = 0;
  for (let k = 0; k < 40; k++) {
    const base = pick(PRESETS).inputs;
    const ox = pick(OXIDIZERS).id;
    const fu = pick(FUELS).id;
    const st = stoichiometricOF(PROPELLANTS[ox], PROPELLANTS[fu]);
    const inp: EngineInputs = {
      ...base,
      oxidizer: ox,
      fuel: fu,
      of: st * (0.35 + 0.9 * r()),
      pc: (5 + 250 * r()) * 1e5,
      thrust: Math.pow(10, 2 + 4 * r()),
      thrustAmbient: r() < 0.5 ? 0 : 101325,
      expansion: r() < 0.7 ? { mode: 'eps', eps: 3 + 120 * r() } : { mode: 'pe', pe: 2e3 + 1e5 * r() },
      frozen: r() < 0.25,
      nozzle: { ...base.nozzle, kind: r() < 0.25 ? 'cone' : 'bell', optimize: r() < 0.5, lengthFraction: 0.6 + 0.4 * r(), halfAngle: 8 + 15 * r() },
      cooling: { ...base.cooling, mode: r() < 0.8 ? 'regen' : 'radiative', coolantSide: r() < 0.8 ? 'fuel' : 'oxidizer', barrierFraction: r() < 0.3 ? 0.1 * r() : 0, barrierMixtureRatio: st * 0.25 },
      numerics: { stations: 120, mocResolution: 24, eulerCells: 40 },
    };
    const tag = `${ox}/${fu} OF=${inp.of.toFixed(2)} Pc=${(inp.pc / 1e5).toFixed(0)} F=${inp.thrust.toFixed(0)} amb=${inp.thrustAmbient} ${JSON.stringify(inp.expansion)} ${inp.nozzle.kind}${inp.nozzle.optimize ? '+opt' : ''} ${inp.cooling.mode}/${inp.cooling.coolantSide} frozen=${inp.frozen}`;
    try {
      const d = designEngine(inp);
      const bad = [d.performance.ispVac, d.performance.thrustVac, d.thermal.maxWallTemperature, d.geometry.throatDiameter].some((v) => !Number.isFinite(v));
      if (bad) rows.push(`NONFINITE ${tag}`);
      else ok++;
    } catch (e) {
      const msg = (e as Error).message;
      const friendly = /must|not achievable|Barrier|fuel-rich|Expansion/.test(msg);
      if (friendly) handled++;
      rows.push(`${friendly ? 'handled' : 'CRASH'} ${tag} :: ${msg}${friendly ? '' : '\n' + (e as Error).stack?.split('\n').slice(1, 4).join('\n')}`);
    }
  }
  // Every case either solves or fails with an actionable message.
  expect(rows.filter((row) => !row.startsWith('handled'))).toEqual([]);
  expect(ok + handled).toBe(40);
  expect(ok).toBeGreaterThan(30);
});
