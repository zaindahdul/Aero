import type { EngineDesign } from '../../core/design';
import { MATERIALS } from '../../core/thermal/materials';
import { ChartCard } from '../charts/ChartCard';
import { type Series, LineChart } from '../charts/LineChart';
import { bar, fmt, mm } from '../format';

export function axialMarkers(design: EngineDesign) {
  const t = design.thermal;
  const m = [{ x: 0, label: 'throat' }];
  if (design.coolant && t.regenEndX < design.geometry.contour.xExit - 1e-6) m.push({ x: t.regenEndX * 1e3, label: 'regen end' });
  return m;
}

export function ThermalView({ design }: { design: EngineDesign }) {
  const t = design.thermal;
  const st = t.stations;
  const x = st.map((s) => s.x * 1e3);
  const markers = axialMarkers(design);
  const regen = design.coolant !== null;
  const liner = MATERIALS[design.inputs.cooling.linerMaterial];
  const ext = MATERIALS[design.inputs.cooling.radiativeMaterial];
  const S = (id: string, label: string, y: number[], mode?: Series['mode']): Series => ({ id, label, x, y, mode });
  const cooled = (f: (s: (typeof st)[number]) => number) => st.map((s) => (s.cooled ? f(s) : NaN));

  const temps = [
    S('twg', 'Hot wall', st.map((s) => s.Twg)),
    ...(regen ? [S('twc', 'Coolant-side wall', cooled((s) => s.Twc)), S('tc', 'Coolant bulk', cooled((s) => s.Tcool))] : []),
  ];
  const refs = [{ y: regen ? liner.maxTemperature : ext.maxTemperature, label: `${regen ? liner.name.split(' (')[0] : ext.name.split(' (')[0]} limit` }];
  if (regen && t.regenEndX < design.geometry.contour.xExit - 1e-6) refs.push({ y: ext.maxTemperature, label: `${ext.name.split(' (')[0]} limit` });

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="grid-3">
        <Stat label="Peak hot-wall temperature" value={`${fmt(t.maxWallTemperature, 0)} K`} sub={`at x = ${mm(t.maxWallTemperatureX, 0)} mm · ${fmt(t.maxTemperatureRatio * 100, 0)} % of limit`} />
        <Stat label="Peak heat flux" value={`${fmt(t.maxHeatFlux / 1e6, 1)} MW/m²`} sub={`total heat load ${fmt(t.heatLoad / 1e6, 2)} MW`} />
        {regen ? (
          <Stat
            label="Coolant"
            value={`${fmt(design.inputs.cooling.inletTemperature, 0)} → ${fmt(t.outletTemperature, 0)} K`}
            sub={`Δp ${bar(t.pressureDrop)} bar · peak ${fmt(t.maxCoolantVelocity, 0)} m/s · ${t.bifurcations.length} bifurcations`}
          />
        ) : (
          <Stat label="Cooling" value="Radiation" sub={`${ext.name} · ε = ${design.inputs.cooling.wallEmissivity}`} />
        )}
      </div>
      <div className="grid-2">
        <ChartCard title="Wall and coolant temperatures" caption="Bartz gas-side film, conduction through the liner, finned coolant channels" table={{ xLabel: 'x, mm', series: temps }}>
          <LineChart xLabel="Axial position, mm" yLabel="Temperature, K" series={temps} references={refs} markers={markers} yFormat={(v) => `${v.toFixed(0)} K`} yMin={0} />
        </ChartCard>
        <ChartCard title="Heat flux" caption="Convective plus chamber gas radiation into the wall" table={{ xLabel: 'x, mm', series: [S('q', 'q, MW/m²', st.map((s) => s.q / 1e6))] }}>
          <LineChart xLabel="Axial position, mm" yLabel="Heat flux, MW/m²" series={[S('q', 'Heat flux', st.map((s) => s.q / 1e6))]} markers={markers} yFormat={(v) => `${v.toFixed(2)} MW/m²`} yMin={0} />
        </ChartCard>
        <ChartCard
          title="Heat-transfer coefficients"
          caption="Gas side (Bartz, σ-corrected) and coolant side (before fin enhancement)"
          table={{ xLabel: 'x, mm', series: [S('hg', 'h gas, kW/m²K', st.map((s) => s.hg / 1e3)), S('hc', 'h coolant, kW/m²K', cooled((s) => s.hc / 1e3))] }}
        >
          <LineChart
            xLabel="Axial position, mm"
            yLabel="h, kW/(m²·K)"
            series={[S('hg', 'Gas side', st.map((s) => s.hg / 1e3)), ...(regen ? [S('hc', 'Coolant side', cooled((s) => s.hc / 1e3))] : [])]}
            markers={markers}
            yFormat={(v) => `${v.toFixed(1)} kW/m²K`}
            yMin={0}
          />
        </ChartCard>
        <ChartCard title="Adiabatic wall temperature" caption="Recovery temperature driving the gas-side heat flux (with barrier cooling if enabled)" table={{ xLabel: 'x, mm', series: [S('taw', 'Taw, K', st.map((s) => s.Taw))] }}>
          <LineChart xLabel="Axial position, mm" yLabel="Taw, K" series={[S('taw', 'Recovery temperature', st.map((s) => s.Taw))]} markers={markers} yFormat={(v) => `${v.toFixed(0)} K`} />
        </ChartCard>
        {regen && (
          <>
            <ChartCard title="Coolant pressure" caption="Colebrook friction with wall roughness plus flow acceleration" table={{ xLabel: 'x, mm', series: [S('p', 'p, bar', cooled((s) => s.Pcool / 1e5))] }}>
              <LineChart xLabel="Axial position, mm" yLabel="Pressure, bar" series={[S('p', 'Coolant pressure', cooled((s) => s.Pcool / 1e5))]} markers={markers} yFormat={(v) => `${v.toFixed(1)} bar`} />
            </ChartCard>
            <ChartCard title="Coolant velocity" caption="Bulk velocity in the channels" table={{ xLabel: 'x, mm', series: [S('v', 'v, m/s', cooled((s) => s.velocity))] }}>
              <LineChart xLabel="Axial position, mm" yLabel="Velocity, m/s" series={[S('v', 'Coolant velocity', cooled((s) => s.velocity))]} markers={markers} yFormat={(v) => `${v.toFixed(1)} m/s`} yMin={0} />
            </ChartCard>
            <ChartCard
              title="Channel geometry"
              caption="Width bifurcates at the maximum; liner auto-thickened for the bending safety factor"
              table={{
                xLabel: 'x, mm',
                series: [S('w', 'width, mm', cooled((s) => s.channelWidth * 1e3)), S('h', 'height, mm', cooled((s) => s.channelHeight * 1e3)), S('t', 'liner, mm', cooled((s) => s.linerThickness * 1e3))],
              }}
            >
              <LineChart
                xLabel="Axial position, mm"
                yLabel="Dimension, mm"
                series={[S('w', 'Channel width', cooled((s) => s.channelWidth * 1e3)), S('h', 'Channel height', cooled((s) => s.channelHeight * 1e3)), S('t', 'Liner wall', cooled((s) => s.linerThickness * 1e3))]}
                markers={markers}
                yFormat={(v) => `${v.toFixed(2)} mm`}
                yMin={0}
              />
            </ChartCard>
            <ChartCard title="Channel count" caption="Doubles at each bifurcation away from the throat" table={{ xLabel: 'x, mm', series: [S('n', 'channels', cooled((s) => s.channels))], format: (v) => v.toFixed(0) }}>
              <LineChart xLabel="Axial position, mm" yLabel="Channels" series={[S('n', 'Channel count', cooled((s) => s.channels), 'step')]} markers={markers} yFormat={(v) => v.toFixed(0)} yMin={0} />
            </ChartCard>
          </>
        )}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="caption" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {sub && <div className="caption">{sub}</div>}
    </div>
  );
}
