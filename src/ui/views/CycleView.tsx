import { CYCLE_LABELS, type CycleInputs, type CycleKind } from '../../core/cycle';
import type { EngineDesign, EngineInputs } from '../../core/design';
import { BarChart } from '../charts/BarChart';
import { ChartCard } from '../charts/ChartCard';
import { NumField, SelectField } from '../fields';
import { bar, fmt } from '../format';
import { StatusIcon } from './ReportView';
import { Stat } from './ThermalView';

const MW = (w: number) => (w >= 1e6 ? `${fmt(w / 1e6, 2)} MW` : `${fmt(w / 1e3, 1)} kW`);

export function CycleView({ design, inputs, onChange }: { design: EngineDesign; inputs: EngineInputs; onChange: (next: EngineInputs) => void }) {
  const c = design.cycle;
  const ci = inputs.cycle;
  const set = (patch: Partial<CycleInputs>) => onChange({ ...inputs, cycle: { ...ci, ...patch } });
  const pumped = c && c.kind !== 'pressure-fed';
  const pumpTotal = c ? c.pumps.reduce((s, p) => s + p.power, 0) : 0;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="grid-2">
        <ChartCard title="Cycle definition" caption="Turbomachinery assumptions; the thrust chamber design is shared with every other tab">
          <div style={{ display: 'grid', gap: 10 }}>
            <SelectField<CycleKind>
              label="Power cycle"
              value={ci.kind}
              options={(Object.keys(CYCLE_LABELS) as CycleKind[]).map((k) => ({ value: k, label: CYCLE_LABELS[k] }))}
              onChange={(kind) => set({ kind })}
            />
            <NumField label="Pump inlet (tank) pressure" value={ci.tankPressure} onChange={(v) => set({ tankPressure: v })} unit="bar" scale={1e5} min={1} max={80} digits={1} />
            <NumField label="Feed line and valve losses" hint="% of Pc" value={ci.lineLoss} onChange={(v) => set({ lineLoss: v })} unit="%" scale={0.01} min={0} max={30} digits={1} />
            {ci.kind !== 'pressure-fed' && (
              <>
                <NumField label="Pump efficiency" value={ci.pumpEfficiency} onChange={(v) => set({ pumpEfficiency: v })} min={0.3} max={0.95} digits={2} />
                <NumField label="Turbine efficiency" value={ci.turbineEfficiency} onChange={(v) => set({ turbineEfficiency: v })} min={0.3} max={0.95} digits={2} />
              </>
            )}
            {(ci.kind === 'gas-generator' || ci.kind === 'staged-combustion' || ci.kind === 'full-flow') && (
              <NumField label="Turbine inlet temperature" hint="sets GG / preburner mixture ratio" value={ci.turbineInletTemperature} onChange={(v) => set({ turbineInletTemperature: v })} unit="K" min={500} max={1400} slider step={10} />
            )}
            {ci.kind === 'gas-generator' && <NumField label="GG turbine pressure ratio" value={ci.ggPressureRatio} onChange={(v) => set({ ggPressureRatio: v })} min={2} max={60} digits={1} />}
          </div>
        </ChartCard>
        {c && (
          <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
            <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
              <div className="card">
                <div className="caption" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11 }}>
                  Power balance
                </div>
                <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <StatusIcon level={c.closes ? 'good' : 'critical'} />
                  {c.closes ? 'Closes' : 'Does not close'}
                </div>
                <div className="caption">{c.kind === 'expander' ? `${fmt(c.powerMargin * 100, 0)} % turbine power margin` : CYCLE_LABELS[c.kind]}</div>
              </div>
              <Stat label="Engine Isp · vacuum" value={`${fmt(c.ispVac, 1)} s`} sub={c.ispVac < design.performance.ispVac - 0.05 ? `chamber ${fmt(design.performance.ispVac, 1)} s before cycle losses` : 'no cycle loss'} />
              {pumped && <Stat label="Pump power" value={MW(pumpTotal)} sub={`${c.pumps.length} pumps · ${c.turbines.length} turbine${c.turbines.length === 1 ? '' : 's'}`} />}
            </div>
            <ChartCard title="Engineering notes">
              <div style={{ display: 'grid', gap: 8 }}>
                {c.notes.map((n) => (
                  <div className="notice" key={n}>
                    <StatusIcon level={/cannot|not close|raise|heavy|no pressure ratio/.test(n) ? 'warning' : 'good'} />
                    <span>{n}</span>
                  </div>
                ))}
              </div>
            </ChartCard>
          </div>
        )}
      </div>

      {c && (
        <div className="grid-2">
          <ChartCard title="Pressure ladder" caption="From the highest pump discharge down to the chamber">
            <BarChart
              categories={c.pressureBudget.map((b) => b.label)}
              series={[{ id: 'p', label: 'Pressure', values: c.pressureBudget.map((b) => b.pressure / 1e5) }]}
              format={(v) => `${v.toFixed(0)} bar`}
              axisLabel="pressure, bar"
            />
          </ChartCard>
          {pumped && (
            <ChartCard title="Shaft power" caption="Each pump and the turbine that drives it">
              <BarChart
                categories={[...c.pumps.map((p) => `Pump · ${p.propellant.replace('Liquid ', '')}`), ...c.turbines.map((t) => t.label)]}
                series={[{ id: 'w', label: 'Power', values: [...c.pumps.map((p) => p.power / 1e6), ...c.turbines.map((t) => t.power / 1e6)] }]}
                format={(v) => (v >= 1 ? `${v.toFixed(2)} MW` : `${(v * 1e3).toFixed(0)} kW`)}
                axisLabel="power, MW"
              />
            </ChartCard>
          )}
          {pumped && (
            <ChartCard title="Turbomachinery">
              <table className="data">
                <thead>
                  <tr>
                    <th>Pump</th>
                    <th>Flow, kg/s</th>
                    <th>Discharge, bar</th>
                    <th>Power</th>
                  </tr>
                </thead>
                <tbody>
                  {c.pumps.map((p) => (
                    <tr key={p.propellant}>
                      <td>{p.propellant}</td>
                      <td>{fmt(p.massFlow, 2)}</td>
                      <td>{bar(p.dischargePressure)}</td>
                      <td>{MW(p.power)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {c.turbines.length > 0 && (
                <table className="data" style={{ marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th>Turbine</th>
                      <th>Flow, kg/s</th>
                      <th>Inlet, K</th>
                      <th>p in → out, bar</th>
                      <th>PR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.turbines.map((t) => (
                      <tr key={t.label}>
                        <td title={t.gas}>{t.label}</td>
                        <td>{fmt(t.massFlow, 2)}</td>
                        <td>{fmt(t.inletTemperature, 0)}</td>
                        <td>
                          {bar(t.inletPressure)} → {bar(t.outletPressure)}
                        </td>
                        <td>{fmt(t.pressureRatio, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ChartCard>
          )}
          {c.combustors.length > 0 && (
            <ChartCard title="Gas generator and preburners" caption="Mixture ratio solved with the equilibrium solver to hold the turbine-inlet temperature">
              <table className="data">
                <thead>
                  <tr>
                    <th>Combustor</th>
                    <th>O/F</th>
                    <th>Temperature, K</th>
                    <th>Pressure, bar</th>
                    <th>Flow, kg/s</th>
                  </tr>
                </thead>
                <tbody>
                  {c.combustors.map((b) => (
                    <tr key={b.label}>
                      <td>{b.label}</td>
                      <td>{fmt(b.mixtureRatio, 2)}</td>
                      <td>{fmt(b.temperature, 0)}</td>
                      <td>{bar(b.pressure)}</td>
                      <td>{fmt(b.massFlow, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ChartCard>
          )}
        </div>
      )}
    </div>
  );
}
