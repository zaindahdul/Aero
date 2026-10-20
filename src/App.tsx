import { useEffect, useMemo, useRef, useState } from 'react';
import type { EngineDesign, EngineInputs } from './core/design';
import { CYCLE_SHORT } from './core/cycle';
import { PRESETS } from './core/presets';
import { stoichiometricOF, PROPELLANTS } from './core/thermo/propellants';
import { EngineClient, SupersededError, type SweepPoint } from './ui/engineClient';
import { exportCSV, exportDXF, exportJSON, exportPNG, exportSTL } from './ui/exports';
import { bar, fmt, force, massFlow, mm, pct } from './ui/format';
import { Sidebar } from './ui/Sidebar';
import type { EngineViewer } from './ui/viewer/EngineViewer';
import { CycleView } from './ui/views/CycleView';
import { ModelView } from './ui/views/ModelView';
import { NozzleView } from './ui/views/NozzleView';
import { PerformanceView } from './ui/views/PerformanceView';
import { ReportView, StatusIcon } from './ui/views/ReportView';
import { StructuresView } from './ui/views/StructuresView';
import { ThermalView } from './ui/views/ThermalView';

const TABS = [
  { id: 'model', label: '3D Model' },
  { id: 'performance', label: 'Performance' },
  { id: 'nozzle', label: 'Nozzle Flow' },
  { id: 'thermal', label: 'Thermal' },
  { id: 'structures', label: 'Structures' },
  { id: 'cycle', label: 'Engine Cycle' },
  { id: 'report', label: 'Report & Export' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function App() {
  const client = useMemo(() => new EngineClient(), []);
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [inputs, setInputs] = useState<EngineInputs>(PRESETS[0].inputs);
  const [design, setDesign] = useState<EngineDesign | null>(null);
  const [sweep, setSweep] = useState<SweepPoint[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('model');
  const [menu, setMenu] = useState(false);
  const viewerRef = useRef<EngineViewer | null>(null);

  // Solve whenever the inputs change (debounced; stale requests are superseded).
  useEffect(() => {
    setBusy(true);
    const handle = setTimeout(() => {
      client
        .design(inputs)
        .then((d) => {
          setDesign(d);
          setError(null);
          setBusy(false);
        })
        .catch((e: Error) => {
          if (e instanceof SupersededError) return;
          setError(e.message);
          setBusy(false);
        });
    }, 160);
    return () => clearTimeout(handle);
  }, [inputs, client]);

  // Mixture-ratio sweep for the performance tab.
  useEffect(() => {
    if (!design) return;
    const i = design.inputs;
    const st = stoichiometricOF(PROPELLANTS[i.oxidizer], PROPELLANTS[i.fuel]);
    let alive = true;
    client
      .sweep({ oxidizer: i.oxidizer, fuel: i.fuel, pc: i.pc, eps: design.performance.eps, frozen: i.frozen, ofMin: Math.max(0.3, 0.3 * st), ofMax: 1.25 * st })
      .then((s) => alive && setSweep(s))
      .catch(() => alive && setSweep(null));
    return () => {
      alive = false;
    };
  }, [design, client]);

  const loadPreset = (id: string) => {
    setPresetId(id);
    setInputs(PRESETS.find((p) => p.id === id)!.inputs);
  };

  const snapshot = () => {
    if (!design || !viewerRef.current) return;
    viewerRef.current.setActive(true);
    exportPNG(viewerRef.current.snapshot(), design);
    viewerRef.current.setActive(tab === 'model');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" className="brand-mark" alt="" />
          LAVAL
          <small>Liquid rocket engine design suite</small>
        </div>
        <select className="select" style={{ width: 230 }} value={presetId} onChange={(e) => loadPreset(e.target.value)} aria-label="Preset">
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {!PRESETS.some((p) => p.inputs === inputs) && <option value={presetId}>Custom (modified)</option>}
        </select>
        <div className="spacer" />
        <span className="status-pill" role="status" aria-live="polite">
          <span className={`status-dot ${busy ? 'busy' : error ? 'error' : ''}`} />
          {busy ? 'Solving…' : error ? 'Input error' : design ? `Solved in ${fmt(design.timings.total, 0)} ms` : 'Starting'}
        </span>
        <div className="menu">
          <button className="btn primary" onClick={() => setMenu((m) => !m)} disabled={!design} aria-expanded={menu}>
            Export
          </button>
          {menu && design && (
            <div className="menu-list" onMouseLeave={() => setMenu(false)}>
              {(
                [
                  ['STL · full assembly', 'All bodies, mm, ready for slicing or CAD import', () => exportSTL(design, 'assembly')],
                  ['STL · liner with ribs', 'Copper hot wall and cooling ribs', () => exportSTL(design, 'liner')],
                  ['STL · closeout jacket', 'Jacket and manifolds', () => exportSTL(design, 'jacket')],
                  ['DXF · wall profile', 'Layered polylines for a revolve feature', () => exportDXF(design)],
                  ['CSV · gas-side contour', 'x, r in millimetres', () => exportCSV(design)],
                  ['JSON · design report', 'Every computed quantity', () => exportJSON(design)],
                  ['PNG · 3D render', 'Current viewport', snapshot],
                ] as [string, string, () => void][]
              ).map(([label, sub, fn]) => (
                <button
                  key={label}
                  onClick={() => {
                    fn();
                    setMenu(false);
                  }}
                >
                  {label}
                  <small>{sub}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <a className="ghost" href="https://github.com/zaindahdul/Aero" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
          Source
        </a>
      </header>

      <div className="body">
        <Sidebar
          inputs={inputs}
          onChange={(next) => {
            setInputs(next);
          }}
        />
        <main className="main">
          {design ? <Kpis design={design} /> : <div className="kpis" style={{ height: 66 }} />}
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div style={{ position: 'relative', minHeight: 0, display: 'grid' }}>
            {error && (
              <div className="notice" style={{ position: 'absolute', top: 10, right: 16, zIndex: 30, maxWidth: 460 }}>
                <StatusIcon level="critical" />
                <span>
                  <b>Could not solve this design.</b> {error} Showing the last valid result.
                </span>
              </div>
            )}
            {!design ? (
              <div className="empty">Solving chemistry, nozzle flow and cooling…</div>
            ) : (
              <>
                <div className="view full" hidden={tab !== 'model'} style={{ opacity: busy ? 0.75 : 1 }}>
                  <ModelView design={design} viewerRef={viewerRef} active={tab === 'model'} />
                </div>
                {tab !== 'model' && (
                  <div className={`view ${busy ? 'stale' : ''}`}>
                    {tab === 'performance' && <PerformanceView design={design} sweep={sweep} />}
                    {tab === 'nozzle' && <NozzleView design={design} />}
                    {tab === 'thermal' && <ThermalView design={design} />}
                    {tab === 'structures' && <StructuresView design={design} />}
                    {tab === 'cycle' && <CycleView design={design} inputs={inputs} onChange={setInputs} />}
                    {tab === 'report' && <ReportView design={design} onSnapshot={snapshot} />}
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function Kpis({ design }: { design: EngineDesign }) {
  const p = design.performance;
  const t = design.thermal;
  const sl = design.inputs.thrustAmbient > 0;
  const F = force(sl ? p.thrustSeaLevel : p.thrustVac);
  const md = massFlow(p.massFlow);
  const hot = t.maxTemperatureRatio >= 1;
  return (
    <div className="kpis">
      <Kpi label={`Thrust · ${sl ? 'sea level' : 'vacuum'}`} value={F.value} unit={F.unit} sub={sl ? `vac ${force(p.thrustVac).value} ${force(p.thrustVac).unit}` : `Pc ${bar(design.inputs.pc)} bar`} />
      <Kpi label="Isp · vacuum" value={fmt(p.ispVac, 1)} unit="s" sub={`ideal ${fmt(p.ispVacIdeal, 1)} s`} />
      <Kpi label="Isp · sea level" value={p.thrustSeaLevel > 0 ? fmt(p.ispSeaLevel, 1) : 'n/a'} unit={p.thrustSeaLevel > 0 ? 's' : ''} sub={p.separatedAtSeaLevel ? 'separated at SL' : `ε ${fmt(p.eps, 1)}`} />
      <Kpi label="Chamber temp." value={fmt(design.thermo.chamber.T, 0)} unit="K" sub={`c* ${fmt(p.cstar, 0)} m/s`} />
      <Kpi label="Mass flow" value={md.value} unit={md.unit} sub={`O/F ${fmt(design.inputs.of, 2)} · Dt ${mm(design.geometry.throatDiameter, 0)} mm`} />
      <Kpi label="Nozzle efficiency" value={pct(p.nozzleEfficiency, 2)} unit="%" sub={design.nozzleFlow.optimized ? 'TOP bell, optimized' : design.inputs.nozzle.kind} />
      <Kpi
        label="Peak wall temp."
        value={fmt(t.maxWallTemperature, 0)}
        unit="K"
        sub={
          <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            <StatusIcon level={hot ? 'critical' : t.maxTemperatureRatio > 0.92 ? 'warning' : 'good'} />
            {fmt(t.maxTemperatureRatio * 100, 0)} % of limit
          </span>
        }
      />
      <Kpi
        label="Engine cycle"
        value={design.cycle ? (design.cycle.closes ? 'Closes' : 'Open') : '–'}
        unit=""
        sub={
          design.cycle ? (
            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
              <StatusIcon level={design.cycle.closes ? 'good' : 'critical'} />
              {CYCLE_SHORT[design.cycle.kind]}
            </span>
          ) : undefined
        }
      />
      <Kpi label={design.coolant ? 'Coolant Δp' : 'Cooling'} value={design.coolant ? bar(t.pressureDrop) : 'Radiative'} unit={design.coolant ? 'bar' : ''} sub={design.coolant ? `${fmt(t.outletTemperature, 0)} K outlet` : `${fmt(t.maxHeatFlux / 1e6, 2)} MW/m² peak`} />
    </div>
  );
}

function Kpi({ label, value, unit, sub }: { label: string; value: string; unit: string; sub?: React.ReactNode }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
