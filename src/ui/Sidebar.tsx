import type { EngineInputs } from '../core/design';
import { FUELS, OXIDIZERS, PROPELLANTS, stoichiometricOF } from '../core/thermo/propellants';
import { MATERIALS } from '../core/thermal/materials';
import { NumField, Section, Segmented, SelectField, Toggle } from './fields';

type Cooling = EngineInputs['cooling'];
type Nozzle = EngineInputs['nozzle'];
type Chamber = EngineInputs['chamber'];

const bar = 1e5;
const mm = 1e-3;
const kN = 1e3;

const materialOptions = (ids: string[]) => ids.map((id) => ({ value: id, label: MATERIALS[id].name }));

export function Sidebar({ inputs, onChange }: { inputs: EngineInputs; onChange: (next: EngineInputs) => void }) {
  const set = (patch: Partial<EngineInputs>) => onChange({ ...inputs, ...patch });
  const setCool = (patch: Partial<Cooling>) => onChange({ ...inputs, cooling: { ...inputs.cooling, ...patch } });
  const setNoz = (patch: Partial<Nozzle>) => onChange({ ...inputs, nozzle: { ...inputs.nozzle, ...patch } });
  const setCh = (patch: Partial<Chamber>) => onChange({ ...inputs, chamber: { ...inputs.chamber, ...patch } });
  const ox = PROPELLANTS[inputs.oxidizer];
  const fu = PROPELLANTS[inputs.fuel];
  const stoich = stoichiometricOF(ox, fu);
  const c = inputs.cooling;
  const coolantProp = c.coolantSide === 'fuel' ? fu : ox;

  return (
    <aside className="sidebar" aria-label="Design inputs">
      <Section title="Mission">
        <NumField label="Thrust" value={inputs.thrust} onChange={(v) => set({ thrust: v })} unit="kN" scale={kN} min={0.05} max={10000} />
        <Segmented
          label="Thrust rated at"
          value={inputs.thrustAmbient > 0 ? 'sl' : 'vac'}
          options={[
            { value: 'sl', label: 'Sea level' },
            { value: 'vac', label: 'Vacuum' },
          ]}
          onChange={(v) => set({ thrustAmbient: v === 'sl' ? 101325 : 0 })}
        />
      </Section>

      <Section title="Propellants">
        <SelectField
          label="Oxidizer"
          value={inputs.oxidizer}
          options={OXIDIZERS.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(v) => set({ oxidizer: v })}
        />
        <SelectField
          label="Fuel"
          value={inputs.fuel}
          options={FUELS.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(v) => set({ fuel: v })}
        />
        <NumField
          label="Mixture ratio O/F"
          hint={`stoichiometric ${stoich.toFixed(2)}`}
          value={inputs.of}
          onChange={(v) => set({ of: v })}
          min={0.3}
          max={Math.max(12, stoich * 1.3)}
          slider
          step={0.01}
          digits={2}
        />
        <NumField label="Chamber pressure" value={inputs.pc} onChange={(v) => set({ pc: v })} unit="bar" scale={bar} min={3} max={350} slider step={1} />
        <Segmented
          label="Expansion chemistry"
          value={inputs.frozen ? 'frozen' : 'eq'}
          options={[
            { value: 'eq', label: 'Shifting' },
            { value: 'frozen', label: 'Frozen' },
          ]}
          onChange={(v) => set({ frozen: v === 'frozen' })}
        />
        <NumField label="c* efficiency" value={inputs.cstarEfficiency} onChange={(v) => set({ cstarEfficiency: v })} min={0.85} max={1} digits={3} />
      </Section>

      <Section title="Chamber">
        <NumField label="Contraction ratio" hint="Ac / At" value={inputs.chamber.contractionRatio} onChange={(v) => setCh({ contractionRatio: v })} min={1.5} max={12} slider step={0.1} digits={2} />
        <NumField label="Characteristic length L*" value={inputs.chamber.lstar} onChange={(v) => setCh({ lstar: v })} unit="m" min={0.3} max={3} slider step={0.05} digits={2} />
        <NumField label="Convergent half-angle" value={inputs.chamber.convergentAngle} onChange={(v) => setCh({ convergentAngle: v })} unit="deg" min={15} max={60} />
        <NumField label="Upstream throat radius" hint="× Rt" value={inputs.chamber.rcUpstream} onChange={(v) => setCh({ rcUpstream: v })} min={0.5} max={3} digits={2} />
        <NumField label="Chamber blend radius" hint="× Rt" value={inputs.chamber.rcChamber} onChange={(v) => setCh({ rcChamber: v })} min={0.2} max={3} digits={2} />
      </Section>

      <Section title="Nozzle">
        <Segmented
          label="Contour"
          value={inputs.nozzle.kind}
          options={[
            { value: 'bell', label: 'TOP bell' },
            { value: 'cone', label: 'Cone' },
          ]}
          onChange={(v) => setNoz({ kind: v })}
        />
        <Segmented
          label="Expansion set by"
          value={inputs.expansion.mode}
          options={[
            { value: 'eps', label: 'Area ratio' },
            { value: 'pe', label: 'Exit pressure' },
          ]}
          onChange={(v) => set({ expansion: v === 'eps' ? { mode: 'eps', eps: 20 } : { mode: 'pe', pe: 101325 } })}
        />
        {inputs.expansion.mode === 'eps' ? (
          <NumField label="Area ratio ε" value={inputs.expansion.eps} onChange={(v) => set({ expansion: { mode: 'eps', eps: v } })} min={2} max={300} slider step={0.5} digits={1} />
        ) : (
          <NumField label="Exit pressure" value={inputs.expansion.pe} onChange={(v) => set({ expansion: { mode: 'pe', pe: v } })} unit="kPa" scale={1e3} min={0.5} max={500} />
        )}
        <NumField label="Downstream throat radius" hint="× Rt" value={inputs.nozzle.rcDownstream} onChange={(v) => setNoz({ rcDownstream: v })} min={0.2} max={3} digits={3} />
        {inputs.nozzle.kind === 'bell' ? (
          <>
            <NumField label="Bell length" hint="% of 15° cone" value={inputs.nozzle.lengthFraction} onChange={(v) => setNoz({ lengthFraction: v })} unit="%" scale={0.01} min={60} max={100} slider step={1} integer />
            <Toggle label="Optimize contour" hint="Maximize Isp with MoC/Euler" checked={inputs.nozzle.optimize} onChange={(v) => setNoz({ optimize: v })} />
            {!inputs.nozzle.optimize && (
              <>
                <NumField label="Inflection angle θn" value={inputs.nozzle.thetaN} onChange={(v) => setNoz({ thetaN: v })} unit="deg" min={10} max={50} slider step={0.5} digits={1} />
                <NumField label="Exit angle θe" value={inputs.nozzle.thetaE} onChange={(v) => setNoz({ thetaE: v })} unit="deg" min={1} max={30} slider step={0.5} digits={1} />
              </>
            )}
          </>
        ) : (
          <NumField label="Cone half-angle" value={inputs.nozzle.halfAngle} onChange={(v) => setNoz({ halfAngle: v })} unit="deg" min={5} max={30} slider step={0.5} digits={1} />
        )}
      </Section>

      <Section title="Cooling">
        <Segmented
          label="Method"
          value={c.mode}
          options={[
            { value: 'regen', label: 'Regenerative' },
            { value: 'radiative', label: 'Radiative' },
          ]}
          onChange={(v) => setCool({ mode: v })}
        />
        {c.mode === 'regen' && (
          <>
            <Segmented
              label="Coolant"
              value={c.coolantSide}
              options={[
                { value: 'fuel', label: fu.name.split(' ').slice(-1)[0] },
                { value: 'oxidizer', label: ox.name.split(' ').slice(-1)[0] },
              ]}
              onChange={(v) => setCool({ coolantSide: v })}
            />
            {!coolantProp.coolant && <div className="notice">No property model for {coolantProp.name}; it will be analysed as radiation cooled.</div>}
            <NumField label="Inlet temperature" value={c.inletTemperature} onChange={(v) => setCool({ inletTemperature: v })} unit="K" min={20} max={600} />
            <NumField label="Inlet pressure" value={c.inletPressure} onChange={(v) => setCool({ inletPressure: v })} unit="bar" scale={bar} min={5} max={690} slider step={1} />
            <NumField label="Regen jacket to ε" hint="beyond: radiative extension" value={c.regenAreaRatio} onChange={(v) => setCool({ regenAreaRatio: v })} min={1.5} max={1000} />
            <NumField label="Channels at throat" value={c.channels} onChange={(v) => setCool({ channels: v })} min={8} max={1200} integer slider step={2} />
            <NumField label="Rib width" value={c.ribWidth} onChange={(v) => setCool({ ribWidth: v })} unit="mm" scale={mm} min={0.3} max={5} digits={2} />
            <NumField label="Max channel width" hint="bifurcate beyond" value={c.maxChannelWidth} onChange={(v) => setCool({ maxChannelWidth: v })} unit="mm" scale={mm} min={0.8} max={20} digits={2} />
            <NumField label="Channel height · chamber" value={c.channelHeightChamber} onChange={(v) => setCool({ channelHeightChamber: v })} unit="mm" scale={mm} min={0.3} max={30} digits={2} />
            <NumField label="Channel height · throat" value={c.channelHeightThroat} onChange={(v) => setCool({ channelHeightThroat: v })} unit="mm" scale={mm} min={0.3} max={30} digits={2} />
            <NumField label="Channel height · exit" value={c.channelHeightExit} onChange={(v) => setCool({ channelHeightExit: v })} unit="mm" scale={mm} min={0.3} max={30} digits={2} />
            <NumField label="Liner thickness (min)" value={c.linerThickness} onChange={(v) => setCool({ linerThickness: v })} unit="mm" scale={mm} min={0.3} max={5} digits={2} />
            <NumField label="Liner thickness (max)" value={c.linerThicknessMax} onChange={(v) => setCool({ linerThicknessMax: v })} unit="mm" scale={mm} min={0.3} max={10} digits={2} />
            <NumField label="Liner safety factor" value={c.linerSafetyFactor} onChange={(v) => setCool({ linerSafetyFactor: v })} min={1} max={4} digits={2} />
            <NumField label="Jacket thickness (min)" value={c.jacketThickness} onChange={(v) => setCool({ jacketThickness: v })} unit="mm" scale={mm} min={0.5} max={50} digits={2} />
            <NumField label="Jacket safety factor" value={c.jacketSafetyFactor} onChange={(v) => setCool({ jacketSafetyFactor: v })} min={1} max={4} digits={2} />
            <NumField label="Channel roughness" value={c.roughness} onChange={(v) => setCool({ roughness: v })} unit="µm" scale={1e-6} min={0} max={100} />
            <SelectField label="Liner" value={c.linerMaterial} options={materialOptions(['GRCop42', 'CuCrZr', 'AlSi10Mg', 'Inconel718', 'SS316L'])} onChange={(v) => setCool({ linerMaterial: v })} />
            <SelectField label="Jacket" value={c.jacketMaterial} options={materialOptions(['Inconel718', 'SS316L', 'Ti64', 'CuCrZr'])} onChange={(v) => setCool({ jacketMaterial: v })} />
          </>
        )}
        <SelectField
          label={c.mode === 'regen' ? 'Extension material' : 'Wall material'}
          value={c.radiativeMaterial}
          options={materialOptions(['C103', 'CarbonCarbon', 'Inconel718'])}
          onChange={(v) => setCool({ radiativeMaterial: v })}
        />
        <NumField label="Radiative wall thickness" value={c.radiativeThickness} onChange={(v) => setCool({ radiativeThickness: v })} unit="mm" scale={mm} min={0.2} max={10} digits={2} />
        <NumField label="Barrier film" hint="fraction of total flow" value={c.barrierFraction} onChange={(v) => setCool({ barrierFraction: v })} unit="%" scale={0.01} min={0} max={40} slider step={0.5} digits={1} />
        {c.barrierFraction > 0 && (
          <NumField label="Barrier O/F" value={c.barrierMixtureRatio} onChange={(v) => setCool({ barrierMixtureRatio: v })} min={0.1} max={Math.max(0.2, inputs.of - 0.05)} digits={2} />
        )}
        <NumField label="Bartz multiplier" value={c.bartzFactor} onChange={(v) => setCool({ bartzFactor: v })} min={0.3} max={2} digits={2} />
      </Section>

      <Section title="Injector" defaultOpen={false}>
        <NumField label="Pressure drop" hint="% of Pc" value={inputs.injector.pressureDropFraction} onChange={(v) => set({ injector: { ...inputs.injector, pressureDropFraction: v } })} unit="%" scale={0.01} min={5} max={60} />
        <NumField label="Elements" value={inputs.injector.elements} onChange={(v) => set({ injector: { ...inputs.injector, elements: v } })} min={1} max={2000} integer />
        <NumField label="Orifice Cd" value={inputs.injector.dischargeCoefficient} onChange={(v) => set({ injector: { ...inputs.injector, dischargeCoefficient: v } })} min={0.4} max={1} digits={2} />
      </Section>

      <Section title="Numerics" defaultOpen={false}>
        <NumField label="Wall stations" value={inputs.numerics.stations} onChange={(v) => set({ numerics: { ...inputs.numerics, stations: v } })} min={60} max={800} integer />
        <NumField label="MoC resolution" hint="IVL intervals" value={inputs.numerics.mocResolution} onChange={(v) => set({ numerics: { ...inputs.numerics, mocResolution: v } })} min={12} max={120} integer />
        <NumField label="Euler cells" hint="radial" value={inputs.numerics.eulerCells} onChange={(v) => set({ numerics: { ...inputs.numerics, eulerCells: v } })} min={20} max={240} integer />
      </Section>
    </aside>
  );
}
