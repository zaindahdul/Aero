/** Linear and log scales with "nice" tick generation. */

export interface Scale {
  (v: number): number;
  ticks: number[];
  domain: [number, number];
  format: (v: number) => string;
}

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1;
  return step * mag;
}

export function formatNumber(v: number, step?: number): string {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(1).replace('e+', 'e');
  const decimals = step !== undefined ? Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9))) : a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return v.toFixed(decimals);
}

export function linearScale(d0: number, d1: number, r0: number, r1: number, tickCount = 5, nice = true): Scale {
  if (!(d1 > d0)) {
    const pad = Math.abs(d0) * 0.05 || 1;
    d0 -= pad;
    d1 += pad;
  }
  const step = niceStep(d1 - d0, tickCount);
  if (nice) {
    d0 = Math.floor(d0 / step) * step;
    d1 = Math.ceil(d1 / step) * step;
  }
  const ticks: number[] = [];
  for (let t = Math.ceil(d0 / step) * step; t <= d1 + step * 1e-6; t += step) ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  const k = (r1 - r0) / (d1 - d0);
  const s = ((v: number) => r0 + (v - d0) * k) as Scale;
  s.ticks = ticks;
  s.domain = [d0, d1];
  s.format = (v) => formatNumber(v, step);
  return s;
}

export function logScale(d0: number, d1: number, r0: number, r1: number): Scale {
  const l0 = Math.floor(Math.log10(Math.max(d0, 1e-300)));
  const l1 = Math.ceil(Math.log10(Math.max(d1, 1e-300)));
  const lo = l0 === l1 ? l0 - 1 : l0;
  const k = (r1 - r0) / (l1 - lo);
  const s = ((v: number) => r0 + (Math.log10(Math.max(v, 1e-300)) - lo) * k) as Scale;
  s.ticks = [];
  const every = l1 - lo > 6 ? 2 : 1;
  for (let e = lo; e <= l1; e += every) s.ticks.push(Math.pow(10, e));
  s.domain = [Math.pow(10, lo), Math.pow(10, l1)];
  s.format = (v) => {
    const e = Math.round(Math.log10(v));
    return e >= -2 && e <= 3 ? String(Number(v.toPrecision(1))) : `1e${e}`;
  };
  return s;
}

export const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];

/** Nearest index in a sorted array. */
export function nearestIndex(xs: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  if (hi < 0) return -1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
}
