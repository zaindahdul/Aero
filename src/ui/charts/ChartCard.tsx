import { type ReactNode, useState } from 'react';
import { formatNumber } from './scale';
import type { Series } from './LineChart';

interface Props {
  title: string;
  caption?: string;
  /** Series shown in the table view (sampled on the first series' x). */
  table?: { xLabel: string; series: Series[]; format?: (v: number) => string; xFormat?: (v: number) => string };
  actions?: ReactNode;
  children: ReactNode;
}

/** Card with a title, caption and an optional chart/table toggle. */
export function ChartCard({ title, caption, table, actions, children }: Props) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {caption && <p className="caption">{caption}</p>}
        </div>
        <div className="card-actions">
          {actions}
          {table && (
            <button className="ghost" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
              {showTable ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </div>
      {showTable && table ? <SeriesTable {...table} /> : children}
    </section>
  );
}

function SeriesTable({ xLabel, series, format, xFormat }: NonNullable<Props['table']>) {
  const base = series[0];
  if (!base) return null;
  const n = base.x.length;
  const stride = Math.max(1, Math.ceil(n / 60));
  const fy = format ?? ((v: number) => formatNumber(v));
  const fx = xFormat ?? ((v: number) => formatNumber(v));
  const rows: number[] = [];
  for (let i = 0; i < n; i += stride) rows.push(i);
  if (rows[rows.length - 1] !== n - 1) rows.push(n - 1);
  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            <th>{xLabel}</th>
            {series.map((s) => (
              <th key={s.id}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i}>
              <td>{fx(base.x[i])}</td>
              {series.map((s) => (
                <td key={s.id}>{fy(s.y[Math.min(i, s.y.length - 1)])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
