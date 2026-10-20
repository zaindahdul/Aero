/**
 * Thrust-chamber thermal and structural analysis.
 *
 * Regenerative section (channel-wall construction), marched counterflow from
 * the coolant inlet manifold toward the injector:
 *   Gas side:   Bartz (1957) correlation with the sigma property correction and
 *               adiabatic-wall (recovery) temperature, r = Pr^(1/3); optional
 *               gray-gas chamber radiation.
 *   Wall:       radial conduction through the liner, k(T).
 *   Coolant:    Dittus-Boelter with a Sieder-Tate viscosity correction
 *               (hydrogen: wall/bulk temperature-ratio correction, McCarthy &
 *               Wolf); ribs treated as fins of efficiency tanh(mL)/(mL).
 *   Channels:   bifurcate (count doubles) wherever the width would exceed the
 *               maximum, as in production regenerative nozzles.
 *   Hydraulics: Colebrook friction factor with wall roughness + flow acceleration.
 *   Energy:     coolant enthalpy rise integrated exactly, T recovered from h(T, P).
 *   Structure:  liner bending over the channel span (fixed-fixed plate),
 *               through-wall thermal stress, closeout jacket auto-sized in
 *               thickness for a target hoop-stress safety factor.
 *
 * Radiation-cooled section (nozzle extension, or the whole chamber of a
 * radiatively cooled engine): wall temperature from the radiation-equilibrium
 * balance h_g (T_aw - T_w) = eps sigma (T_w^4 - T_env^4).
 */
import { SIGMA_SB } from '../constants';
import { type CoolantId, getFluid } from '../fluids/fluids';
import { type Material, materialProps } from './materials';

export interface GasStation {
  x: number;
  r: number;
  s: number;
  areaRatio: number;
  supersonic: boolean;
  /** Static temperature and pressure, Mach number, velocity. */
  T: number;
  P: number;
  M: number;
  u: number;
  gamma: number;
  /** Frozen specific heat and Prandtl number at the local state. */
  cp: number;
  prandtl: number;
}

export interface HotGasReference {
  T0: number;
  pc: number;
  cstar: number;
  /** Frozen properties at chamber conditions. */
  cp0: number;
  mu0: number;
  pr0: number;
  rt: number;
  /** Mean throat radius of curvature, m. */
  rcThroat: number;
  /** Gas emissivity for chamber radiation (0 disables). */
  emissivity: number;
  /** Near-wall total-temperature ratio from barrier cooling (1 = none). */
  recoveryScale: number;
}

export interface RegenSpec {
  coolant: CoolantId;
  massFlow: number;
  inletTemperature: number;
  inletPressure: number;
  /** Channel count at the throat; doubles outward as needed. */
  channels: number;
  maxChannelWidth: number;
  ribWidth: number;
  /** Minimum liner (hot-wall) thickness; thickened locally up to linerThicknessMax for linerSafetyFactor. */
  linerThickness: number;
  linerThicknessMax: number;
  linerSafetyFactor: number;
  /** Channel heights at the chamber, throat and nozzle exit, m. */
  channelHeight: { chamber: number; throat: number; exit: number };
  /** Minimum closeout thickness; thickened locally to reach jacketSafetyFactor. */
  jacketThickness: number;
  jacketSafetyFactor: number;
  roughness: number;
  liner: Material;
  jacket: Material;
  /** Stations with x beyond this are radiation cooled (nozzle extension). */
  regenEndX: number;
}

export interface RadiativeSpec {
  material: Material;
  thickness: number;
  emissivity: number;
  environmentTemperature: number;
}

export interface ThermalSpec {
  /** Multiplier on the Bartz coefficient (calibration knob, e.g. for carbon deposits). */
  bartzFactor: number;
  regen: RegenSpec | null;
  radiative: RadiativeSpec;
}

export interface ThermalStation {
  x: number;
  r: number;
  cooled: boolean;
  hg: number;
  hc: number;
  q: number;
  qRad: number;
  Taw: number;
  Twg: number;
  Twc: number;
  Tcool: number;
  Pcool: number;
  rhoCool: number;
  velocity: number;
  reynolds: number;
  channels: number;
  channelWidth: number;
  channelHeight: number;
  linerThickness: number;
  jacketThickness: number;
  finEfficiency: number;
  pGas: number;
  /** Stresses, Pa, and safety factors against yield at temperature. */
  sigmaBending: number;
  sigmaThermal: number;
  sigmaJacket: number;
  liningSF: number;
  jacketSF: number;
  /** Thermal strain over yield strain (> 1 means cyclic plasticity / low-cycle fatigue). */
  thermalStrainRatio: number;
  /** Material limit temperature at this station. */
  limitTemperature: number;
}

export interface ThermalResult {
  stations: ThermalStation[];
  maxWallTemperature: number;
  maxWallTemperatureX: number;
  /** Peak wall temperature as a fraction of the local material limit. */
  maxTemperatureRatio: number;
  maxHeatFlux: number;
  outletTemperature: number;
  outletPressure: number;
  pressureDrop: number;
  heatLoad: number;
  minLiningSF: number;
  minJacketSF: number;
  minChannelWidth: number;
  maxCoolantVelocity: number;
  bifurcations: number[];
  regenEndX: number;
  linerMass: number;
  jacketMass: number;
  extensionMass: number;
  warnings: string[];
}

/** Darcy friction factor (Colebrook-White), laminar below Re 2300. */
export function frictionFactor(re: number, relRough: number): number {
  if (re < 2300) return 64 / Math.max(re, 1);
  let f = Math.pow(-1.8 * Math.log10(Math.pow(relRough / 3.7, 1.11) + 6.9 / re), -2);
  for (let i = 0; i < 30; i++) {
    const next = Math.pow(-2 * Math.log10(relRough / 3.7 + 2.51 / (re * Math.sqrt(f))), -2);
    if (Math.abs(next - f) < 1e-12) break;
    f = next;
  }
  return f;
}

/** Bartz convective coefficient, W/(m^2 K). */
export function bartz(ref: HotGasReference, st: GasStation, Twg: number): number {
  const omega = 0.6;
  const dt = 2 * ref.rt;
  const c =
    (0.026 / Math.pow(dt, 0.2)) *
    ((Math.pow(ref.mu0, 0.2) * ref.cp0) / Math.pow(ref.pr0, 0.6)) *
    Math.pow(ref.pc / ref.cstar, 0.8) *
    Math.pow(dt / ref.rcThroat, 0.1);
  const g = 1 + 0.5 * (st.gamma - 1) * st.M * st.M;
  const sigma = 1 / (Math.pow(0.5 * (Twg / ref.T0) * g + 0.5, 0.8 - omega / 5) * Math.pow(g, omega / 5));
  return c * Math.pow(1 / st.areaRatio, 0.9) * sigma;
}

const recoveryTemperature = (st: GasStation, ref: HotGasReference) =>
  ref.recoveryScale * (st.T + (Math.pow(st.prandtl, 1 / 3) * st.u * st.u) / (2 * st.cp));

export function solveThermal(stations: GasStation[], ref: HotGasReference, spec: ThermalSpec): ThermalResult {
  const warnings = new Set<string>();
  const n = stations.length;
  const out: ThermalStation[] = new Array(n);
  const regen = spec.regen;
  const regenEndX = regen ? Math.min(regen.regenEndX, stations[n - 1].x) : -Infinity;
  let iInlet = -1;
  for (let i = 0; i < n; i++) if (stations[i].x <= regenEndX + 1e-12) iInlet = i;

  // ---------------- Radiation-cooled stations ----------------
  let extensionVolume = 0;
  const rad = spec.radiative;
  for (let i = iInlet + 1; i < n; i++) {
    const st = stations[i];
    const Taw = recoveryTemperature(st, ref);
    const qOut = (T: number) => rad.emissivity * SIGMA_SB * (Math.pow(T, 4) - Math.pow(rad.environmentTemperature, 4));
    let lo = rad.environmentTemperature;
    let hi = Taw;
    let hg = 0;
    for (let k = 0; k < 80; k++) {
      const Tm = 0.5 * (lo + hi);
      hg = spec.bartzFactor * bartz(ref, st, Tm);
      if (hg * (Taw - Tm) > qOut(Tm)) lo = Tm;
      else hi = Tm;
    }
    const Tw = 0.5 * (lo + hi);
    const q = hg * (Taw - Tw);
    const mat = materialProps(rad.material, Tw);
    const sigmaHoop = (st.P * st.r) / rad.thickness;
    out[i] = {
      x: st.x,
      r: st.r,
      cooled: false,
      hg,
      hc: 0,
      q,
      qRad: 0,
      Taw,
      Twg: Tw,
      Twc: Tw,
      Tcool: NaN,
      Pcool: NaN,
      rhoCool: NaN,
      velocity: NaN,
      reynolds: NaN,
      channels: 0,
      channelWidth: NaN,
      channelHeight: NaN,
      linerThickness: rad.thickness,
      jacketThickness: 0,
      finEfficiency: NaN,
      pGas: st.P,
      sigmaBending: sigmaHoop,
      sigmaThermal: 0,
      sigmaJacket: 0,
      liningSF: mat.yieldStrength / Math.max(sigmaHoop, 1),
      jacketSF: Infinity,
      thermalStrainRatio: 0,
      limitTemperature: rad.material.maxTemperature,
    };
    if (i > 0) extensionVolume += 2 * Math.PI * st.r * rad.thickness * Math.abs(st.s - stations[i - 1].s);
  }

  // ---------------- Regenerative stations ----------------
  let heatLoad = 0;
  let linerVolume = 0;
  let jacketVolume = 0;
  const bifurcations: number[] = [];
  let T = regen?.inletTemperature ?? NaN;
  let P = regen?.inletPressure ?? NaN;
  if (regen && iInlet >= 0) {
    const fluid = getFluid(regen.coolant);
    const xStart = stations[0].x;
    const chamberEnd = stations.find((s) => s.areaRatio < 0.98 * stations[0].areaRatio)?.x ?? xStart;
    const channelHeightAt = (x: number) => {
      const { chamber, throat, exit } = regen.channelHeight;
      if (x <= chamberEnd) return chamber;
      if (x <= 0) return chamber + ((x - chamberEnd) / (0 - chamberEnd || 1)) * (throat - chamber);
      return throat + (x / (stations[iInlet].x || 1)) * (exit - throat);
    };
    let h = fluid.state(T, P).h;
    let Twg = 0.5 * (stations[iInlet].T + T);
    let Twc = T + 20;
    let lastChannels = -1;

    for (let i = iInlet; i >= 0; i--) {
      const st = stations[i];
      const rg = st.r;
      const hCh = channelHeightAt(st.x);
      const Taw = recoveryTemperature(st, ref);
      // Gray-gas radiation (H2O/CO2 bands), significant only in the chamber.
      const qRadFor = (twall: number) => (st.supersonic ? 0 : ref.emissivity * SIGMA_SB * (Math.pow(st.T, 4) - Math.pow(twall, 4)));
      const bulk = fluid.state(T, P);
      const dP = Math.max(0, P - st.P);

      // The liner is thickened (up to its maximum) until the channel-span
      // bending stress meets the target safety factor; thickness feeds back on
      // the wall temperature and therefore on the yield strength.
      let tw = regen.linerThickness;
      let N = regen.channels;
      let w = 0;
      let pitchGas = 0;
      let dh = 0;
      let G = 0;
      let V = 0;
      let re = 0;
      let hg = 0;
      let hc = 0;
      let q = 0;
      let qRad = 0;
      let etaF = 1;
      let mat = materialProps(regen.liner, 0.5 * (Twg + Twc));
      for (let pass = 0; pass < 8; pass++) {
        N = regen.channels;
        while ((2 * Math.PI * (rg + tw)) / N - regen.ribWidth > regen.maxChannelWidth) N *= 2;
        const pitchBottom = (2 * Math.PI * (rg + tw)) / N;
        w = Math.max(1e-4, pitchBottom - regen.ribWidth);
        pitchGas = (2 * Math.PI * rg) / N;
        const area = N * w * hCh;
        dh = (2 * w * hCh) / (w + hCh);
        G = regen.massFlow / area;
        V = G / bulk.rho;
        re = (G * dh) / bulk.mu;
        for (let it = 0; it < 80; it++) {
          hg = spec.bartzFactor * bartz(ref, st, Twg);
          const kw = materialProps(regen.liner, 0.5 * (Twg + Twc)).conductivity;
          const wallState = fluid.state(Twc, P);
          let nu = 0.023 * Math.pow(re, 0.8) * Math.pow(bulk.prandtl, 0.4);
          nu *= regen.coolant === 'hydrogen' ? Math.pow(T / Twc, 0.55) : Math.pow(bulk.mu / wallState.mu, 0.14);
          nu = Math.max(nu, 4.36);
          hc = (nu * bulk.k) / dh;
          const mFin = Math.sqrt((2 * hc) / (kw * regen.ribWidth));
          etaF = Math.tanh(mFin * hCh) / (mFin * hCh);
          const hcEff = (hc * (w + 2 * etaF * hCh)) / pitchGas;
          const rWall = (rg * Math.log(1 + tw / rg)) / kw;
          qRad = qRadFor(Twg);
          // Convective + radiative load through the series wall + coolant resistance.
          const R = rWall + 1 / hcEff;
          const qConv = (Taw - T - qRad * R) / (1 / hg + R);
          q = qConv + qRad;
          const newTwg = Taw - qConv / hg;
          const newTwc = T + q / hcEff;
          const dT = Math.abs(newTwg - Twg) + Math.abs(newTwc - Twc);
          Twg += 0.6 * (newTwg - Twg);
          Twc += 0.6 * (newTwc - Twc);
          if (dT < 1e-3) break;
        }
        mat = materialProps(regen.liner, 0.5 * (Twg + Twc));
        const need = w * Math.sqrt((regen.linerSafetyFactor * dP) / (2 * mat.yieldStrength));
        const next = Math.min(regen.linerThicknessMax, Math.max(regen.linerThickness, need));
        if (Math.abs(next - tw) < 2e-6) break;
        tw = next;
      }
      if (lastChannels > 0 && N !== lastChannels) bifurcations.push(st.x);
      lastChannels = N;
      if (w < 5e-4) warnings.add('Channel width falls below 0.5 mm: reduce channel count or rib width.');

      // Structural margins; the closeout is thickened to the target hoop SF.
      const sigmaBending = 0.5 * dP * Math.pow(w / tw, 2);
      const sigmaThermal = (mat.modulus * mat.expansion * (Twg - Twc)) / (2 * (1 - regen.liner.poisson));
      const rj = rg + tw + hCh;
      const jy = materialProps(regen.jacket, T).yieldStrength;
      const tj = Math.max(regen.jacketThickness, (regen.jacketSafetyFactor * P * rj) / (jy - 0.5 * regen.jacketSafetyFactor * P));
      const sigmaJacket = (P * (rj + 0.5 * tj)) / tj;

      out[i] = {
        x: st.x,
        r: rg,
        cooled: true,
        hg,
        hc,
        q,
        qRad,
        Taw,
        Twg,
        Twc,
        Tcool: T,
        Pcool: P,
        rhoCool: bulk.rho,
        velocity: V,
        reynolds: re,
        channels: N,
        channelWidth: w,
        channelHeight: hCh,
        linerThickness: tw,
        jacketThickness: tj,
        finEfficiency: etaF,
        pGas: st.P,
        sigmaBending,
        sigmaThermal,
        sigmaJacket,
        liningSF: mat.yieldStrength / Math.max(sigmaBending, 1),
        jacketSF: jy / sigmaJacket,
        thermalStrainRatio: sigmaThermal / mat.yieldStrength,
        limitTemperature: regen.liner.maxTemperature,
      };

      // Advance the coolant to the next station upstream.
      if (i > 0) {
        const prev = stations[i - 1];
        const ds = Math.abs(st.s - prev.s);
        const rMid = 0.5 * (st.r + prev.r);
        const dQ = q * 2 * Math.PI * rMid * ds;
        heatLoad += dQ;
        h += dQ / regen.massFlow;
        const f = frictionFactor(re, regen.roughness / dh);
        const dpFriction = (f * ds * G * G) / (2 * dh * bulk.rho);
        const pNext = Math.max(1e4, P - dpFriction);
        const rhoNext = fluid.state(fluid.temperatureFromEnthalpy(h, pNext), pNext).rho;
        const dpAccel = Math.max(0, G * G * (1 / rhoNext - 1 / bulk.rho));
        P -= dpFriction + dpAccel;
        if (P <= 1e4) {
          warnings.add('Coolant pressure is exhausted before the injector: raise inlet pressure or enlarge channels.');
          P = 1e4;
        }
        T = fluid.temperatureFromEnthalpy(h, P);
        linerVolume += (Math.PI * ((rg + tw + hCh) ** 2 - rg * rg) - N * w * hCh) * ds;
        jacketVolume += 2 * Math.PI * (rj + 0.5 * tj) * tj * ds;
      }
    }
    if (T >= fluid.tmax - 1) warnings.add('Coolant temperature left the property table range; results are extrapolated.');
    for (const s of out) {
      if (!s?.cooled) continue;
      const tsat = fluid.saturationTemperature(s.Pcool);
      if (tsat !== null && s.Tcool > tsat - 2) {
        warnings.add('Coolant is subcritical and reaches saturation: boiling risk (two-phase flow not modeled).');
        break;
      }
    }
    if (regen.coolant === 'rp1' && out.some((s) => s?.cooled && s.Twc > 560)) {
      warnings.add('RP-1 wetted-wall temperature exceeds ~560 K: coking deposits likely.');
    }
  }

  // ---------------- Diagnostics ----------------
  let maxT = 0;
  let maxX = 0;
  let maxRatio = 0;
  let maxQ = 0;
  let minSF = Infinity;
  let minJ = Infinity;
  let minW = Infinity;
  let maxV = 0;
  for (const s of out) {
    if (s.Twg > maxT) {
      maxT = s.Twg;
      maxX = s.x;
    }
    maxRatio = Math.max(maxRatio, s.Twg / s.limitTemperature);
    maxQ = Math.max(maxQ, s.q);
    minSF = Math.min(minSF, s.liningSF);
    minJ = Math.min(minJ, s.jacketSF);
    if (s.cooled) {
      minW = Math.min(minW, s.channelWidth);
      maxV = Math.max(maxV, s.velocity);
    }
  }
  for (const cooled of [true, false]) {
    const hot = out.filter((s) => s.cooled === cooled && s.Twg > s.limitTemperature);
    if (!hot.length) continue;
    const mat = cooled ? regen!.liner : rad.material;
    const peak = Math.max(...hot.map((s) => s.Twg));
    const where = cooled ? 'Regen liner' : 'Radiation-cooled wall';
    warnings.add(`${where} exceeds the ${mat.name} limit (${mat.maxTemperature} K): peak ${peak.toFixed(0)} K.`);
  }
  if (minSF < 1.25) warnings.add('Wall pressure-stress safety factor below 1.25.');

  return {
    stations: out,
    maxWallTemperature: maxT,
    maxWallTemperatureX: maxX,
    maxTemperatureRatio: maxRatio,
    maxHeatFlux: maxQ,
    outletTemperature: T,
    outletPressure: P,
    pressureDrop: regen ? regen.inletPressure - P : 0,
    heatLoad,
    minLiningSF: minSF,
    minJacketSF: minJ,
    minChannelWidth: minW,
    maxCoolantVelocity: maxV,
    bifurcations,
    regenEndX,
    linerMass: regen ? linerVolume * regen.liner.density : 0,
    jacketMass: regen ? jacketVolume * regen.jacket.density : 0,
    extensionMass: extensionVolume * rad.material.density,
    warnings: [...warnings],
  };
}
