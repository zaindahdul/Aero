import { useId, useMemo, useRef, useState } from 'react';
import { type Scale, SERIES_COLORS, formatNumber, linearScale, logScale, nearestIndex } from './scale';
import { useElementWidth } from '../hooks';

export interface Series {
  id: string;
  label: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Overrides the categorical slot (use only for semantic colours). */
  color?: string;
  mode?: 'line' | 'points' | 'step';
}

export interface LineChartProps {
  series: Series[];
  xLabel: string;
  yLabel: string;
  height?: number;
  yLog?: boolean;
  yMin?: number;
  yMax?: number;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  /** Horizontal reference lines, e.g. a material limit. */
  references?: { y: number; label: string }[];
  /** Vertical markers, e.g. the throat. */
  markers?: { x: number; label: string }[];
  /** Shaded x-ranges, e.g. separated flow. */
  bands?: { x0: number; x1: number; label: string }[];
  directLabels?: boolean;
}

const M = { top: 10, right: 16, bottom: 34, left: 52 };

/** Pushes end labels apart so they never overlap (min 13 px), keeping them inside the plot. */
function spreadLabels<T extends { y: number }>(items: T[], height: number): T[] {
  const list = items
    .filter((d) => Number.isFinite(d.y))
    .sort((a, b) => a.y - b.y)
    .map((d) => ({ ...d }));
  const gap = 13;
  for (let k = 1; k < list.length; k++) if (list[k].y - list[k - 1].y < gap) list[k].y = list[k - 1].y + gap;
  const overflow = list.length ? list[list.length - 1].y - height : 0;
  if (overflow > 0) for (const d of list) d.y -= overflow;
  for (let k = list.length - 2; k >= 0; k--) if (list[k + 1].y - list[k].y < gap) list[k].y = list[k + 1].y - gap;
  return list;
}

export function LineChart(props: LineChartProps) {
  const { series, height = 220, yLog = false } = props;
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ px: number; x: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = useId().replace(/:/g, '');
  const labelRoom = props.directLabels !== false && series.length > 1 && series.length <= 4 ? 64 : 0;
  const innerW = Math.max(60, width - M.left - M.right - labelRoom);
  const innerH = height - M.top - M.bottom;

  const scales = useMemo(() => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const s of series) {
      for (let i = 0; i < s.x.length; i++) {
        const xv = s.x[i];
        const yv = s.y[i];
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || (yLog && yv <= 0)) continue;
        x0 = Math.min(x0, xv);
        x1 = Math.max(x1, xv);
        y0 = Math.min(y0, yv);
        y1 = Math.max(y1, yv);
      }
    }
    for (const r of props.references ?? []) {
      y0 = Math.min(y0, r.y);
      y1 = Math.max(y1, r.y);
    }
    if (!Number.isFinite(x0)) {
      x0 = 0;
      x1 = 1;
      y0 = 0;
      y1 = 1;
    }
    if (props.yMin !== undefined) y0 = props.yMin;
    if (props.yMax !== undefined) y1 = Math.max(props.yMax, y0 + 1e-9);
    const xs = linearScale(x0, x1, 0, innerW, Math.max(3, Math.round(innerW / 90)), false);
    const ys: Scale = yLog ? logScale(y0, y1, innerH, 0) : linearScale(y0, y1, innerH, 0, Math.max(3, Math.round(innerH / 45)));
    return { xs, ys };
  }, [series, innerW, innerH, yLog, props.yMin, props.yMax, props.references]);

  const { xs, ys } = scales;
  const fx = props.xFormat ?? xs.format;
  const fy = props.yFormat ?? ((v: number) => formatNumber(v));
  const color = (s: Series, i: number) => s.color ?? SERIES_COLORS[i % SERIES_COLORS.length];

  const paths = series.map((s, i) => {
    if (s.mode === 'points') return null;
    let d = '';
    let pen = false;
    for (let k = 0; k < s.x.length; k++) {
      const xv = s.x[k];
      const yv = s.y[k];
      if (!Number.isFinite(xv) || !Number.isFinite(yv) || (yLog && yv <= 0)) {
        pen = false;
        continue;
      }
      const px = xs(xv);
      const py = ys(yv);
      if (s.mode === 'step' && pen) d += `H${px.toFixed(1)}V${py.toFixed(1)}`;
      else d += `${pen ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
      pen = true;
    }
    return <path key={s.id} d={d} fill="none" stroke={color(s, i)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
  });

  const onMove = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left - M.left;
    if (px < 0 || px > innerW) return setHover(null);
    const x = xs.domain[0] + (px / innerW) * (xs.domain[1] - xs.domain[0]);
    // Snap to the nearest data x of the first series with data.
    const ref0 = series.find((s) => s.x.length > 0);
    const snapped = ref0 ? ref0.x[nearestIndex(ref0.x, x)] : x;
    setHover({ px: xs(snapped), x: snapped });
  };

  const readout = hover
    ? series.map((s, i) => {
        const k = nearestIndex(s.x, hover.x);
        return { s, i, y: k >= 0 ? s.y[k] : NaN };
      })
    : [];

  return (
    <div className="chart" ref={ref}>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s, i) => (
            <span key={s.id}>
              <i style={{ background: color(s, i) }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg ref={svgRef} width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`${props.yLabel} versus ${props.xLabel}`}>
        <defs>
          <clipPath id={clipId}>
            <rect x={-4} y={-4} width={innerW + 8} height={innerH + 8} />
          </clipPath>
        </defs>
        <g transform={`translate(${M.left},${M.top})`}>
          {(props.bands ?? []).map((b) => (
            <g key={b.label + b.x0}>
              <rect x={xs(b.x0)} width={Math.max(0, xs(b.x1) - xs(b.x0))} y={0} height={innerH} fill="var(--surface-3)" opacity={0.6} />
              <text x={xs(b.x0) + 6} y={14} className="tick">
                {b.label}
              </text>
            </g>
          ))}
          {ys.ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={innerW} y1={ys(t)} y2={ys(t)} stroke="var(--grid)" />
              <text x={-8} y={ys(t)} dy="0.32em" textAnchor="end" className="tick">
                {ys.format(t)}
              </text>
            </g>
          ))}
          {xs.ticks.map((t) => (
            <text key={t} x={xs(t)} y={innerH + 16} textAnchor="middle" className="tick">
              {fx(t)}
            </text>
          ))}
          <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="var(--axis)" />
          {(props.markers ?? []).map((m) =>
            m.x >= xs.domain[0] && m.x <= xs.domain[1] ? (
              <g key={m.label + m.x}>
                <line x1={xs(m.x)} x2={xs(m.x)} y1={0} y2={innerH} stroke="var(--border-strong)" />
                <text x={xs(m.x) + 4} y={innerH - 6} className="tick">
                  {m.label}
                </text>
              </g>
            ) : null,
          )}
          {(props.references ?? []).map((r) => (
            <g key={r.label}>
              <line x1={0} x2={innerW} y1={ys(r.y)} y2={ys(r.y)} stroke="var(--status-critical)" strokeWidth={1} opacity={0.8} />
              <text x={innerW - 4} y={ys(r.y) - 5} textAnchor="end" className="tick" style={{ fill: 'var(--text-secondary)' }}>
                {r.label}
              </text>
            </g>
          ))}
          <g clipPath={`url(#${clipId})`}>{paths}</g>
          {series.map((s, i) =>
            s.mode === 'points'
              ? Array.from({ length: s.x.length }, (_, k) =>
                  Number.isFinite(s.y[k]) ? (
                    <circle key={`${s.id}${k}`} cx={xs(s.x[k])} cy={ys(s.y[k])} r={4} fill={color(s, i)} stroke="var(--surface-1)" strokeWidth={2} />
                  ) : null,
                )
              : null,
          )}
          {labelRoom > 0 &&
            spreadLabels(
              series.map((s, i) => {
                let k = s.x.length - 1;
                while (k > 0 && !Number.isFinite(s.y[k])) k--;
                return { s, i, y: k >= 0 && Number.isFinite(s.y[k]) ? ys(s.y[k]) : NaN };
              }),
              innerH,
            ).map(({ s, i, y }) => (
              <text key={s.id} x={innerW + 6} y={y} dy="0.32em" className="direct-label">
                <tspan fill={color(s, i)}>— </tspan>
                {s.label.length > 9 ? s.label.slice(0, 9) + '…' : s.label}
              </text>
            ))}
          <text x={innerW / 2} y={innerH + 30} textAnchor="middle" className="axis-label">
            {props.xLabel}
          </text>
          <text transform={`translate(${-40},${innerH / 2}) rotate(-90)`} textAnchor="middle" className="axis-label">
            {props.yLabel}
          </text>
          {hover && (
            <g>
              <line x1={hover.px} x2={hover.px} y1={0} y2={innerH} stroke="var(--text-muted)" strokeWidth={1} />
              {readout.map(({ s, i, y }) =>
                Number.isFinite(y) && !(yLog && y <= 0) ? (
                  <circle key={s.id} cx={hover.px} cy={ys(y)} r={4} fill={color(s, i)} stroke="var(--surface-1)" strokeWidth={2} />
                ) : null,
              )}
            </g>
          )}
        </g>
      </svg>
      {hover && (
        <div
          className="tooltip"
          style={{
            left: Math.min(width - 170, M.left + hover.px + 12),
            top: M.top + 8 + (series.length > 1 ? 22 : 0),
          }}
        >
          <div className="tt-head">
            {props.xLabel}: {fx(hover.x)}
          </div>
          {readout.map(({ s, i, y }) => (
            <div className="tt-row" key={s.id}>
              <i style={{ background: color(s, i) }} />
              <b>{fy(y)}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
