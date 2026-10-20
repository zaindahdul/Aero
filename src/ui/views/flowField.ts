import { sequential } from '../colormaps';
import type { EngineDesign } from '../../core/design';

/** Mach-number triangles (x, r, M) in metres: 1-D chamber, MoC through the throat, Euler downstream. */
export function flowTriangles(design: EngineDesign): { tris: Float32Array; mMax: number } {
  const rt = design.geometry.throatDiameter / 2;
  const moc = design.nozzleFlow.moc;
  const eu = design.nozzleFlow.euler;
  const xStart = eu ? design.nozzleFlow.xStart : Infinity;
  const out: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => out.push(...a, ...b, ...c);

  const st = design.stations;
  for (let i = 0; i + 1 < st.length && st[i + 1].x <= 0; i++) {
    const a = st[i];
    const b = st[i + 1];
    tri([a.x, 0, a.M], [b.x, 0, b.M], [b.x, b.r, b.M]);
    tri([a.x, 0, a.M], [b.x, b.r, b.M], [a.x, a.r, a.M]);
  }
  const T = moc.triangles;
  const xLimit = Math.min(xStart, design.geometry.contour.xExit / rt);
  for (let t = 0; t < T.length; t += 3) {
    const [ia, ib, ic] = [T[t], T[t + 1], T[t + 2]];
    if (Math.max(moc.x[ia], moc.x[ib], moc.x[ic]) > xLimit) continue;
    tri([moc.x[ia] * rt, moc.r[ia] * rt, moc.mach[ia]], [moc.x[ib] * rt, moc.r[ib] * rt, moc.mach[ib]], [moc.x[ic] * rt, moc.r[ic] * rt, moc.mach[ic]]);
  }
  if (eu) {
    const n = eu.mach[0].length;
    for (let k = 0; k + 1 < eu.x.length; k++) {
      const xa = eu.x[k] * rt;
      const xb = eu.x[k + 1] * rt;
      const m = eu.mach;
      const ra = (j: number) => ((j + 0.5) / n) * eu.rw[k] * rt;
      const rb = (j: number) => ((j + 0.5) / n) * eu.rw[k + 1] * rt;
      tri([xa, 0, m[k][0]], [xb, 0, m[k + 1][0]], [xb, rb(0), m[k + 1][0]]);
      tri([xa, 0, m[k][0]], [xb, rb(0), m[k + 1][0]], [xa, ra(0), m[k][0]]);
      for (let j = 0; j + 1 < n; j++) {
        tri([xa, ra(j), m[k][j]], [xb, rb(j), m[k + 1][j]], [xb, rb(j + 1), m[k + 1][j + 1]]);
        tri([xa, ra(j), m[k][j]], [xb, rb(j + 1), m[k + 1][j + 1]], [xa, ra(j + 1), m[k][j + 1]]);
      }
      // Half-cell strip up to the wall.
      tri([xa, ra(n - 1), m[k][n - 1]], [xb, rb(n - 1), m[k + 1][n - 1]], [xb, eu.rw[k + 1] * rt, m[k + 1][n - 1]]);
      tri([xa, ra(n - 1), m[k][n - 1]], [xb, eu.rw[k + 1] * rt, m[k + 1][n - 1]], [xa, eu.rw[k] * rt, m[k][n - 1]]);
    }
  }
  return { tris: Float32Array.from(out), mMax: Math.max(design.performance.exitMach * 1.05, 1.5) };
}

/**
 * Software rasterization of the (x, r, M) triangles with barycentric Mach
 * interpolation, mirrored about the axis. One putImageData instead of tens of
 * thousands of canvas path fills keeps the canvas cheap to composite.
 */
export function rasterizeField(
  tris: Float32Array,
  mMax: number,
  W: number,
  H: number,
  px: (x: number) => number,
  py: (r: number) => number,
): ImageData {
  const img = new ImageData(W, H);
  const d = img.data;
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = sequential(i / 255);
    lut[3 * i] = Math.round(r * 255);
    lut[3 * i + 1] = Math.round(g * 255);
    lut[3 * i + 2] = Math.round(b * 255);
  }
  const k255 = 255 / mMax;
  for (let k = 0; k < tris.length; k += 9) {
    for (const sgn of [1, -1]) {
      const x0 = px(tris[k]);
      const y0 = py(sgn * tris[k + 1]);
      const x1 = px(tris[k + 3]);
      const y1 = py(sgn * tris[k + 4]);
      const x2 = px(tris[k + 6]);
      const y2 = py(sgn * tris[k + 7]);
      const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(den) < 1e-9) continue;
      const m0 = tris[k + 2];
      const m1 = tris[k + 5];
      const m2 = tris[k + 8];
      const xa = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const xb = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const ya = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const yb = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      const tol = -0.02;
      for (let y = ya; y <= yb; y++) {
        const cyp = y + 0.5;
        for (let x = xa; x <= xb; x++) {
          const cxp = x + 0.5;
          const l0 = ((y1 - y2) * (cxp - x2) + (x2 - x1) * (cyp - y2)) / den;
          if (l0 < tol) continue;
          const l1 = ((y2 - y0) * (cxp - x2) + (x0 - x2) * (cyp - y2)) / den;
          if (l1 < tol) continue;
          const l2 = 1 - l0 - l1;
          if (l2 < tol) continue;
          const idx = Math.min(255, Math.max(0, Math.round((l0 * m0 + l1 * m1 + l2 * m2) * k255))) * 3;
          const o = (y * W + x) * 4;
          d[o] = lut[idx];
          d[o + 1] = lut[idx + 1];
          d[o + 2] = lut[idx + 2];
          d[o + 3] = 255;
        }
      }
    }
  }
  return img;
}
