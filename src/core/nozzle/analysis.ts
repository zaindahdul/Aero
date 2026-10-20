import { type ContourGeometry, wallPoint } from './contour';
import { type EulerResult, marchEuler } from './euler';
import { idealThrustCoefficient, pressureRatio, vandenkerckhove } from './isentropic';
import { type MocResult, type MocWall, runMoc, sampleAtX } from './moc';
import { supersonicMachFromArea } from '../thermo/rocket';

export interface NozzleAnalysis {
  moc: MocResult;
  euler: EulerResult | null;
  /** Plane where the Euler march starts from the MoC solution (normalized x). */
  xStart: number;
  /** Isp efficiency from the isentropic MoC and from the shock-capturing Euler march. */
  efficiencyMoc: number;
  efficiencyEuler: number;
  /** Best estimate: Euler when available (handles internal shocks). */
  efficiency: number;
  /** Vacuum thrust coefficient including the discharge coefficient. */
  cfVac: number;
  dischargeCoefficient: number;
}

export function nozzleWall(geom: ContourGeometry): MocWall {
  const rt = geom.rt;
  return (x) => {
    const p = wallPoint(geom, x * rt);
    return { r: p.r / rt, angle: p.angle };
  };
}

/**
 * Hybrid nozzle-flow analysis: the method of characteristics from the throat
 * through the transonic region, handing over to a conservative shock-capturing
 * Euler space-march once the axial Mach number exceeds one everywhere.
 * The discharge coefficient uses the mean of the throat radii of curvature.
 */
export function analyzeNozzle(geom: ContourGeometry, gamma: number, resolution = 40, eulerCells = 80): NozzleAnalysis {
  const wall = nozzleWall(geom);
  const xExit = geom.xExit / geom.rt;
  const moc = runMoc({
    gamma,
    wall,
    xExit,
    rcThroat: 0.5 * (geom.chamber.rcUpstream + geom.nozzle.rcDownstream),
    resolution,
  });

  // First plane (past the throat arc) that is axially supersonic everywhere.
  let xStart = NaN;
  let plane: ReturnType<typeof sampleAtX> | null = null;
  for (let xs = Math.max(0.3, geom.xArcEnd / geom.rt); xs < 0.6 * xExit; xs += 0.05) {
    const s = sampleAtX(moc.x, moc.r, moc.mach, moc.theta, moc.triangles, xs, wall(xs).r, eulerCells);
    if (s.mach.every((M, k) => M * Math.cos(s.theta[k]) > 1.05)) {
      xStart = xs;
      plane = s;
      break;
    }
  }

  let euler: EulerResult | null = null;
  let efficiencyEuler = NaN;
  if (plane) {
    const pl = plane;
    const rw = wall(xStart).r;
    euler = marchEuler({
      gamma,
      wall,
      xStart,
      xExit,
      cells: eulerCells,
      start: (eta) => {
        const r = eta * rw;
        const k = Math.min(pl.r.length - 2, Math.floor((r / rw) * (pl.r.length - 1)));
        const t = (r - pl.r[k]) / (pl.r[k + 1] - pl.r[k]);
        return { M: pl.mach[k] + t * (pl.mach[k + 1] - pl.mach[k]), theta: pl.theta[k] + t * (pl.theta[k + 1] - pl.theta[k]) };
      },
    });
    const eps = moc.eps;
    const cf1D = idealThrustCoefficient(gamma, eps, pressureRatio(supersonicMachFromArea(eps, gamma), gamma));
    efficiencyEuler = euler.thrust / euler.massFlow / (cf1D / vandenkerckhove(gamma));
  }
  const efficiency = Number.isFinite(efficiencyEuler) ? efficiencyEuler : moc.efficiency;
  return {
    moc,
    euler,
    xStart,
    efficiencyMoc: moc.efficiency,
    efficiencyEuler,
    efficiency,
    cfVac: moc.cfVac1D * efficiency * moc.dischargeCoefficient,
    dischargeCoefficient: moc.dischargeCoefficient,
  };
}
