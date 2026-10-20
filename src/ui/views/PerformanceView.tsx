import type { EngineDesign, StateSummary } from '../../core/design';
import { BarChart } from '../charts/BarChart';
import { ChartCard } from '../charts/ChartCard';
import { LineChart } from '../charts/LineChart';
import type { SweepPoint } from '../engineClient';
import { bar, fmt, fmtSig, kN, pct, species } from '../format';

const ROWS: [string, (s: StateSummary) => string][] = [
  ['Pressure, bar', (s) => bar(s.P)],
  ['Temperature, K', (s) => fmt(s.T, 1)],
  ['Density, kg/m³', (s) => fmtSig(s.rho, 4)],
  ['Molecular weight, g/mol', (s) => fmt(s.mw, 3)],
  ['Enthalpy, kJ/kg', (s) => fmt(s.h / 1e3, 1)],
  ['Entropy, kJ/(kg·K)', (s) => fmt(s.s / 1e3, 4)],
  ['cp equilibrium, kJ/(kg·K)', (s) => fmt(s.cpEq / 1e3, 4)],
  ['cp frozen, kJ/(kg·K)', (s) => fmt(s.cpFr / 1e3, 4)],
  ['γ equilibrium (γs)', (s) => fmt(s.gammaEq, 4)],
  ['γ frozen', (s) => fmt(s.gammaFr, 4)],
  ['Sound speed, m/s', (s) => fmt(s.a, 1)],
  ['Velocity, m/s', (s) => fmt(s.u, 1)],
  ['Mach number', (s) => fmt(s.mach, 3)],
  ['Area ratio A/At', (s) => fmt(s.areaRatio, 3)],
  ['Viscosity, µPa·s', (s) => fmt(s.viscosity * 1e6, 2)],
  ['Conductivity (frozen), W/(m·K)', (s) => fmt(s.conductivity, 4)],
  ['Prandtl (frozen)', (s) => fmt(s.prandtl, 4)],
];

export function PerformanceView({ design, sweep }: { design: EngineDesign; sweep: SweepPoint[] | null }) {
  const t = design.thermo;
  const p = design.performance;
  const sl = p.thrustSeaLevel > 0;
  const speciesNames = t.chamber.moleFractions.slice(0, 10).map(([n]) => n);
  const exitMap = new Map(t.exit.moleFractions);
  const alt = design.altitude;
  const sepStart = alt.find((a) => !a.separated)?.altitude ?? 0;

  return (
    <div className="grid-2">
      <ChartCard
        title="Combustion and expansion"
        caption={`${design.inputs.oxidizer}/${design.inputs.fuel} · O/F ${fmt(design.inputs.of, 2)}${t.barrierTemperature ? ` (core ${fmt(t.coreMixtureRatio, 2)})` : ''} · ${t.frozen ? 'frozen' : 'shifting-equilibrium'} expansion · Gibbs minimization, 150 species`}
      >
        <table className="data">
          <thead>
            <tr>
              <th>Property</th>
              <th>Chamber</th>
              <th>Throat</th>
              <th>Exit</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, f]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{f(t.chamber)}</td>
                <td>{f(t.throat)}</td>
                <td>{f(t.exit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartCard>

      <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
        <ChartCard title="Performance" caption="Ideal (CEA-equivalent) vs delivered (c* efficiency × MoC/Euler nozzle efficiency)">
          <table className="data">
            <thead>
              <tr>
                <th>Quantity</th>
                <th>Ideal</th>
                <th>Delivered</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Characteristic velocity c*, m/s</td>
                <td>{fmt(p.cstarIdeal, 1)}</td>
                <td>{fmt(p.cstar, 1)}</td>
              </tr>
              <tr>
                <td>Vacuum Isp, s</td>
                <td>{fmt(p.ispVacIdeal, 1)}</td>
                <td>{fmt(p.ispVac, 1)}</td>
              </tr>
              <tr>
                <td>Vacuum thrust coefficient</td>
                <td>{fmt(p.cfVacIdeal, 4)}</td>
                <td>{fmt(p.cfVac, 4)}</td>
              </tr>
              <tr>
                <td>Sea-level Isp, s</td>
                <td>–</td>
                <td>{sl ? fmt(p.ispSeaLevel, 1) : 'n/a'}</td>
              </tr>
              <tr>
                <td>Nozzle efficiency (Euler · MoC)</td>
                <td>1</td>
                <td>
                  {pct(p.nozzleEfficiency)} % · {pct(p.nozzleEfficiencyMoc)} %
                </td>
              </tr>
              <tr>
                <td>Discharge coefficient</td>
                <td>1</td>
                <td>{fmt(p.dischargeCoefficient, 4)}</td>
              </tr>
              <tr>
                <td>Area ratio · Pc/Pe</td>
                <td colSpan={2}>
                  {fmt(p.eps, 2)} · {fmt(p.pcOverPe, 1)}
                </td>
              </tr>
              <tr>
                <td>Mass flow (ox + fuel), kg/s</td>
                <td colSpan={2}>
                  {fmtSig(p.massFlow, 4)} ({fmtSig(p.oxidizerFlow, 4)} + {fmtSig(p.fuelFlow, 4)})
                </td>
              </tr>
              <tr>
                <td>Thrust vacuum · sea level, kN</td>
                <td colSpan={2}>
                  {kN(p.thrustVac)} · {sl ? kN(p.thrustSeaLevel) : 'n/a'}
                </td>
              </tr>
            </tbody>
          </table>
        </ChartCard>
        <ChartCard title="Chamber and exit composition" caption="Mole fractions of the ten most abundant species">
          <BarChart
            categories={speciesNames.map(species)}
            series={[
              { id: 'c', label: 'Chamber', values: t.chamber.moleFractions.slice(0, 10).map(([, x]) => x * 100) },
              { id: 'e', label: 'Exit', values: speciesNames.map((n) => (exitMap.get(n) ?? 0) * 100) },
            ]}
            format={(v) => `${v < 0.1 ? v.toFixed(3) : v.toFixed(2)} %`}
            axisLabel="mole fraction, %"
          />
        </ChartCard>
      </div>

      <ChartCard
        title="Specific impulse vs mixture ratio"
        caption={`Ideal, at Pc ${bar(design.inputs.pc)} bar and ε ${fmt(p.eps, 1)}; design point marked`}
        table={
          sweep
            ? {
                xLabel: 'O/F',
                series: [
                  { id: 'v', label: 'Vacuum Isp, s', x: sweep.map((s) => s.of), y: sweep.map((s) => s.ispVac) },
                  { id: 's', label: 'Sea-level Isp, s', x: sweep.map((s) => s.of), y: sweep.map((s) => s.ispSeaLevel) },
                ],
              }
            : undefined
        }
      >
        {sweep ? (
          <LineChart
            xLabel="O/F mixture ratio"
            yLabel="Isp, s"
            series={[
              { id: 'v', label: 'Vacuum', x: sweep.map((s) => s.of), y: sweep.map((s) => s.ispVac) },
              ...(sl ? [{ id: 's', label: 'Sea level', x: sweep.map((s) => s.of), y: sweep.map((s) => s.ispSeaLevel) }] : []),
            ]}
            markers={[{ x: design.inputs.of, label: 'design' }]}
            yFormat={(v) => `${v.toFixed(1)} s`}
          />
        ) : (
          <div className="empty" style={{ height: 220 }}>
            Computing sweep…
          </div>
        )}
      </ChartCard>

      <ChartCard
        title="Chamber temperature vs mixture ratio"
        caption="Adiabatic flame temperature from the HP equilibrium"
        table={sweep ? { xLabel: 'O/F', series: [{ id: 't', label: 'Tc, K', x: sweep.map((s) => s.of), y: sweep.map((s) => s.Tc) }] } : undefined}
      >
        {sweep ? (
          <LineChart xLabel="O/F mixture ratio" yLabel="Tc, K" series={[{ id: 't', label: 'Chamber temperature', x: sweep.map((s) => s.of), y: sweep.map((s) => s.Tc) }]} markers={[{ x: design.inputs.of, label: 'design' }]} yFormat={(v) => `${v.toFixed(0)} K`} />
        ) : (
          <div className="empty" style={{ height: 220 }}>
            Computing sweep…
          </div>
        )}
      </ChartCard>

      <ChartCard
        title="Thrust vs altitude"
        caption="U.S. Standard Atmosphere 1976; shaded where the Schmucker criterion predicts flow separation"
        table={{ xLabel: 'Altitude, km', series: [{ id: 'f', label: 'Thrust, kN', x: alt.map((a) => a.altitude / 1e3), y: alt.map((a) => a.thrust / 1e3) }] }}
      >
        <LineChart
          xLabel="Altitude, km"
          yLabel="Thrust, kN"
          series={[{ id: 'f', label: 'Thrust', x: alt.map((a) => a.altitude / 1e3), y: alt.map((a) => a.thrust / 1e3) }]}
          bands={sepStart > 0 ? [{ x0: 0, x1: sepStart / 1e3, label: 'separated' }] : []}
          yFormat={(v) => `${v.toFixed(1)} kN`}
        />
      </ChartCard>

      <ChartCard
        title="Specific impulse vs altitude"
        caption="Delivered Isp"
        table={{ xLabel: 'Altitude, km', series: [{ id: 'i', label: 'Isp, s', x: alt.map((a) => a.altitude / 1e3), y: alt.map((a) => a.isp) }] }}
      >
        <LineChart
          xLabel="Altitude, km"
          yLabel="Isp, s"
          series={[{ id: 'i', label: 'Delivered Isp', x: alt.map((a) => a.altitude / 1e3), y: alt.map((a) => a.isp) }]}
          bands={sepStart > 0 ? [{ x0: 0, x1: sepStart / 1e3, label: 'separated' }] : []}
          yFormat={(v) => `${v.toFixed(1)} s`}
          yMin={Math.max(0, Math.min(...alt.filter((a) => !a.separated).map((a) => a.isp)) - 20)}
        />
      </ChartCard>
    </div>
  );
}
