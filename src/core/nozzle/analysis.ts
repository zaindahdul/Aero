import { type ContourGeometry, wallPoint } from './contour';
import { type MocResult, runMoc } from './moc';

/**
 * Runs the MoC on the divergent section of a contour. The discharge
 * coefficient uses the mean of the upstream and downstream throat radii.
 */
export function analyzeNozzle(geom: ContourGeometry, gamma: number, resolution = 40): MocResult {
  const rt = geom.rt;
  return runMoc({
    gamma,
    wall: (x) => {
      const p = wallPoint(geom, x * rt);
      return { r: p.r / rt, angle: p.angle };
    },
    xExit: geom.xExit / rt,
    rcThroat: 0.5 * (geom.chamber.rcUpstream + geom.nozzle.rcDownstream),
    resolution,
  });
}
