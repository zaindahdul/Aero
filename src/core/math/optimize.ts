/** Derivative-free Nelder-Mead simplex minimization. */
export interface NelderMeadResult {
  x: number[];
  fx: number;
  evaluations: number;
  history: { x: number[]; fx: number }[];
}

export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  step: number[],
  { maxEvaluations = 120, tolF = 1e-7, tolX = 1e-3 } = {},
): NelderMeadResult {
  const n = x0.length;
  const history: NelderMeadResult['history'] = [];
  let evaluations = 0;
  const evalF = (x: number[]) => {
    const fx = f(x);
    evaluations++;
    history.push({ x: x.slice(), fx });
    return fx;
  };
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const v = x0.slice();
    v[i] += step[i];
    simplex.push(v);
  }
  let values = simplex.map(evalF);
  const centroid = (exclude: number) => {
    const c = new Array(n).fill(0);
    simplex.forEach((v, k) => {
      if (k !== exclude) for (let i = 0; i < n; i++) c[i] += v[i] / n;
    });
    return c;
  };
  const along = (a: number[], b: number[], t: number) => a.map((ai, i) => ai + t * (b[i] - ai));

  while (evaluations < maxEvaluations) {
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);
    const spread = Math.max(...simplex.slice(1).map((v) => Math.max(...v.map((vi, i) => Math.abs(vi - simplex[0][i])))));
    if (Math.abs(values[n] - values[0]) < tolF && spread < tolX) break;

    const c = centroid(n);
    const xr = along(c, simplex[n], -1);
    const fr = evalF(xr);
    if (fr < values[0]) {
      const xe = along(c, simplex[n], -2);
      const fe = evalF(xe);
      if (fe < fr) {
        simplex[n] = xe;
        values[n] = fe;
      } else {
        simplex[n] = xr;
        values[n] = fr;
      }
    } else if (fr < values[n - 1]) {
      simplex[n] = xr;
      values[n] = fr;
    } else {
      const outside = fr < values[n];
      const xc = outside ? along(c, xr, 0.5) : along(c, simplex[n], 0.5);
      const fc = evalF(xc);
      if (fc < (outside ? fr : values[n])) {
        simplex[n] = xc;
        values[n] = fc;
      } else {
        for (let k = 1; k <= n; k++) {
          simplex[k] = along(simplex[0], simplex[k], 0.5);
          values[k] = evalF(simplex[k]);
        }
      }
    }
  }
  let best = 0;
  for (let k = 1; k < values.length; k++) if (values[k] < values[best]) best = k;
  return { x: simplex[best], fx: values[best], evaluations, history };
}
