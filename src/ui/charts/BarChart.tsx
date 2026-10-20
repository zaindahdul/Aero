import { useState } from 'react';
import { SERIES_COLORS, linearScale } from './scale';
import { useElementWidth } from '../hooks';

interface Props {
  categories: string[];
  series: { id: string; label: string; values: number[] }[];
  format: (v: number) => string;
  axisLabel: string;
}

/** Grouped horizontal bars; each bar is its own hover target. */
export function BarChart({ categories, series, format, axisLabel }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ c: number; s: number; x: number; y: number } | null>(null);
  const left = Math.max(56, Math.min(170, 14 + 6.3 * Math.max(...categories.map((c) => c.length))));
  const right = 52;
  const bar = 9;
  const gap = 2;
  const group = series.length * (bar + gap) + 10;
  const height = categories.length * group + 26;
  let max = 0;
  for (const s of series) for (const v of s.values) max = Math.max(max, v);
  const xs = linearScale(0, max, 0, Math.max(40, width - left - right), 4);
  return (
    <div className="chart" ref={ref}>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s, i) => (
            <span key={s.id}>
              <i className="rect" style={{ background: SERIES_COLORS[i] }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg width={width} height={height} onPointerLeave={() => setHover(null)}>
        <g transform={`translate(${left},4)`}>
          {xs.ticks.map((t) => (
            <g key={t}>
              <line x1={xs(t)} x2={xs(t)} y1={0} y2={height - 26} stroke="var(--grid)" />
              <text x={xs(t)} y={height - 12} textAnchor="middle" className="tick">
                {xs.format(t)}
              </text>
            </g>
          ))}
          {categories.map((c, ci) => (
            <g key={c} transform={`translate(0,${ci * group})`}>
              <text x={-8} y={(series.length * (bar + gap)) / 2} dy="0.32em" textAnchor="end" className="tick" style={{ fill: 'var(--text-secondary)' }}>
                {c}
              </text>
              {series.map((s, si) => {
                const v = s.values[ci] ?? 0;
                const w = Math.max(1, xs(v));
                const y = si * (bar + gap);
                return (
                  <g key={s.id}>
                    <rect x={0} y={y - 1} width={Math.max(w, 24) + 40} height={bar + 2} fill="transparent" onPointerMove={() => setHover({ c: ci, s: si, x: left + w, y: ci * group + y })} />
                    <rect
                      x={0}
                      y={y}
                      width={w}
                      height={bar}
                      rx={2}
                      fill={SERIES_COLORS[si]}
                      opacity={hover && (hover.c !== ci || hover.s !== si) ? 0.55 : 1}
                      pointerEvents="none"
                    />
                    {series.length === 1 && (
                      <text x={w + 6} y={y + bar / 2} dy="0.32em" className="tick">
                        {format(v)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          ))}
          <text x={(width - left - right) / 2} y={height - 0} textAnchor="middle" className="axis-label">
            {axisLabel}
          </text>
        </g>
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: Math.min(width - 160, hover.x + 10), top: hover.y + (series.length > 1 ? 18 : 0) }}>
          <div className="tt-head">{categories[hover.c]}</div>
          <div className="tt-row">
            <i style={{ background: SERIES_COLORS[hover.s] }} />
            <b>{format(series[hover.s].values[hover.c])}</b>
            <span>{series[hover.s].label}</span>
          </div>
        </div>
      )}
    </div>
  );
}
