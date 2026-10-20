export const fmt = (v: number, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '–');
export const fmtSig = (v: number, sig = 4) => (Number.isFinite(v) ? String(Number(v.toPrecision(sig))) : '–');
export const kN = (n: number) => (Math.abs(n) >= 1e5 ? fmt(n / 1e3, 0) : Math.abs(n) >= 1e4 ? fmt(n / 1e3, 1) : fmt(n / 1e3, 2));
export const bar = (p: number) => (p >= 1e6 ? fmt(p / 1e5, 1) : fmt(p / 1e5, 2));
export const mm = (m: number, d = 1) => fmt(m * 1e3, d);
export const pct = (f: number, d = 2) => fmt(f * 100, d);

/** Thrust with an adaptive unit. */
export function force(n: number): { value: string; unit: string } {
  if (Math.abs(n) >= 1e6) return { value: fmt(n / 1e6, 2), unit: 'MN' };
  if (Math.abs(n) >= 1e3) return { value: kN(n), unit: 'kN' };
  return { value: fmt(n, 0), unit: 'N' };
}

export function massFlow(kgs: number): { value: string; unit: string } {
  if (kgs >= 10) return { value: fmt(kgs, 1), unit: 'kg/s' };
  if (kgs >= 1) return { value: fmt(kgs, 2), unit: 'kg/s' };
  return { value: fmt(kgs * 1e3, 0), unit: 'g/s' };
}

/** Pretty chemical formula for a NASA species name. */
export function species(name: string): string {
  const base = name.split(',')[0];
  return base.replace(/(\d+)/g, (d) => d.split('').map((c) => '₀₁₂₃₄₅₆₇₈₉'[Number(c)]).join(''));
}
