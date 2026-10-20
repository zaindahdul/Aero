import type { EngineDesign } from '../../core/design';
import { MATERIALS } from '../../core/thermal/materials';
import { PROPELLANTS } from '../../core/thermo/propellants';
import { ChartCard } from '../charts/ChartCard';
import { exportCSV, exportDXF, exportJSON, exportSTL } from '../exports';
import { bar, fmt, kN, mm, pct } from '../format';

export function StatusIcon({ level }: { level: 'good' | 'warning' | 'critical' }) {
  const color = level === 'good' ? 'var(--status-good)' : level === 'warning' ? 'var(--status-warning)' : 'var(--status-critical)';
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="7" fill={color} />
      {level === 'good' ? (
        <path d="M4.6 8.2l2.2 2.2 4.6-4.8" stroke="#0d0e11" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M8 4.2v4.6M8 11.3v.2" stroke="#0d0e11" strokeWidth="1.9" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function classify(w: string): 'warning' | 'critical' {
  return /exceeds|exhausted|below the|negative/.test(w) ? 'critical' : 'warning';
}

const VALIDATION: [string, string, string][] = [
  ['Chemical equilibrium & rocket performance', 'NASA CEA (Gordon & McBride), 96 cases × shifting/frozen, 7 propellant pairs', 'Tc, Isp, c*, γ, sound speed, exit Mach within 0.02 %'],
  ['Combustion-gas transport', 'NASA CEA transport output', 'Viscosity, conductivity, Prandtl within 0.5 %'],
  ['Method of characteristics', 'Exact conical source flow (10°, 15°, 20° cones)', 'Isp efficiency within 0.15 %; exit mass/momentum balance < 0.3 %'],
  ['Euler space-march', 'Independent MoC solution on shock-free nozzles', 'Agreement within 0.1 %; mass conserved to 1e-12'],
  ['TOP bell optimizer', "Rao's thrust-optimized parabola charts", 'Optimal θn, θe within the published band (ε 25, 80 %: 32.4°, 8.0°)'],
  ['Coolant properties', 'CoolProp reference equations of state', 'Density within 1 %, cp within 3 %, μ and k within 2 %'],
  ['Solid model', 'Closed-manifold and volume checks', 'All bodies watertight & outward-oriented; mass within 6 % of thermal model'],
];

const REFERENCES = [
  'Gordon & McBride, Complex Chemical Equilibrium Compositions and Applications, NASA RP-1311 (1994)',
  'McBride, Zehe & Gordon, NASA Glenn Coefficients for Thermodynamic Properties, NASA TP-2002-211556',
  'Svehla, Transport Coefficients for the NASA Lewis Chemical Equilibrium Program, NASA TM-4647 (1995)',
  'Rao, Exhaust Nozzle Contour for Optimum Thrust, Jet Propulsion 28 (1958)',
  'Zucrow & Hoffman, Gas Dynamics, Vol. 2 (1977): method of characteristics',
  'Kliegel & Levine, Transonic Flow in Small Throat Radius of Curvature Nozzles, AIAA J. 7 (1969)',
  'Bartz, A Simple Equation for Rapid Estimation of Rocket Nozzle Convective Heat Transfer Coefficients, Jet Propulsion 27 (1957)',
  'Huzel & Huang, Modern Engineering for Design of Liquid-Propellant Rocket Engines, AIAA (1992)',
  'Schmucker, Flow Processes in Overexpanded Chemical Rocket Nozzles, NASA TM-77396 (1984)',
  'Bell, Wronski, Quoilin & Lemort, CoolProp, Ind. Eng. Chem. Res. 53 (2014)',
];

export function ReportView({ design, onSnapshot }: { design: EngineDesign; onSnapshot: () => void }) {
  const i = design.inputs;
  const p = design.performance;
  const g = design.geometry;
  const t = design.thermal;
  const c = i.cooling;
  const regen = design.coolant !== null;
  const rows: [string, string][] = [
    ['Propellants', `${PROPELLANTS[i.oxidizer].name} / ${PROPELLANTS[i.fuel].name}`],
    ['Mixture ratio O/F', fmt(i.of, 2)],
    ['Chamber pressure', `${bar(i.pc)} bar`],
    ['Thrust (vacuum · sea level)', `${kN(p.thrustVac)} kN · ${p.thrustSeaLevel > 0 ? kN(p.thrustSeaLevel) + ' kN' : 'n/a'}`],
    ['Specific impulse (vacuum · sea level)', `${fmt(p.ispVac, 1)} s · ${p.thrustSeaLevel > 0 ? fmt(p.ispSeaLevel, 1) + ' s' : 'n/a'}`],
    ['Mass flow', `${fmt(p.massFlow, 3)} kg/s`],
    ['Chamber temperature', `${fmt(design.thermo.chamber.T, 0)} K`],
    ['Throat · chamber · exit diameter', `${mm(g.throatDiameter)} · ${mm(g.chamberDiameter)} · ${mm(g.exitDiameter)} mm`],
    ['Chamber · nozzle · total length', `${mm(g.chamberLength, 0)} · ${mm(g.nozzleLength, 0)} · ${mm(g.totalLength, 0)} mm`],
    ['Area ratio · contraction ratio', `${fmt(p.eps, 2)} · ${fmt(i.chamber.contractionRatio, 2)}`],
    ['Nozzle', i.nozzle.kind === 'bell' ? `${fmt(i.nozzle.lengthFraction * 100, 0)} % TOP bell${design.nozzleFlow.optimized ? ' (MoC/Euler optimized)' : ''}` : `${fmt(i.nozzle.halfAngle, 1)}° cone`],
    ['Nozzle efficiency · Cd', `${pct(p.nozzleEfficiency)} % · ${fmt(p.dischargeCoefficient, 4)}`],
    ['Cooling', regen ? `Regenerative (${design.coolant}), ${MATERIALS[c.linerMaterial].name} liner` : `Radiation, ${MATERIALS[c.radiativeMaterial].name}`],
    ['Peak wall temperature · heat flux', `${fmt(t.maxWallTemperature, 0)} K · ${fmt(t.maxHeatFlux / 1e6, 1)} MW/m²`],
    ...(regen ? ([['Coolant Δp · outlet temperature', `${bar(t.pressureDrop)} bar · ${fmt(t.outletTemperature, 0)} K`]] as [string, string][]) : []),
    ['Injector elements · orifices (ox / fuel)', `${design.injector.elements} · ${mm(design.injector.oxidizerOrificeDiameter, 2)} / ${mm(design.injector.fuelOrificeDiameter, 2)} mm`],
    ...(design.cycle
      ? ([['Engine cycle', `${design.cycle.kind.replace('-', ' ')} · ${design.cycle.closes ? 'closes' : 'does not close'} · Isp ${fmt(design.cycle.ispVac, 1)} s`]] as [string, string][])
      : []),
    ['Chamber assembly mass', `${fmt(design.mass.total, design.mass.total < 10 ? 2 : 0)} kg`],
  ];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="grid-2">
        <ChartCard title={`${i.name} · design datasheet`} caption={`Computed in ${fmt(design.timings.total, 0)} ms (chemistry ${fmt(design.timings.thermo, 0)}, nozzle ${fmt(design.timings.nozzle, 0)}, thermal ${fmt(design.timings.thermal, 0)})`}>
          <table className="data kv">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ChartCard>
        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <ChartCard title="Design checks" caption="Thermal, hydraulic and structural limits">
            <div style={{ display: 'grid', gap: 8 }}>
              {design.warnings.length === 0 ? (
                <div className="notice">
                  <StatusIcon level="good" />
                  <span>
                    <b>All checks pass.</b> Wall temperatures below material limits, margins above targets, coolant reaches the injector with pressure to spare.
                  </span>
                </div>
              ) : (
                design.warnings.map((w) => (
                  <div className="notice" key={w}>
                    <StatusIcon level={classify(w)} />
                    <span>
                      <b>{classify(w) === 'critical' ? 'Limit exceeded. ' : 'Advisory. '}</b>
                      {w}
                    </span>
                  </div>
                ))
              )}
            </div>
          </ChartCard>
          <ChartCard title="Export" caption="Solid model in millimetres; profile for re-creating the revolve in parametric CAD">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button className="btn primary" onClick={() => exportSTL(design, 'assembly')}>
                STL · assembly
              </button>
              <button className="btn" onClick={() => exportSTL(design, 'liner')}>
                STL · liner + ribs
              </button>
              <button className="btn" onClick={() => exportSTL(design, 'jacket')}>
                STL · jacket
              </button>
              <button className="btn" onClick={() => exportSTL(design, 'injector')}>
                STL · injector
              </button>
              <button className="btn" onClick={() => exportDXF(design)}>
                DXF profile
              </button>
              <button className="btn" onClick={() => exportCSV(design)}>
                CSV contour
              </button>
              <button className="btn" onClick={() => exportJSON(design)}>
                JSON report
              </button>
              <button className="btn" onClick={onSnapshot}>
                PNG render
              </button>
            </div>
          </ChartCard>
        </div>
      </div>
      <ChartCard title="Verification" caption="Each claim is enforced by the automated test suite (npm test)">
        <table className="data">
          <thead>
            <tr>
              <th>Model</th>
              <th style={{ textAlign: 'left' }}>Reference</th>
              <th style={{ textAlign: 'left' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {VALIDATION.map(([m, r, res]) => (
              <tr key={m}>
                <td>{m}</td>
                <td style={{ textAlign: 'left', fontFamily: 'var(--font-sans)', whiteSpace: 'normal' }}>{r}</td>
                <td style={{ textAlign: 'left', fontFamily: 'var(--font-sans)', whiteSpace: 'normal' }}>{res}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartCard>
      <ChartCard title="Methods and references">
        <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', display: 'grid', gap: 4 }}>
          {REFERENCES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
      </ChartCard>
    </div>
  );
}
