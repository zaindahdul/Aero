/**
 * Engine power-cycle balance built on the converged thrust-chamber design:
 * pressure-fed, gas-generator, closed expander, single-shaft staged combustion
 * (fuel-rich, or oxidizer-rich for kerosene) and full-flow staged combustion.
 *
 * Pumps:     P = mdot * dp / (rho * eta_p), incompressible liquid.
 * Turbines:  w = eta_t * cp * T_in * (1 - PR^-((g-1)/g)), perfect gas at the
 *            turbine inlet state. Gas-generator and preburner gas comes from
 *            the HP equilibrium solver at the mixture ratio that holds the
 *            turbine-inlet temperature limit; expander turbine gas is the
 *            regeneratively heated coolant.
 * Staged combustion: the turbine discharges into the main injector, so raising
 * its pressure ratio raises the pump discharge pressure. The solver finds the
 * lowest pressure ratio where turbine power meets pump power, or reports that
 * no such ratio exists.
 */
import { G0, R_UNIVERSAL } from './constants';
import { getFluid } from './fluids/fluids';
import { PROPELLANTS, type Propellant, stoichiometricOF } from './thermo/propellants';
import { RocketExpansion } from './thermo/rocket';
import type { EngineDesign } from './design';

export type CycleKind = 'pressure-fed' | 'gas-generator' | 'expander' | 'staged-combustion' | 'full-flow';

export const CYCLE_LABELS: Record<CycleKind, string> = {
  'pressure-fed': 'Pressure-fed',
  'gas-generator': 'Gas generator',
  expander: 'Closed expander',
  'staged-combustion': 'Staged combustion',
  'full-flow': 'Full-flow staged combustion',
};

export const CYCLE_SHORT: Record<CycleKind, string> = {
  'pressure-fed': 'Pressure-fed',
  'gas-generator': 'Gas generator',
  expander: 'Expander',
  'staged-combustion': 'Staged comb.',
  'full-flow': 'Full-flow SC',
};

export interface CycleInputs {
  kind: CycleKind;
  /** Pump inlet (tank) pressure, Pa. */
  tankPressure: number;
  pumpEfficiency: number;
  turbineEfficiency: number;
  /** Turbine-inlet temperature limit for gas-generator / preburner gas, K. */
  turbineInletTemperature: number;
  /** Gas-generator turbine pressure ratio. */
  ggPressureRatio: number;
  /** Feed-line and valve losses as a fraction of Pc. */
  lineLoss: number;
}

export interface PumpResult {
  propellant: string;
  massFlow: number;
  inletPressure: number;
  dischargePressure: number;
  power: number;
}

export interface TurbineResult {
  label: string;
  gas: string;
  massFlow: number;
  inletTemperature: number;
  inletPressure: number;
  outletPressure: number;
  pressureRatio: number;
  /** Shaft power delivered, W (equal to the pump power it drives when balanced). */
  power: number;
  /** Power available from this turbine at its pressure ratio, W. */
  available: number;
}

export interface CombustorResult {
  label: string;
  mixtureRatio: number;
  temperature: number;
  pressure: number;
  massFlow: number;
}

export interface CycleResult {
  kind: CycleKind;
  closes: boolean;
  /** Available turbine power over required pump power, minus one (0 when the cycle is solved to balance). */
  powerMargin: number;
  pumps: PumpResult[];
  turbines: TurbineResult[];
  combustors: CombustorResult[];
  /** Delivered vacuum Isp and thrust including cycle losses (e.g. dumped turbine exhaust). */
  ispVac: number;
  thrustVac: number;
  totalMassFlow: number;
  /** Coolant pump discharge the cycle needs vs the value the thermal analysis assumed, Pa. */
  coolantInletRequired: number | null;
  /** Ordered pressure budget along the highest-pressure path, Pa. */
  pressureBudget: { label: string; pressure: number }[];
  notes: string[];
}

const pumpPower = (mdot: number, dp: number, rho: number, eta: number) => (mdot * Math.max(0, dp)) / (rho * eta);

/** Perfect-gas turbine specific work. */
const turbineWork = (eta: number, cp: number, T: number, gamma: number, pr: number) => eta * cp * T * (1 - Math.pow(pr, -(gamma - 1) / gamma));

interface RichGas {
  of: number;
  T: number;
  cp: number;
  gamma: number;
}

/** Mixture ratio on the fuel-rich (or oxidizer-rich) branch whose equilibrium temperature equals Tlim. */
function richGas(ox: Propellant, fuel: Propellant, p: number, Tlim: number, oxRich: boolean): RichGas {
  const st = stoichiometricOF(ox, fuel);
  const T = (of: number) => {
    try {
      return new RocketExpansion(ox, fuel, of, p).chamber.T;
    } catch {
      return 0; // extremely rich mixtures: treat as cold
    }
  };
  let lo = oxRich ? st * 1.05 : st * 0.01;
  let hi = oxRich ? st * 60 : st * 0.95;
  // Temperature rises toward stoichiometric on the fuel-rich branch and falls with excess oxidizer.
  for (let i = 0; i < 50; i++) {
    const mid = Math.sqrt(lo * hi);
    const hot = T(mid) > Tlim;
    if (oxRich ? hot : !hot) lo = mid;
    else hi = mid;
  }
  const of = Math.sqrt(lo * hi);
  const c = new RocketExpansion(ox, fuel, of, p).chamber;
  return { of, T: c.T, cp: c.cpFr, gamma: c.gammaFr };
}

/**
 * Lowest turbine pressure ratio in (1, prMax] where available power meets the
 * (pressure-ratio dependent) required power; null if none exists.
 */
function balancePressureRatio(available: (pr: number) => number, required: (pr: number) => number, prMax = 60): number | null {
  const g = (pr: number) => available(pr) - required(pr);
  let lo = 1.0001;
  if (g(lo) >= 0) return lo;
  // Scan geometrically for the first sign change, then bisect it.
  const steps = 240;
  for (let k = 1; k <= steps; k++) {
    let hi = Math.exp((Math.log(prMax) * k) / steps);
    if (g(hi) >= 0) {
      for (let it = 0; it < 80; it++) {
        const m = 0.5 * (lo + hi);
        if (g(m) >= 0) hi = m;
        else lo = m;
      }
      return hi;
    }
    lo = hi;
  }
  return null;
}

export function analyzeCycle(design: EngineDesign, inp: CycleInputs): CycleResult {
  const i = design.inputs;
  const p = design.performance;
  const ox = PROPELLANTS[i.oxidizer];
  const fuel = PROPELLANTS[i.fuel];
  const pc = i.pc;
  const pInj = pc * (1 + i.injector.pressureDropFraction);
  const loss = inp.lineLoss * pc;
  const fuelCools = design.coolant !== null && i.cooling.coolantSide === 'fuel';
  const oxCools = design.coolant !== null && i.cooling.coolantSide === 'oxidizer';
  const regenDp = design.coolant ? design.thermal.pressureDrop : 0;
  const coolantIn = design.coolant ? i.cooling.inletPressure : null;
  const notes: string[] = [];
  const mOx = p.oxidizerFlow;
  const mFu = p.fuelFlow;
  const eta = inp.pumpEfficiency;
  const pt = inp.tankPressure;
  /** Discharge pressure to deliver `into` at the end of a feed path (through the jacket if that side cools). */
  const fuelDis = (into: number) => into + (fuelCools ? regenDp : 0) + loss;
  const oxDis = (into: number) => into + (oxCools ? regenDp : 0) + loss;
  const pump = (prop: Propellant, mdot: number, discharge: number): PumpResult => ({
    propellant: prop.name,
    massFlow: mdot,
    inletPressure: pt,
    dischargePressure: discharge,
    power: pumpPower(mdot, discharge - pt, prop.density, eta),
  });
  const base = { kind: inp.kind, ispVac: p.ispVac, thrustVac: p.thrustVac, totalMassFlow: p.massFlow };
  const checkCoolant = (needed: number) => {
    if (coolantIn !== null && needed > coolantIn * 1.02) {
      notes.push(
        `The cycle needs ${(needed / 1e5).toFixed(0)} bar at the coolant inlet but the thermal analysis assumed ${(coolantIn / 1e5).toFixed(0)} bar; raise the coolant inlet pressure.`,
      );
    }
  };

  if (inp.kind === 'pressure-fed') {
    // With regen cooling, the tank must supply the coolant inlet pressure the jacket was designed for.
    const pFuel = fuelCools && coolantIn ? coolantIn : fuelDis(pInj);
    const pOx = oxCools && coolantIn ? coolantIn : oxDis(pInj);
    if (Math.max(pFuel, pOx) > 50e5) notes.push('Tank pressures above ~50 bar make pressure-fed tanks very heavy; consider a pump-fed cycle.');
    notes.unshift(`Required tank pressures: fuel ${(pFuel / 1e5).toFixed(1)} bar, oxidizer ${(pOx / 1e5).toFixed(1)} bar.`);
    return {
      ...base,
      closes: true,
      powerMargin: 0,
      pumps: [],
      turbines: [],
      combustors: [],
      coolantInletRequired: design.coolant ? (fuelCools ? fuelDis(pInj) : oxDis(pInj)) : null,
      pressureBudget: [
        { label: 'Fuel tank', pressure: pFuel },
        ...(fuelCools ? [{ label: 'Regen jacket outlet', pressure: design.thermal.outletPressure }] : []),
        { label: 'Injector inlet', pressure: pInj },
        { label: 'Chamber', pressure: pc },
      ],
      notes,
    };
  }

  if (inp.kind === 'expander') {
    if (!fuelCools || !design.coolant) {
      return {
        ...base,
        closes: false,
        powerMargin: -1,
        pumps: [],
        turbines: [],
        combustors: [],
        coolantInletRequired: null,
        pressureBudget: [],
        notes: ['A closed expander needs the fuel as the regenerative coolant.'],
      };
    }
    const fluid = getFluid(design.coolant);
    const tIn = design.thermal.outletTemperature;
    const pTurbIn = design.thermal.outletPressure;
    const pTurbOut = pInj + loss;
    const pr = pTurbIn / pTurbOut;
    const st = fluid.state(tIn, pTurbIn);
    const rGas = R_UNIVERSAL / fluid.molarMass;
    const gamma = Math.min(1.67, Math.max(1.1, st.cp / Math.max(st.cp - rGas, 0.2 * st.cp)));
    const available = pr > 1 ? mFu * turbineWork(inp.turbineEfficiency, st.cp, tIn, gamma, pr) : 0;
    const pumps = [pump(fuel, mFu, coolantIn!), pump(ox, mOx, oxDis(pInj))];
    const required = pumps.reduce((s, q) => s + q.power, 0);
    const margin = available / required - 1;
    if (pr <= 1) notes.push('Coolant leaves the jacket below the injector pressure: no pressure ratio is left for the turbine.');
    if (margin < 0) notes.push('Regenerative heat pickup cannot drive the pumps; lower Pc, lengthen the chamber (more heated area) or raise the coolant inlet pressure.');
    else notes.push(`Turbine bypass of ${((margin / (1 + margin)) * 100).toFixed(0)} % available for control: the cycle closes with ${(margin * 100).toFixed(0)} % power margin.`);
    return {
      ...base,
      closes: margin >= 0,
      powerMargin: margin,
      pumps,
      turbines: [
        { label: 'Fuel turbine', gas: `${fluid.label}, regen-heated`, massFlow: mFu, inletTemperature: tIn, inletPressure: pTurbIn, outletPressure: pTurbOut, pressureRatio: pr, power: required, available },
      ],
      combustors: [],
      coolantInletRequired: coolantIn,
      pressureBudget: [
        { label: 'Fuel pump discharge', pressure: coolantIn! },
        { label: 'Regen jacket outlet', pressure: pTurbIn },
        { label: 'Turbine outlet', pressure: pTurbOut },
        { label: 'Injector inlet', pressure: pInj },
        { label: 'Chamber', pressure: pc },
      ],
      notes,
    };
  }

  if (inp.kind === 'gas-generator') {
    const pGG = pInj + loss;
    const gg = richGas(ox, fuel, pGG, inp.turbineInletTemperature, false);
    const wT = turbineWork(inp.turbineEfficiency, gg.cp, gg.T, gg.gamma, inp.ggPressureRatio);
    const pFu = fuelCools && coolantIn ? coolantIn : fuelDis(pInj);
    const pOx = oxCools && coolantIn ? coolantIn : oxDis(pInj);
    let mGG = 0;
    let pumps: PumpResult[] = [];
    for (let it = 0; it < 40; it++) {
      const mGGox = (mGG * gg.of) / (1 + gg.of);
      pumps = [pump(fuel, mFu + mGG - mGGox, pFu), pump(ox, mOx + mGGox, pOx)];
      mGG = pumps.reduce((s, q) => s + q.power, 0) / wT;
    }
    // Turbine exhaust expanded through a dump nozzle (pressure ratio 50).
    const tOut = gg.T - wT / gg.cp;
    const vEx = Math.sqrt(2 * gg.cp * tOut * (1 - Math.pow(1 / 50, (gg.gamma - 1) / gg.gamma)));
    const thrustVac = p.thrustVac + mGG * vEx;
    const total = p.massFlow + mGG;
    const ispVac = thrustVac / (total * G0);
    notes.push(`The gas generator burns ${((mGG / total) * 100).toFixed(1)} % of the propellant; dumping its exhaust costs ${(p.ispVac - ispVac).toFixed(1)} s of Isp.`);
    const power = mGG * wT;
    return {
      kind: inp.kind,
      closes: true,
      powerMargin: 0,
      pumps,
      turbines: [
        { label: 'GG turbine', gas: `Fuel-rich GG gas, O/F ${gg.of.toFixed(2)}`, massFlow: mGG, inletTemperature: gg.T, inletPressure: pGG, outletPressure: pGG / inp.ggPressureRatio, pressureRatio: inp.ggPressureRatio, power, available: power },
      ],
      combustors: [{ label: 'Gas generator', mixtureRatio: gg.of, temperature: gg.T, pressure: pGG, massFlow: mGG }],
      ispVac,
      thrustVac,
      totalMassFlow: total,
      coolantInletRequired: design.coolant ? (fuelCools ? fuelDis(pInj) : oxDis(pInj)) : null,
      pressureBudget: [
        { label: 'Fuel pump discharge', pressure: pFu },
        ...(fuelCools ? [{ label: 'Regen jacket outlet', pressure: design.thermal.outletPressure }] : []),
        { label: 'Injector inlet', pressure: pInj },
        { label: 'Chamber', pressure: pc },
        { label: 'GG turbine exhaust', pressure: pGG / inp.ggPressureRatio },
      ],
      notes,
    };
  }

  // ---------------- Staged combustion ----------------
  const pTurbOut = pInj + loss;
  const pbFactor = 1.15; // preburner injector pressure drop
  const turbines: TurbineResult[] = [];
  const combustors: CombustorResult[] = [];
  const pumps: PumpResult[] = [];
  const budget: { label: string; pressure: number }[] = [];
  let closes = true;
  let worstMargin = Infinity;

  /** One preburner + turbine that drives `drives` pumps; `richSide` propellant passes entirely through it. */
  const stage = (oxRich: boolean, drives: ('fuel' | 'ox')[]) => {
    const gas = richGas(ox, fuel, pTurbOut * 2, inp.turbineInletTemperature, oxRich);
    const mRich = oxRich ? mOx : mFu;
    const mBleed = oxRich ? mOx / gas.of : mFu * gas.of;
    const mT = mRich + mBleed;
    const avail = (pr: number) => mT * turbineWork(inp.turbineEfficiency, gas.cp, gas.T, gas.gamma, pr);
    const pumpsAt = (pr: number) => {
      const pPbIn = pTurbOut * pr * pbFactor;
      const list: PumpResult[] = [];
      for (const side of drives) {
        const isFuel = side === 'fuel';
        const richHere = isFuel ? !oxRich : oxRich;
        // The rich propellant feeds the preburner; the lean one feeds the main injector.
        const into = richHere ? pPbIn : pInj;
        list.push(pump(isFuel ? fuel : ox, isFuel ? mFu : mOx, isFuel ? fuelDis(into) : oxDis(into)));
      }
      // Kick pump for the lean-propellant bleed into the preburner.
      const lean = oxRich ? fuel : ox;
      list.push({ ...pump(lean, mBleed, pPbIn), propellant: `${lean.name} (preburner bleed)`, inletPressure: pInj, power: pumpPower(mBleed, pPbIn - pInj, lean.density, eta) });
      return list;
    };
    const required = (pr: number) => pumpsAt(pr).reduce((s, q) => s + q.power, 0);
    const pr = balancePressureRatio(avail, required);
    const label = oxRich ? 'Oxidizer-rich' : 'Fuel-rich';
    if (pr === null) {
      closes = false;
      // Report the best achievable margin over the scanned range.
      let best = -Infinity;
      for (let k = 1; k <= 120; k++) {
        const x = Math.exp((Math.log(60) * k) / 120);
        best = Math.max(best, avail(x) / required(x) - 1);
      }
      worstMargin = Math.min(worstMargin, best);
      notes.push(`${label} preburner gas at ${inp.turbineInletTemperature.toFixed(0)} K cannot drive its pumps at any turbine pressure ratio (best margin ${(best * 100).toFixed(0)} %).`);
      return;
    }
    worstMargin = Math.min(worstMargin, 0);
    const ps = pumpsAt(pr);
    pumps.push(...ps);
    const pPb = pTurbOut * pr;
    const power = required(pr);
    turbines.push({ label: `${label} turbine`, gas: `${label} preburner gas, O/F ${gas.of.toFixed(2)}`, massFlow: mT, inletTemperature: gas.T, inletPressure: pPb, outletPressure: pTurbOut, pressureRatio: pr, power, available: power });
    combustors.push({ label: `${label} preburner`, mixtureRatio: gas.of, temperature: gas.T, pressure: pPb, massFlow: mT });
    const richPump = ps[0];
    budget.push({ label: `${label}: pump discharge`, pressure: Math.max(...ps.map((q) => q.dischargePressure)) });
    budget.push({ label: `${label}: preburner`, pressure: pPb });
    if (!oxRich ? fuelCools : oxCools) checkCoolant(richPump.dischargePressure);
  };

  if (inp.kind === 'full-flow') {
    stage(false, ['fuel']);
    stage(true, ['ox']);
  } else {
    const oxRich = i.fuel === 'RP1'; // kerosene: oxidizer-rich to avoid preburner soot
    stage(oxRich, ['fuel', 'ox']);
  }
  budget.push({ label: 'Turbine outlet', pressure: pTurbOut }, { label: 'Injector inlet', pressure: pInj }, { label: 'Chamber', pressure: pc });
  if (closes) {
    const maxDis = Math.max(...pumps.map((q) => q.dischargePressure));
    notes.push(`Turbine pressure ratio ${turbines.map((t) => t.pressureRatio.toFixed(2)).join(' / ')}; highest pump discharge ${(maxDis / 1e5).toFixed(0)} bar; all propellant burns in the main chamber (no Isp loss).`);
  }
  return {
    ...base,
    closes,
    powerMargin: closes ? 0 : worstMargin,
    pumps,
    turbines,
    combustors,
    coolantInletRequired: coolantIn,
    pressureBudget: budget.sort((a, b) => b.pressure - a.pressure),
    notes,
  };
}

export const DEFAULT_CYCLE: CycleInputs = {
  kind: 'gas-generator',
  tankPressure: 3e5,
  pumpEfficiency: 0.7,
  turbineEfficiency: 0.65,
  turbineInletTemperature: 900,
  ggPressureRatio: 15,
  lineLoss: 0.05,
};
