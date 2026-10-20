/**
 * Thrust-optimized parabolic (TOP) bell by direct optimization: for a fixed
 * area ratio and length, the parabola is defined by its inflection angle
 * thetaN and exit angle thetaE. Each candidate contour is analyzed with the
 * hybrid MoC / shock-capturing Euler solver (TOP contours carry a weak
 * internal shock) and the vacuum Isp efficiency is maximized with Nelder-Mead, replacing
 * the classical lookup in Rao's charts. With area ratio fixed, the ambient
 * pressure term is a constant, so the vacuum optimum is the optimum at any
 * ambient pressure.
 */
import { type ChamberSpec, buildContour, raoAngleGuess } from './contour';
import { analyzeNozzle } from './analysis';
import { nelderMead } from '../math/optimize';

export interface BellOptimization {
  thetaN: number;
  thetaE: number;
  efficiency: number;
  initial: { thetaN: number; thetaE: number; efficiency: number };
  evaluations: number;
  history: { thetaN: number; thetaE: number; efficiency: number }[];
}

export function optimizeBell(
  chamber: ChamberSpec,
  nozzle: { eps: number; rcDownstream: number; lengthFraction: number },
  gamma: number,
  resolution = 32,
): BellOptimization {
  const guess = raoAngleGuess(nozzle.eps);
  const history: BellOptimization['history'] = [];
  const evaluate = (tn: number, te: number): number => {
    if (te < 0.5 || tn > 50 || tn - te < 4) return 0;
    const geom = buildContour(chamber, { kind: 'bell', ...nozzle, thetaN: tn, thetaE: te });
    if (geom.warnings.some((w) => w.includes('not realizable'))) return 0;
    let eff = 0;
    try {
      const a = analyzeNozzle(geom, gamma, resolution, 60);
      eff = a.moc.complete && Number.isFinite(a.efficiency) ? a.efficiency : 0;
    } catch {
      // Characteristics that cannot reach the wall: an unphysical candidate.
    }
    history.push({ thetaN: tn, thetaE: te, efficiency: eff });
    return eff;
  };
  const initialEff = evaluate(guess.thetaN, guess.thetaE);
  const res = nelderMead(([tn, te]) => -evaluate(tn, te), [guess.thetaN, guess.thetaE], [4, 2.5], {
    maxEvaluations: 60,
    tolF: 2e-6,
    tolX: 0.1,
  });
  const [thetaN, thetaE] = res.x;
  return {
    thetaN,
    thetaE,
    efficiency: -res.fx,
    initial: { ...guess, efficiency: initialEff },
    evaluations: res.evaluations + 1,
    history,
  };
}
