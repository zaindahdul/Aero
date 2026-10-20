/**
 * End-to-end engine design: propellant chemistry -> sizing -> contour ->
 * nozzle flow (MoC + Euler, optional TOP optimization) -> regenerative
 * cooling and structural margins -> injector -> altitude performance.
 * Everything returned is plain data so it can cross a worker boundary.
 */
import { ambientPressure } from './atmosphere';
import { G0 } from './constants';
import { type CoolantId } from './fluids/fluids';
import { analyzeNozzle } from './nozzle/analysis';
import { type ChamberSpec, type ContourGeometry, type NozzleSpec, buildContour, sampleContour, wallPoint } from './nozzle/contour';
import { pressureRatio } from './nozzle/isentropic';
import { optimizeBell } from './nozzle/optimize';
import { MATERIALS } from './thermal/materials';
import { type GasStation, type ThermalResult, solveThermal } from './thermal/regen';
import { PROPELLANTS } from './thermo/propellants';
import { RocketExpansion, type Station, supersonicMachFromArea } from './thermo/rocket';
import { mixtureTransport } from './thermo/transport';
import { interp1 } from './math/linalg';

export interface EngineInputs {
  name: string;
  oxidizer: string;
  fuel: string;
  /** Oxidizer/fuel mass ratio. */
  of: number;
  /** Chamber pressure, Pa. */
  pc: number;
  /** Thrust target, N, at `thrustAmbient` (Pa; 0 for vacuum). */
  thrust: number;
  thrustAmbient: number;
  expansion: { mode: 'eps'; eps: number } | { mode: 'pe'; pe: number };
  frozen: boolean;
  cstarEfficiency: number;
  chamber: Omit<ChamberSpec, 'rt'>;
  nozzle: {
    kind: 'bell' | 'cone';
    lengthFraction: number;
    rcDownstream: number;
    halfAngle: number;
    optimize: boolean;
    thetaN: number;
    thetaE: number;
  };
  cooling: {
    /** Regenerative channel-wall chamber, or a radiation-cooled chamber and nozzle. */
    mode: 'regen' | 'radiative';
    coolantSide: 'fuel' | 'oxidizer';
    coolantFraction: number;
    inletTemperature: number;
    inletPressure: number;
    /** Regen jacket ends at this area ratio; beyond it the extension is radiation cooled. */
    regenAreaRatio: number;
    channels: number;
    maxChannelWidth: number;
    ribWidth: number;
    linerThickness: number;
    linerThicknessMax: number;
    linerSafetyFactor: number;
    channelHeightChamber: number;
    channelHeightThroat: number;
    channelHeightExit: number;
    jacketThickness: number;
    jacketSafetyFactor: number;
    roughness: number;
    linerMaterial: string;
    jacketMaterial: string;
    radiativeMaterial: string;
    radiativeThickness: number;
    wallEmissivity: number;
    bartzFactor: number;
    gasEmissivity: number;
    /**
     * Barrier (film) cooling: fraction of the total mass flow burning in a
     * fuel-rich wall layer at `barrierMixtureRatio`. 0 disables.
     */
    barrierFraction: number;
    barrierMixtureRatio: number;
  };
  injector: { pressureDropFraction: number; elements: number; dischargeCoefficient: number };
  numerics: { stations: number; mocResolution: number; eulerCells: number };
}

export interface StateSummary {
  T: number;
  P: number;
  rho: number;
  mw: number;
  h: number;
  s: number;
  cpEq: number;
  cpFr: number;
  gammaEq: number;
  gammaFr: number;
  a: number;
  u: number;
  mach: number;
  areaRatio: number;
  viscosity: number;
  conductivity: number;
  prandtl: number;
  moleFractions: [string, number][];
}

export interface FlowStation extends GasStation {
  rho: number;
}

export interface EngineDesign {
  inputs: EngineInputs;
  thermo: {
    chamber: StateSummary;
    throat: StateSummary;
    exit: StateSummary;
    frozen: boolean;
    coreMixtureRatio: number;
    barrierTemperature: number | null;
  };
  performance: {
    eps: number;
    pe: number;
    pcOverPe: number;
    gammaEffective: number;
    cstarIdeal: number;
    cstar: number;
    ispVacIdeal: number;
    ispVac: number;
    ispSeaLevel: number;
    ispAmbient: number;
    cfVacIdeal: number;
    cfVac: number;
    cfSeaLevel: number;
    nozzleEfficiency: number;
    nozzleEfficiencyMoc: number;
    dischargeCoefficient: number;
    thrustVac: number;
    thrustSeaLevel: number;
    thrustAmbient: number;
    massFlow: number;
    oxidizerFlow: number;
    fuelFlow: number;
    exitMach: number;
    separatedAtSeaLevel: boolean;
  };
  geometry: {
    contour: ContourGeometry;
    wall: { x: number[]; r: number[] };
    throatDiameter: number;
    chamberDiameter: number;
    exitDiameter: number;
    chamberLength: number;
    nozzleLength: number;
    totalLength: number;
  };
  stations: FlowStation[];
  nozzleFlow: {
    optimized: { thetaN: number; thetaE: number; history: { thetaN: number; thetaE: number; efficiency: number }[] } | null;
    shock: { x: number; r: number } | null;
    xStart: number;
    moc: {
      x: Float32Array;
      r: Float32Array;
      mach: Float32Array;
      parentPlus: Int32Array;
      parentMinus: Int32Array;
      triangles: Uint32Array;
      wallX: number[];
      wallP: number[];
      balanceError: number;
    };
    euler: {
      x: number[];
      rw: number[];
      mach: Float32Array[];
      wallX: number[];
      wallP: number[];
      exitR: number[];
      exitMach: number[];
      massDrift: number;
    } | null;
  };
  thermal: ThermalResult;
  coolant: CoolantId | null;
  injector: {
    pressureDrop: number;
    oxidizerOrificeDiameter: number;
    fuelOrificeDiameter: number;
    oxidizerVelocity: number;
    fuelVelocity: number;
    elements: number;
  };
  altitude: { altitude: number; pa: number; thrust: number; isp: number; separated: boolean }[];
  mass: { liner: number; jacket: number; extension: number; injector: number; total: number };
  /** Chamber acoustic modes (closed-closed cylinder, frozen sound speed) for stability screening. */
  acoustics: { soundSpeed: number; length: number; radius: number; modes: { name: string; frequency: number }[] };
  warnings: string[];
  timings: Record<string, number>;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function summarize(st: Station, areaRatio: number): StateSummary {
  const tr = mixtureTransport(st.moleFractions, st.T);
  const mf = Object.entries(st.moleFractions)
    .filter(([, x]) => x > 5e-6)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14);
  return {
    T: st.T,
    P: st.P,
    rho: st.rho,
    mw: st.mw,
    h: st.h,
    s: st.s,
    cpEq: st.cpEq,
    cpFr: st.cpFr,
    gammaEq: st.gammaEq,
    gammaFr: st.gammaFr,
    a: st.a,
    u: st.u,
    mach: st.mach,
    areaRatio,
    viscosity: tr.viscosity,
    conductivity: tr.conductivity,
    prandtl: tr.prandtl,
    moleFractions: mf,
  };
}

/** Perfect-gas gamma that reproduces the real exit pressure ratio at the design area ratio. */
export function effectiveGamma(eps: number, peOverPc: number): number {
  let lo = 1.04;
  let hi = 1.66;
  for (let i = 0; i < 60; i++) {
    const g = 0.5 * (lo + hi);
    const pr = pressureRatio(supersonicMachFromArea(eps, g), g);
    // Higher gamma -> lower exit pressure ratio at fixed area ratio.
    if (pr > peOverPc) lo = g;
    else hi = g;
  }
  return 0.5 * (lo + hi);
}

interface TableEntry {
  lnA: number;
  st: Station;
  cp: number;
  pr: number;
}

/** Flow states along the expansion, split into subsonic and supersonic branches. */
function expansionTable(ex: RocketExpansion, epsMax: number) {
  const throat = ex.throat();
  const sub: TableEntry[] = [];
  const sup: TableEntry[] = [];
  const entry = (st: Station): TableEntry => {
    const tr = mixtureTransport(st.moleFractions, st.T);
    return { lnA: Math.log(ex.areaRatio(st)), st, cp: st.cpFr, pr: tr.prandtl };
  };
  const lnRt = Math.log(ex.pc / throat.P);
  // Pressures from just below Pc to just above the throat, geometrically spaced in ln(Pc/P).
  for (let k = 0; k < 27; k++) {
    const lnR = 1e-5 * Math.pow(lnRt / 1e-5, k / 27);
    sub.push(entry(ex.at(ex.pc * Math.exp(-lnR))));
  }
  sub.push({ ...entry(throat), lnA: 0 });
  sub.reverse(); // ascending lnA: throat -> chamber
  const exit = ex.exitForAreaRatio(epsMax * 1.02);
  const lnPe = Math.log(exit.P);
  const lnPt = Math.log(throat.P);
  sup.push({ ...entry(throat), lnA: 0 });
  for (let k = 1; k <= 45; k++) sup.push(entry(ex.at(Math.exp(lnPt + ((lnPe - lnPt) * k) / 45))));
  return { sub, sup };
}

function stationFrom(table: TableEntry[], lnA: number) {
  const xs = table.map((e) => e.lnA);
  const pick = (f: (e: TableEntry) => number) => interp1(xs, table.map(f), lnA);
  return {
    T: pick((e) => e.st.T),
    P: Math.exp(pick((e) => Math.log(e.st.P))),
    M: pick((e) => e.st.mach),
    u: pick((e) => e.st.u),
    gamma: pick((e) => e.st.gamma),
    cp: pick((e) => e.cp),
    prandtl: pick((e) => e.pr),
    rho: Math.exp(pick((e) => Math.log(e.st.rho))),
  };
}

export function designEngine(inputs: EngineInputs): EngineDesign {
  const t0 = now();
  const timings: Record<string, number> = {};
  const warnings: string[] = [];
  const ox = PROPELLANTS[inputs.oxidizer];
  const fuel = PROPELLANTS[inputs.fuel];
  if (!ox || !fuel) throw new Error('unknown propellant');

  // ---- Thermochemistry (core stream + optional fuel-rich barrier layer) ----
  const psi = inputs.cooling.barrierFraction;
  let coreOF = inputs.of;
  if (psi > 0) {
    const ofB = inputs.cooling.barrierMixtureRatio;
    const oxCore = inputs.of / (1 + inputs.of) - (psi * ofB) / (1 + ofB);
    coreOF = oxCore / (1 - psi - oxCore);
    if (!(coreOF > 0) || ofB >= inputs.of) throw new Error('Barrier layer must be fuel-rich relative to the overall mixture ratio.');
  }
  const ex = new RocketExpansion(ox, fuel, coreOF, inputs.pc, inputs.frozen);
  const eps = inputs.expansion.mode === 'eps' ? inputs.expansion.eps : ex.optimumAreaRatio(inputs.expansion.pe);
  if (eps < 1.5) throw new Error('Expansion ratio must exceed 1.5 (exit pressure too close to chamber pressure).');
  const core = ex.solve(eps);
  const barrier = psi > 0 ? new RocketExpansion(ox, fuel, inputs.cooling.barrierMixtureRatio, inputs.pc, inputs.frozen).solve(eps) : null;
  // Two-stream (unmixed) performance: mass-weighted Isp and c*.
  const mixIdeal = (a: number, b: number | undefined) => (barrier ? (1 - psi) * a + psi * (b as number) : a);
  const ideal = {
    chamber: core.chamber,
    throat: core.throat,
    exit: core.exit,
    pcOverPe: core.pcOverPe,
    cstar: mixIdeal(core.cstar, barrier?.cstar),
    ispVac: mixIdeal(core.ispVac, barrier?.ispVac),
    cfVac: 0,
  };
  ideal.cfVac = (ideal.ispVac * G0) / ideal.cstar;
  const recoveryScale = barrier ? barrier.chamber.T / core.chamber.T : 1;
  const gammaEff = effectiveGamma(eps, core.exit.P / inputs.pc);
  timings.thermo = now() - t0;

  // ---- Nozzle contour shape (scale-free) and flow efficiency ----
  const t1 = now();
  const chamberN: ChamberSpec = { rt: 1, ...inputs.chamber };
  let optimized: EngineDesign['nozzleFlow']['optimized'] = null;
  let nozzleSpec: NozzleSpec;
  if (inputs.nozzle.kind === 'bell') {
    let { thetaN, thetaE } = inputs.nozzle;
    if (inputs.nozzle.optimize) {
      const o = optimizeBell(
        chamberN,
        { eps, rcDownstream: inputs.nozzle.rcDownstream, lengthFraction: inputs.nozzle.lengthFraction },
        gammaEff,
        Math.min(32, inputs.numerics.mocResolution),
      );
      thetaN = o.thetaN;
      thetaE = o.thetaE;
      optimized = { thetaN, thetaE, history: o.history };
    }
    nozzleSpec = { kind: 'bell', eps, rcDownstream: inputs.nozzle.rcDownstream, lengthFraction: inputs.nozzle.lengthFraction, thetaN, thetaE };
  } else {
    nozzleSpec = { kind: 'cone', eps, rcDownstream: inputs.nozzle.rcDownstream, halfAngle: inputs.nozzle.halfAngle };
  }
  const flow = analyzeNozzle(buildContour(chamberN, nozzleSpec), gammaEff, inputs.numerics.mocResolution, inputs.numerics.eulerCells);
  timings.nozzle = now() - t1;
  const etaN = flow.efficiency;
  const cd = flow.dischargeCoefficient;

  // ---- Sizing: F = At [Cd eta_n Cf_vac Pc - pa eps] ----
  const cfVac = cd * etaN * ideal.cfVac;
  const at = inputs.thrust / (inputs.pc * cfVac - inputs.thrustAmbient * eps);
  if (!(at > 0)) {
    throw new Error('Thrust target is not achievable: at this ambient pressure the nozzle is so over-expanded that it produces no net thrust. Reduce the area ratio or rate the thrust in vacuum.');
  }
  const rt = Math.sqrt(at / Math.PI);
  const cstar = inputs.cstarEfficiency * ideal.cstar;
  const massFlow = (cd * inputs.pc * at) / cstar;
  const ispVac = inputs.cstarEfficiency * etaN * ideal.ispVac;
  const thrustVac = cfVac * inputs.pc * at;
  const thrustAt = (pa: number) => thrustVac - pa * eps * at;
  const oxidizerFlow = (massFlow * inputs.of) / (1 + inputs.of);
  const fuelFlow = massFlow - oxidizerFlow;
  const exitMach = ideal.exit.mach;
  const separated = (pa: number) => pa > 0 && ideal.exit.P / pa < Math.pow(1.88 * exitMach - 1, -0.64);

  const contour = buildContour({ ...chamberN, rt }, nozzleSpec);
  warnings.push(...contour.warnings);
  const wallSamples = sampleContour(contour, 400);

  // ---- Flow states at wall stations ----
  const table = expansionTable(ex, eps);
  const stations: FlowStation[] = sampleContour(contour, inputs.numerics.stations).map((c) => {
    const lnA = Math.log(Math.max(1, c.areaRatio));
    const s = stationFrom(c.supersonic ? table.sup : table.sub, lnA);
    return { x: c.x, r: c.r, s: c.s, areaRatio: c.areaRatio, supersonic: c.supersonic, ...s };
  });

  // ---- Cooling and structure ----
  const t2 = now();
  let coolant: CoolantId | null = null;
  const cool = inputs.cooling;
  let regenEndX = contour.xExit;
  if (cool.mode === 'regen' && cool.regenAreaRatio < eps) {
    const target = rt * Math.sqrt(cool.regenAreaRatio);
    let lo = 0;
    let hi = contour.xExit;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (wallPoint(contour, mid).r < target) lo = mid;
      else hi = mid;
    }
    regenEndX = 0.5 * (lo + hi);
  }
  const coolProp = cool.coolantSide === 'fuel' ? fuel : ox;
  if (cool.mode === 'regen') {
    coolant = coolProp.coolant ?? null;
    if (!coolant) warnings.push(`${coolProp.name} has no coolant property model; analysed as radiation cooled.`);
  }
  const chamberTr = mixtureTransport(ideal.chamber.moleFractions, ideal.chamber.T);
  const thermal: ThermalResult = solveThermal(
    stations,
    {
      T0: ideal.chamber.T,
      pc: inputs.pc,
      cstar,
      cp0: ideal.chamber.cpFr,
      mu0: chamberTr.viscosity,
      pr0: chamberTr.prandtl,
      rt,
      rcThroat: 0.5 * (inputs.chamber.rcUpstream + inputs.nozzle.rcDownstream) * rt,
      emissivity: cool.gasEmissivity,
      recoveryScale,
    },
    {
      bartzFactor: cool.bartzFactor,
      regen: coolant
        ? {
            coolant,
            massFlow: cool.coolantFraction * (cool.coolantSide === 'fuel' ? fuelFlow : oxidizerFlow),
            inletTemperature: cool.inletTemperature,
            inletPressure: cool.inletPressure,
            channels: cool.channels,
            maxChannelWidth: cool.maxChannelWidth,
            ribWidth: cool.ribWidth,
            linerThickness: cool.linerThickness,
            linerThicknessMax: cool.linerThicknessMax,
            linerSafetyFactor: cool.linerSafetyFactor,
            channelHeight: { chamber: cool.channelHeightChamber, throat: cool.channelHeightThroat, exit: cool.channelHeightExit },
            jacketThickness: cool.jacketThickness,
            jacketSafetyFactor: cool.jacketSafetyFactor,
            roughness: cool.roughness,
            liner: MATERIALS[cool.linerMaterial],
            jacket: MATERIALS[cool.jacketMaterial],
            regenEndX,
          }
        : null,
      radiative: {
        material: MATERIALS[cool.radiativeMaterial],
        thickness: cool.radiativeThickness,
        emissivity: cool.wallEmissivity,
        environmentTemperature: 290,
      },
    },
  );
  warnings.push(...thermal.warnings);
  if (coolant) {
    const injectorInlet = inputs.pc * (1 + inputs.injector.pressureDropFraction);
    if (thermal.outletPressure < injectorInlet) {
      warnings.push(
        `Coolant reaches the injector at ${(thermal.outletPressure / 1e5).toFixed(1)} bar, below the ${(injectorInlet / 1e5).toFixed(1)} bar it needs.`,
      );
    }
  }
  timings.thermal = now() - t2;

  // ---- Injector ----
  const dp = inputs.injector.pressureDropFraction * inputs.pc;
  const cdi = inputs.injector.dischargeCoefficient;
  const nEl = Math.max(1, Math.round(inputs.injector.elements));
  const orifice = (mdot: number, rho: number) => Math.sqrt((4 * (mdot / (cdi * Math.sqrt(2 * rho * dp)))) / (Math.PI * nEl));
  const injector = {
    pressureDrop: dp,
    oxidizerOrificeDiameter: orifice(oxidizerFlow, ox.density),
    fuelOrificeDiameter: orifice(fuelFlow, fuel.density),
    oxidizerVelocity: cdi * Math.sqrt((2 * dp) / ox.density),
    fuelVelocity: cdi * Math.sqrt((2 * dp) / fuel.density),
    elements: nEl,
  };

  // ---- Altitude performance ----
  const altitude: EngineDesign['altitude'] = [];
  for (let z = 0; z <= 80000; z += 2000) {
    const pa = ambientPressure(z);
    const F = thrustAt(pa);
    altitude.push({ altitude: z, pa, thrust: F, isp: F / (massFlow * G0), separated: separated(pa) });
  }
  if (separated(101325)) warnings.push('Nozzle flow separates at sea level (Schmucker criterion): use for altitude/vacuum only.');

  const injectorMass = Math.PI * contour.rc * contour.rc * 0.15 * contour.rc * MATERIALS.SS316L.density;
  const mass = {
    liner: thermal.linerMass,
    jacket: thermal.jacketMass,
    extension: thermal.extensionMass,
    injector: injectorMass,
    total: thermal.linerMass + thermal.jacketMass + thermal.extensionMass + injectorMass,
  };

  const acoustics = chamberAcoustics(ideal.chamber.aFr, -contour.xInjector, contour.rc);

  const sl = 101325;
  const design: EngineDesign = {
    inputs,
    thermo: {
      chamber: summarize(ideal.chamber, inputs.chamber.contractionRatio),
      throat: summarize(ideal.throat, 1),
      exit: summarize(ideal.exit, eps),
      frozen: inputs.frozen,
      coreMixtureRatio: coreOF,
      barrierTemperature: barrier ? barrier.chamber.T : null,
    },
    performance: {
      eps,
      pe: ideal.exit.P,
      pcOverPe: ideal.pcOverPe,
      gammaEffective: gammaEff,
      cstarIdeal: ideal.cstar,
      cstar,
      ispVacIdeal: ideal.ispVac,
      ispVac,
      ispSeaLevel: thrustAt(sl) / (massFlow * G0),
      ispAmbient: thrustAt(inputs.thrustAmbient) / (massFlow * G0),
      cfVacIdeal: ideal.cfVac,
      cfVac,
      cfSeaLevel: thrustAt(sl) / (inputs.pc * at),
      nozzleEfficiency: etaN,
      nozzleEfficiencyMoc: flow.efficiencyMoc,
      dischargeCoefficient: cd,
      thrustVac,
      thrustSeaLevel: thrustAt(sl),
      thrustAmbient: thrustAt(inputs.thrustAmbient),
      massFlow,
      oxidizerFlow,
      fuelFlow,
      exitMach,
      separatedAtSeaLevel: separated(sl),
    },
    geometry: {
      contour,
      wall: { x: wallSamples.map((s) => s.x), r: wallSamples.map((s) => s.r) },
      throatDiameter: 2 * rt,
      chamberDiameter: 2 * contour.rc,
      exitDiameter: 2 * contour.re,
      chamberLength: -contour.xInjector,
      nozzleLength: contour.xExit,
      totalLength: contour.xExit - contour.xInjector,
    },
    stations,
    nozzleFlow: {
      optimized,
      shock: flow.moc.shock,
      xStart: flow.xStart,
      moc: {
        x: Float32Array.from(flow.moc.x),
        r: Float32Array.from(flow.moc.r),
        mach: Float32Array.from(flow.moc.mach),
        parentPlus: flow.moc.parentPlus,
        parentMinus: flow.moc.parentMinus,
        triangles: flow.moc.triangles,
        wallX: flow.moc.wall.x,
        wallP: flow.moc.wall.pressure,
        balanceError: flow.moc.balanceError,
      },
      euler: flow.euler
        ? {
            x: flow.euler.field.x,
            rw: flow.euler.field.rw,
            mach: flow.euler.field.mach,
            wallX: flow.euler.wall.x,
            wallP: flow.euler.wall.pressure,
            exitR: flow.euler.exit.r,
            exitMach: flow.euler.exit.mach,
            massDrift: flow.euler.massDrift,
          }
        : null,
    },
    thermal,
    coolant,
    injector,
    altitude,
    mass,
    acoustics,
    warnings,
    timings,
  };
  timings.total = now() - t0;
  return design;
}

/**
 * Acoustic resonances of the combustion chamber modelled as a closed cylinder
 * (injector face to throat): f = (a / 2) sqrt((n / L)^2 + (alpha_mn / (pi R))^2),
 * with alpha_mn the roots of J'_m (transverse modes). High-frequency
 * instability usually couples to the first tangential mode.
 */
export function chamberAcoustics(a: number, length: number, radius: number) {
  const transverse: [string, number][] = [
    ['1T', 1.8412],
    ['2T', 3.0542],
    ['1R', 3.8317],
    ['3T', 4.2012],
  ];
  const modes: { name: string; frequency: number }[] = [
    { name: '1L', frequency: a / (2 * length) },
    { name: '2L', frequency: a / length },
  ];
  for (const [name, alpha] of transverse) modes.push({ name, frequency: (alpha * a) / (2 * Math.PI * radius) });
  const f1T = modes[2].frequency;
  modes.push({ name: '1T1L', frequency: Math.hypot(f1T, modes[0].frequency) });
  modes.sort((x, y) => x.frequency - y.frequency);
  return { soundSpeed: a, length, radius, modes };
}

/** Ideal performance across mixture ratios at fixed chamber pressure and area ratio. */
export function mixtureRatioSweep(oxidizer: string, fuel: string, pc: number, eps: number, frozen: boolean, ofMin: number, ofMax: number, n = 36) {
  const ox = PROPELLANTS[oxidizer];
  const fu = PROPELLANTS[fuel];
  const out: { of: number; ispVac: number; ispSeaLevel: number; cstar: number; Tc: number; mw: number }[] = [];
  for (let i = 0; i < n; i++) {
    const of = ofMin + ((ofMax - ofMin) * i) / (n - 1);
    try {
      const s = new RocketExpansion(ox, fu, of, pc, frozen).solve(eps);
      out.push({
        of,
        ispVac: s.ispVac,
        ispSeaLevel: s.ispVac - (101325 * eps * s.cstar) / (pc * G0),
        cstar: s.cstar,
        Tc: s.chamber.T,
        mw: s.chamber.mw,
      });
    } catch {
      // Skip mixture ratios where equilibrium cannot be established (e.g. extreme fuel-rich soot regions).
    }
  }
  return out;
}
