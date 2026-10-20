import type { EngineDesign } from '../../core/design';
import { BarChart } from '../charts/BarChart';
import { ChartCard } from '../charts/ChartCard';
import { type Series, LineChart } from '../charts/LineChart';
import { fmt } from '../format';
import { Stat, axialMarkers } from './ThermalView';

export function StructuresView({ design }: { design: EngineDesign }) {
  const t = design.thermal;
  const st = t.stations;
  const x = st.map((s) => s.x * 1e3);
  const markers = axialMarkers(design);
  const regen = design.coolant !== null;
  const S = (id: string, label: string, y: number[]): Series => ({ id, label, x, y });
  const cooled = (f: (s: (typeof st)[number]) => number) => st.map((s) => (s.cooled ? f(s) : NaN));
  const cap = (v: number) => Math.min(v, 12);
  const sf = [S('l', regen ? 'Liner (channel-span bending)' : 'Wall (hoop)', st.map((s) => cap(s.liningSF))), ...(regen ? [S('j', 'Jacket (hoop)', cooled((s) => cap(s.jacketSF)))] : [])];
  const stress = regen
    ? [S('b', 'Liner bending', cooled((s) => s.sigmaBending / 1e6)), S('t', 'Liner thermal', cooled((s) => s.sigmaThermal / 1e6)), S('j', 'Jacket hoop', cooled((s) => s.sigmaJacket / 1e6))]
    : [S('h', 'Wall hoop', st.map((s) => s.sigmaBending / 1e6))];
  const m = design.mass;
  const massItems = [
    ['Liner + ribs', m.liner],
    ['Closeout jacket', m.jacket],
    ['Radiative extension', m.extension],
    ['Injector (estimate)', m.injector],
  ].filter(([, v]) => (v as number) > 0) as [string, number][];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="grid-3">
        <Stat label="Minimum wall safety factor" value={fmt(t.minLiningSF, 2)} sub={regen ? 'liner bending over the channel span vs yield at temperature' : 'hoop stress vs yield at temperature'} />
        {regen && <Stat label="Minimum jacket safety factor" value={fmt(t.minJacketSF, 2)} sub={`target ${design.inputs.cooling.jacketSafetyFactor} · thickness auto-sized`} />}
        <Stat label="Chamber assembly mass" value={`${fmt(m.total, m.total < 10 ? 2 : 0)} kg`} sub={`thrust-to-weight (chamber only) ${fmt(design.performance.thrustVac / (m.total * 9.80665), 0)}`} />
      </div>
      <div className="grid-2">
        <ChartCard title="Safety factors" caption="Against yield at the local metal temperature (display capped at 12)" table={{ xLabel: 'x, mm', series: sf }}>
          <LineChart xLabel="Axial position, mm" yLabel="Safety factor" series={sf} references={[{ y: 1, label: 'yield' }]} markers={markers} yFormat={(v) => v.toFixed(2)} yMin={0} />
        </ChartCard>
        <ChartCard title="Stresses" caption="Pressure bending, through-wall thermal stress (fully constrained), closeout hoop" table={{ xLabel: 'x, mm', series: stress }}>
          <LineChart xLabel="Axial position, mm" yLabel="Stress, MPa" series={stress} markers={markers} yFormat={(v) => `${v.toFixed(0)} MPa`} yMin={0} />
        </ChartCard>
        {regen && (
          <ChartCard
            title="Thermal strain ratio"
            caption="Through-wall thermal stress over yield; above 1 the hot wall yields every firing (low-cycle fatigue driver)"
            table={{ xLabel: 'x, mm', series: [S('r', 'ratio', cooled((s) => s.thermalStrainRatio))] }}
          >
            <LineChart xLabel="Axial position, mm" yLabel="σ_thermal / σ_yield" series={[S('r', 'Thermal strain ratio', cooled((s) => s.thermalStrainRatio))]} references={[{ y: 1, label: 'yield' }]} markers={markers} yFormat={(v) => v.toFixed(2)} yMin={0} />
          </ChartCard>
        )}
        {regen && (
          <ChartCard
            title="Wall build-up"
            caption="Liner and closeout thicknesses after auto-sizing"
            table={{ xLabel: 'x, mm', series: [S('l', 'liner, mm', cooled((s) => s.linerThickness * 1e3)), S('j', 'jacket, mm', cooled((s) => s.jacketThickness * 1e3))] }}
          >
            <LineChart
              xLabel="Axial position, mm"
              yLabel="Thickness, mm"
              series={[S('l', 'Liner', cooled((s) => s.linerThickness * 1e3)), S('j', 'Jacket', cooled((s) => s.jacketThickness * 1e3))]}
              markers={markers}
              yFormat={(v) => `${v.toFixed(2)} mm`}
              yMin={0}
            />
          </ChartCard>
        )}
        <ChartCard title="Mass breakdown" caption="From the solid geometry and material densities">
          <BarChart categories={massItems.map(([k]) => k)} series={[{ id: 'm', label: 'Mass', values: massItems.map(([, v]) => v) }]} format={(v) => `${v < 10 ? v.toFixed(2) : v.toFixed(0)} kg`} axisLabel="mass, kg" />
        </ChartCard>
      </div>
    </div>
  );
}
