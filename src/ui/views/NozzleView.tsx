import { useEffect, useMemo, useRef, useState } from 'react';
import type { EngineDesign } from '../../core/design';
import { ChartCard } from '../charts/ChartCard';
import { LineChart } from '../charts/LineChart';
import { SEQ_STOPS, cssGradient } from '../colormaps';
import { fmt, mm, pct } from '../format';
import { useElementWidth } from '../hooks';
import { flowTriangles, rasterizeField } from './flowField';

function FlowCanvas({ design, showNet }: { design: EngineDesign; showNet: boolean }) {
  const [box, width] = useElementWidth<HTMLDivElement>(900);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ px: number; py: number; x: number; r: number; M: number } | null>(null);
  const field = useMemo(() => flowTriangles(design), [design]);
  const g = design.geometry;
  const x0 = g.contour.xInjector;
  const x1 = g.contour.xExit;
  const rMax = g.exitDiameter / 2 > g.chamberDiameter / 2 ? g.exitDiameter / 2 : g.chamberDiameter / 2;
  const pad = 26;
  const scale = (width - 2 * pad) / (x1 - x0);
  const height = Math.min(520, Math.max(220, 2 * rMax * 1.12 * scale + 2 * pad));
  const s = Math.min(scale, (height - 2 * pad) / (2 * rMax * 1.12));
  const offsetX = (width - (x1 - x0) * s) / 2;
  const cx = (x: number) => offsetX + (x - x0) * s;
  const cy = (r: number) => height / 2 - r * s;

  useEffect(() => {
    const c = canvas.current!;
    const dpr = Math.min(window.devicePixelRatio, 2);
    c.width = width * dpr;
    c.height = height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(rasterizeField(field.tris, field.mMax, c.width, c.height, (x) => cx(x) * dpr, (r) => cy(r) * dpr), 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Clip the characteristic net to the gas region.
    const w = g.wall;
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < w.x.length; i++) ctx[i ? 'lineTo' : 'moveTo'](cx(w.x[i]), cy(w.r[i]));
    for (let i = w.x.length - 1; i >= 0; i--) ctx.lineTo(cx(w.x[i]), cy(-w.r[i]));
    ctx.closePath();
    ctx.clip();
    // Characteristic net in the upper half.
    if (showNet) {
      const moc = design.nozzleFlow.moc;
      const rt = g.throatDiameter / 2;
      const n = moc.x.length;
      const stride = Math.max(1, Math.ceil(n / 30000));
      const xLim = g.contour.xExit / rt;
      const segMax = 0.6 * rt * xLim;
      for (const [parents, color] of [
        [moc.parentPlus, 'rgba(240,239,236,0.2)'],
        [moc.parentMinus, 'rgba(217,139,74,0.38)'],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        for (let i = 0; i < n; i += stride) {
          const p = parents[i];
          if (p < 0 || !(moc.x[i] <= xLim) || moc.r[i] < 0) continue;
          const xa = moc.x[p] * rt;
          const ra = moc.r[p] * rt;
          const xb = moc.x[i] * rt;
          const rb = moc.r[i] * rt;
          if (Math.hypot(xb - xa, rb - ra) > segMax) continue;
          ctx.moveTo(cx(xa), cy(ra));
          ctx.lineTo(cx(xb), cy(rb));
        }
        ctx.stroke();
      }
    }
    ctx.restore();
    // Gas-side wall and injector face.
    ctx.strokeStyle = '#c3c2b7';
    ctx.lineWidth = 1.5;
    for (const sgn of [1, -1]) {
      ctx.beginPath();
      for (let i = 0; i < w.x.length; i++) ctx[i ? 'lineTo' : 'moveTo'](cx(w.x[i]), cy(sgn * w.r[i]));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx(w.x[0]), cy(w.r[0]));
    ctx.lineTo(cx(w.x[0]), cy(-w.r[0]));
    ctx.stroke();
    // Axis.
    ctx.strokeStyle = 'rgba(195,194,183,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx(x0), cy(0));
    ctx.lineTo(cx(x1), cy(0));
    ctx.stroke();
    // Markers: throat, Euler hand-over plane, internal shock.
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = '#c3c2b7';
    const mark = (x: number, label: string, top: boolean) => {
      ctx.strokeStyle = 'rgba(195,194,183,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx(x), cy(rMax * 1.08));
      ctx.lineTo(cx(x), cy(-rMax * 1.08));
      ctx.stroke();
      ctx.textAlign = top ? 'left' : 'right';
      ctx.fillText(label, cx(x) + (top ? 4 : -4), top ? cy(rMax * 1.02) : cy(-rMax * 1.02));
      ctx.textAlign = 'left';
    };
    mark(0, 'throat', false);
    const rt = g.throatDiameter / 2;
    if (Number.isFinite(design.nozzleFlow.xStart)) mark(design.nozzleFlow.xStart * rt, 'MoC → Euler hand-over', true);
    const sh = design.nozzleFlow.shock;
    if (sh && sh.x * rt < x1) {
      ctx.fillStyle = '#ec835a';
      ctx.beginPath();
      ctx.arc(cx(sh.x * rt), cy(sh.r * rt), 4.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = '#f0efec';
      ctx.fillText('internal shock forms', cx(sh.x * rt) + 8, cy(sh.r * rt) - 6);
    }
  }, [design, field, width, height, showNet]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (e: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const x = x0 + (px - offsetX) / s;
    const r = Math.abs((height / 2 - py) / s);
    const t = field.tris;
    let best = Infinity;
    let M = NaN;
    for (let k = 0; k < t.length; k += 3) {
      const d = (t[k] - x) ** 2 + (t[k + 1] - r) ** 2;
      if (d < best) {
        best = d;
        M = t[k + 2];
      }
    }
    if (Math.sqrt(best) * s > 14) return setHover(null);
    setHover({ px, py, x, r, M });
  };

  return (
    <div ref={box} className="chart" style={{ position: 'relative' }}>
      <canvas ref={canvas} style={{ width, height, display: 'block' }} onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      {hover && (
        <div className="tooltip" style={{ left: Math.min(width - 170, hover.px + 12), top: hover.py + 12 }}>
          <div className="tt-head">
            x {mm(hover.x)} mm · r {mm(hover.r)} mm
          </div>
          <div className="tt-row">
            <b>M {fmt(hover.M, 3)}</b>
          </div>
        </div>
      )}
      <div className="legend" style={{ marginTop: 8, alignItems: 'center' }}>
        <span>
          Mach 0
          <i style={{ width: 160, height: 8, background: cssGradient(SEQ_STOPS) }} />
          {fmt(field.mMax, 2)}
        </span>
        {showNet && (
          <>
            <span>
              <i style={{ background: 'rgba(240,239,236,0.7)' }} />
              C+ characteristics
            </span>
            <span>
              <i style={{ background: 'rgba(217,139,74,0.9)' }} />
              C− characteristics
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function NozzleView({ design }: { design: EngineDesign }) {
  const [showNet, setShowNet] = useState(true);
  const nf = design.nozzleFlow;
  const p = design.performance;
  const rt = design.geometry.throatDiameter / 2;
  const xMm = (x: number) => x * 1e3;
  const st = design.stations.filter((s) => s.x > 0);
  const wallSeries = [
    { id: 'moc', label: 'MoC (isentropic)', x: nf.moc.wallX.map((x) => xMm(x * rt)), y: nf.moc.wallP },
    ...(nf.euler ? [{ id: 'eu', label: 'Euler (shock-capturing)', x: nf.euler.wallX.map((x) => xMm(x * rt)), y: nf.euler.wallP }] : []),
    { id: '1d', label: 'Quasi-1-D', x: st.map((s) => xMm(s.x)), y: st.map((s) => s.P / design.inputs.pc) },
  ];
  const opt = nf.optimized;
  let best = 0;
  const bestSoFar = opt ? opt.history.map((h) => (best = Math.max(best, h.efficiency))) : [];
  const rwExit = nf.euler ? nf.euler.rw[nf.euler.rw.length - 1] : 1;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <ChartCard
        title="Supersonic flow field"
        caption="Upper half: characteristic net from the method of characteristics. Field: quasi-1-D chamber, MoC through the throat region, axisymmetric Euler space-march downstream."
        actions={
          <button className="ghost" aria-pressed={showNet} onClick={() => setShowNet((v) => !v)}>
            Net
          </button>
        }
      >
        <FlowCanvas design={design} showNet={showNet} />
      </ChartCard>
      <div className="grid-2">
        <ChartCard
          title="Wall pressure"
          caption="Static pressure over chamber pressure along the divergent wall"
          table={{ xLabel: 'x, mm', series: wallSeries, format: (v) => v.toExponential(3) }}
        >
          <LineChart xLabel="Axial position, mm" yLabel="p / Pc" yLog series={wallSeries} yFormat={(v) => v.toExponential(2)} />
        </ChartCard>
        <ChartCard title="Solver summary" caption="Hybrid MoC / Euler nozzle analysis at the effective isentropic exponent">
          <table className="data">
            <tbody>
              <tr>
                <td>Effective γ (matches Pe/Pc at ε)</td>
                <td>{fmt(p.gammaEffective, 4)}</td>
              </tr>
              <tr>
                <td>Isp efficiency · Euler (used)</td>
                <td>{pct(p.nozzleEfficiency, 3)} %</td>
              </tr>
              <tr>
                <td>Isp efficiency · MoC (isentropic)</td>
                <td>{pct(p.nozzleEfficiencyMoc, 3)} %</td>
              </tr>
              <tr>
                <td>Discharge coefficient (Kliegel–Levine)</td>
                <td>{fmt(p.dischargeCoefficient, 4)}</td>
              </tr>
              <tr>
                <td>Internal shock formation</td>
                <td>{nf.shock && nf.shock.x * rt < design.geometry.contour.xExit ? `x = ${mm(nf.shock.x * rt)} mm, r = ${mm(nf.shock.r * rt)} mm` : 'none in nozzle'}</td>
              </tr>
              <tr>
                <td>MoC net points</td>
                <td>{nf.moc.x.length.toLocaleString()}</td>
              </tr>
              <tr>
                <td>MoC exit momentum balance error</td>
                <td>{pct(nf.moc.balanceError, 3)} %</td>
              </tr>
              <tr>
                <td>Euler mass-flow drift</td>
                <td>{nf.euler ? nf.euler.massDrift.toExponential(1) : 'n/a'}</td>
              </tr>
              {opt && (
                <tr>
                  <td>Optimized parabola θn · θe</td>
                  <td>
                    {fmt(opt.thetaN, 2)}° · {fmt(opt.thetaE, 2)}°
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ChartCard>
        {nf.euler && (
          <ChartCard
            title="Exit-plane Mach profile"
            caption="Euler solution across the exit plane vs the 1-D value"
            table={{ xLabel: 'r / Re', series: [{ id: 'e', label: 'Mach', x: nf.euler.exitR.map((r) => r / rwExit), y: nf.euler.exitMach }] }}
          >
            <LineChart
              xLabel="r / Re"
              yLabel="Mach number"
              series={[
                { id: 'e', label: 'Euler', x: nf.euler.exitR.map((r) => r / rwExit), y: nf.euler.exitMach },
                { id: '1', label: 'Quasi-1-D', x: [0, 1], y: [p.exitMach, p.exitMach] },
              ]}
              yFormat={(v) => v.toFixed(3)}
            />
          </ChartCard>
        )}
        {opt && (
          <ChartCard
            title="Contour optimization"
            caption="Nelder–Mead on the parabola angles; each evaluation is a full MoC + Euler solution"
            table={{ xLabel: 'Evaluation', series: [{ id: 'e', label: 'Efficiency, %', x: opt.history.map((_, i) => i + 1), y: opt.history.map((h) => h.efficiency * 100) }] }}
          >
            <LineChart
              xLabel="Evaluation"
              yLabel="Isp efficiency, %"
              series={[
                { id: 'e', label: 'Candidate', x: opt.history.map((_, i) => i + 1), y: opt.history.map((h) => (h.efficiency > 0 ? h.efficiency * 100 : NaN)), mode: 'points' },
                { id: 'b', label: 'Best so far', x: opt.history.map((_, i) => i + 1), y: bestSoFar.map((b) => b * 100), mode: 'step' },
              ]}
              yMin={Math.min(...opt.history.filter((h) => h.efficiency > 0).map((h) => h.efficiency * 100)) - 0.05}
              yFormat={(v) => `${v.toFixed(3)} %`}
            />
          </ChartCard>
        )}
      </div>
    </div>
  );
}
