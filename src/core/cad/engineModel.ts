/**
 * Parametric solid model of the thrust chamber assembly, generated from a
 * converged design: liner shell, cooling ribs (one geometry per bifurcation
 * level, instanced by rotation), auto-sized closeout jacket, radiation-cooled
 * extension, coolant manifolds and the injector (face plate, dome, element
 * posts). Every body is a closed, outward-oriented triangle mesh; lengths in
 * metres with the engine axis along +x (injector -> exit).
 */
import type { EngineDesign } from '../design';
import { type MeshData, revolve, signedVolume, sweep } from './mesh';

export type RenderMaterial = 'copper' | 'inconel' | 'steel' | 'aluminium' | 'niobium' | 'carbon' | 'titanium';

export interface EnginePart {
  id: string;
  name: string;
  group: 'liner' | 'ribs' | 'jacket' | 'extension' | 'manifold' | 'injector';
  material: RenderMaterial;
  mesh: MeshData;
  /** Additional copies rotated about the engine axis by these angles, rad (includes 0 for the original). */
  instances?: Float32Array;
}

const MATERIAL_LOOK: Record<string, RenderMaterial> = {
  GRCop42: 'copper',
  CuCrZr: 'copper',
  Inconel718: 'inconel',
  SS316L: 'steel',
  AlSi10Mg: 'aluminium',
  C103: 'niobium',
  CarbonCarbon: 'carbon',
  Ti64: 'titanium',
};

interface ProfilePoint {
  x: number;
  r: number;
  /** Wall angle, rad. */
  a: number;
  tw: number;
  h: number;
  tj: number;
  channels: number;
  cooled: boolean;
  Twg: number;
  Twc: number;
  Tcool: number;
}

function profile(design: EngineDesign): ProfilePoint[] {
  const { x, r } = design.geometry.wall;
  const st = design.thermal.stations;
  const n = x.length;
  const out: ProfilePoint[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    while (j + 1 < st.length && Math.abs(st[j + 1].x - x[i]) <= Math.abs(st[j].x - x[i])) j++;
    const s = st[j];
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    out.push({
      x: x[i],
      r: r[i],
      a: Math.atan2(r[i1] - r[i0], x[i1] - x[i0]),
      tw: s.linerThickness,
      h: s.cooled ? s.channelHeight : 0,
      tj: s.cooled ? s.jacketThickness : 0,
      channels: s.cooled ? s.channels : 0,
      cooled: s.cooled,
      Twg: s.Twg,
      Twc: s.Twc,
      Tcool: s.cooled ? s.Tcool : s.Twg,
    });
  }
  return out;
}

/** Point offset from the gas-side wall along its outward normal. */
const offset = (p: ProfilePoint, d: number) => ({ x: p.x - d * Math.sin(p.a), r: p.r + d * Math.cos(p.a) });

/** Drops points that would fold back in x (offset curves of tight concave arcs). */
function monotone<T extends { x: number }>(pts: T[], increasing: boolean): T[] {
  const out: T[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || (increasing ? p.x > last.x + 1e-7 : p.x < last.x - 1e-7)) out.push(p);
  }
  return out;
}

/** Closed CCW (x, r) loop between an inner and an outer offset of a profile range. */
function shellLoop(
  pts: ProfilePoint[],
  inner: (p: ProfilePoint) => number,
  outer: (p: ProfilePoint) => number,
  sIn: (p: ProfilePoint) => number,
  sOut: (p: ProfilePoint) => number,
) {
  const lower = monotone(
    pts.map((p) => ({ ...offset(p, inner(p)), s: sIn(p) })),
    true,
  );
  const upper = monotone(
    [...pts].reverse().map((p) => ({ ...offset(p, outer(p)), s: sOut(p) })),
    false,
  );
  return [...lower, ...upper];
}

function orient(mesh: MeshData): MeshData {
  if (signedVolume(mesh) >= 0) return mesh;
  const ix = mesh.indices;
  for (let t = 0; t < ix.length; t += 3) {
    const tmp = ix[t + 1];
    ix[t + 1] = ix[t + 2];
    ix[t + 2] = tmp;
  }
  return mesh;
}

/** Cylinder parallel to the x axis at radial position rho (in the +y half-plane). */
function postCylinder(x0: number, x1: number, rho: number, a: number, seg = 16): MeshData {
  const ring = (x: number) =>
    Array.from({ length: seg }, (_, j) => {
      const t = (2 * Math.PI * j) / seg;
      return { x, y: rho + a * Math.cos(t), z: a * Math.sin(t) };
    });
  return orient(sweep([ring(x0), ring(x1)]));
}

/** Radial pipe stub along +y from radius r0 to r1 at axial position x. */
function radialPipe(x: number, r0: number, r1: number, a: number, seg = 20): MeshData {
  const ring = (y: number) =>
    Array.from({ length: seg }, (_, j) => {
      const t = (2 * Math.PI * j) / seg;
      return { x: x + a * Math.cos(t), y, z: a * Math.sin(t) };
    });
  return orient(sweep([ring(r0), ring(r1)]));
}

function torus(xc: number, rc: number, a: number, segments: number, minor = 24): MeshData {
  const loop = Array.from({ length: minor }, (_, k) => {
    const t = (2 * Math.PI * k) / minor;
    return { x: xc + a * Math.cos(t), r: rc + a * Math.sin(t) };
  });
  return orient(revolve(loop, segments));
}

export interface ModelOptions {
  /** Circumferential segments for revolved bodies. */
  segments?: number;
  /** Maximum axial stations per rib sweep. */
  ribStations?: number;
}

export function buildEngineModel(design: EngineDesign, opts: ModelOptions = {}): EnginePart[] {
  const segments = opts.segments ?? 128;
  const ribStations = opts.ribStations ?? 120;
  const parts: EnginePart[] = [];
  const pts = profile(design);
  const cool = design.inputs.cooling;
  const regen = design.coolant !== null;
  const rt = design.geometry.throatDiameter / 2;
  const iR = regen ? pts.reduce((last, p, i) => (p.cooled ? i : last), -1) : -1;
  const regenPts = regen ? pts.slice(0, iR + 1) : [];
  const radPts = regen ? pts.slice(Math.max(0, iR)) : pts;

  if (regen && regenPts.length > 1) {
    // ---- Liner shell (hot wall); scalar = temperature (gas side / coolant side) ----
    parts.push({
      id: 'liner',
      name: 'Liner (hot wall)',
      group: 'liner',
      material: MATERIAL_LOOK[cool.linerMaterial] ?? 'copper',
      mesh: orient(
        revolve(
          shellLoop(regenPts, () => 0, (p) => p.tw, (p) => p.Twg, (p) => p.Twc),
          segments,
        ),
      ),
    });

    // ---- Ribs: one swept solid per bifurcation level and contiguous run ----
    const n0 = cool.channels;
    const maxLevel = Math.round(Math.log2(Math.max(...regenPts.map((p) => p.channels)) / n0));
    const rib = cool.ribWidth;
    const embed = Math.min(2e-5, 0.02 * rib);
    for (let level = 0; level <= maxLevel; level++) {
      const threshold = n0 * 2 ** level;
      const count = level === 0 ? n0 : n0 * 2 ** (level - 1);
      const phase = level === 0 ? 0 : 0.5;
      const angles = Float32Array.from({ length: count }, (_, k) => (2 * Math.PI * (k + phase)) / count);
      let run: ProfilePoint[] = [];
      let runIndex = 0;
      const flush = () => {
        if (run.length > ribStations) {
          // Wall points already cluster at the throat; uniform index sampling keeps that.
          const m = ribStations;
          run = Array.from({ length: m }, (_, i) => run[Math.round((i * (run.length - 1)) / (m - 1))]);
        }
        if (run.length >= 2) {
          const rings = run.map((p) => {
            const b = offset(p, p.tw - embed);
            const t = offset(p, p.tw + p.h + embed);
            return [
              { x: b.x, y: b.r, z: -rib / 2 },
              { x: b.x, y: b.r, z: rib / 2 },
              { x: t.x, y: t.r, z: rib / 2 },
              { x: t.x, y: t.r, z: -rib / 2 },
            ];
          });
          parts.push({
            id: `ribs-${level}-${runIndex++}`,
            name: level === 0 ? 'Cooling ribs' : `Cooling ribs (bifurcation ${level})`,
            group: 'ribs',
            material: MATERIAL_LOOK[cool.linerMaterial] ?? 'copper',
            mesh: orient(
              sweep(
                rings,
                run.map((p) => p.Twc),
              ),
            ),
            instances: angles,
          });
        }
        run = [];
      };
      for (const p of regenPts) {
        if (p.channels >= threshold) run.push(p);
        else flush();
      }
      flush();
    }

    // ---- Closeout jacket; scalar = coolant temperature ----
    parts.push({
      id: 'jacket',
      name: 'Closeout jacket',
      group: 'jacket',
      material: MATERIAL_LOOK[cool.jacketMaterial] ?? 'inconel',
      mesh: orient(
        revolve(
          shellLoop(regenPts, (p) => p.tw + p.h, (p) => p.tw + p.h + p.tj, (p) => p.Tcool, (p) => p.Tcool),
          segments,
        ),
      ),
    });

    // ---- Coolant manifolds at the regen inlet and the injector end ----
    const coolRho = design.thermal.stations.find((s) => s.cooled)?.rhoCool ?? 500;
    const mdotC = cool.coolantFraction * (cool.coolantSide === 'fuel' ? design.performance.fuelFlow : design.performance.oxidizerFlow);
    const a = Math.min(0.45 * rt, Math.max(2.5e-3, Math.sqrt(mdotC / (coolRho * 12) / Math.PI)));
    const outerAt = (p: ProfilePoint) => offset(p, p.tw + p.h + p.tj);
    const inletP = regenPts[Math.max(0, regenPts.length - 1 - Math.round(regenPts.length * 0.01))];
    const outletP = regenPts[Math.min(regenPts.length - 1, Math.round(regenPts.length * 0.03))];
    for (const [id, p, label] of [
      ['manifold-inlet', inletP, 'Coolant inlet manifold'],
      ['manifold-outlet', outletP, 'Coolant outlet manifold'],
    ] as const) {
      const o = outerAt(p);
      const rc = o.r + 0.8 * a;
      parts.push({ id, name: label, group: 'manifold', material: 'steel', mesh: torus(o.x, rc, a, segments) });
      parts.push({
        id: `${id}-pipe`,
        name: `${label} pipe`,
        group: 'manifold',
        material: 'steel',
        mesh: radialPipe(o.x, rc + 0.5 * a, rc + 4 * a, 0.7 * a),
      });
    }
  }

  // ---- Radiation-cooled wall (nozzle extension, or the whole chamber) ----
  if (radPts.length > 1 && (!regen || iR < pts.length - 1)) {
    parts.push({
      id: 'extension',
      name: regen ? 'Nozzle extension (radiation cooled)' : 'Chamber and nozzle (radiation cooled)',
      group: 'extension',
      material: MATERIAL_LOOK[cool.radiativeMaterial] ?? 'niobium',
      mesh: orient(revolve(shellLoop(radPts, () => 0, (p) => p.tw, (p) => p.Twg, (p) => p.Twg), segments)),
    });
  }

  // ---- Injector: face plate, dome, inlet, element posts ----
  const p0 = pts[0];
  const shellR = regen ? offset(p0, p0.tw + p0.h + p0.tj).r : offset(p0, p0.tw).r;
  const rc = design.geometry.chamberDiameter / 2;
  const plateR = shellR + 0.12 * rc;
  const plateT = 0.12 * rc + 3e-3;
  const x0 = p0.x;
  const plate = [
    { x: x0 - plateT, r: 0 },
    { x: x0, r: 0 },
    { x: x0, r: plateR },
    { x: x0 - plateT, r: plateR },
  ];
  parts.push({ id: 'injector-plate', name: 'Injector face plate', group: 'injector', material: 'steel', mesh: orient(revolve(plate, segments)) });

  const depth = 0.6 * plateR;
  const td = Math.max(2e-3, 0.06 * plateR);
  const dome: { x: number; r: number }[] = [];
  const nd = 40;
  for (let k = 0; k <= nd; k++) {
    const t = (Math.PI / 2) * (k / nd);
    dome.push({ x: x0 - plateT - depth * Math.sin(t), r: plateR * Math.cos(t) });
  }
  for (let k = nd; k >= 0; k--) {
    const t = (Math.PI / 2) * (k / nd);
    dome.push({ x: x0 - plateT - (depth - td) * Math.sin(t), r: (plateR - td) * Math.cos(t) });
  }
  parts.push({ id: 'injector-dome', name: 'Injector dome', group: 'injector', material: 'steel', mesh: orient(revolve(dome, segments)) });
  const pipeR = Math.max(4e-3, 0.18 * plateR);
  const pipe = [
    { x: x0 - plateT - depth - 0.5 * plateR, r: pipeR - td },
    { x: x0 - plateT - depth + td, r: pipeR - td },
    { x: x0 - plateT - depth + td, r: pipeR },
    { x: x0 - plateT - depth - 0.5 * plateR, r: pipeR },
  ];
  parts.push({ id: 'injector-inlet', name: 'Oxidizer inlet', group: 'injector', material: 'steel', mesh: orient(revolve(pipe, 48)) });

  // Element posts on concentric rings across the face.
  const nEl = design.injector.elements;
  const faceR = 0.88 * rc;
  const pitch = Math.sqrt((Math.PI * faceR * faceR) / nEl);
  const postR = Math.min(0.32 * pitch, Math.max(0.6 * design.injector.fuelOrificeDiameter, 0.5e-3));
  const postH = Math.max(0.6e-3, 0.5 * postR);
  const rings = Math.max(1, Math.round(faceR / pitch));
  let placed = 1;
  parts.push({
    id: 'injector-element-center',
    name: 'Injector elements',
    group: 'injector',
    material: 'steel',
    mesh: postCylinder(x0 - 1e-5, x0 + postH, 0, postR),
  });
  for (let k = 1; k <= rings && placed < nEl; k++) {
    const rho = (k * faceR) / rings;
    const count = Math.min(nEl - placed, Math.max(3, Math.round((2 * Math.PI * rho) / pitch)));
    placed += count;
    parts.push({
      id: `injector-elements-${k}`,
      name: 'Injector elements',
      group: 'injector',
      material: 'steel',
      mesh: postCylinder(x0 - 1e-5, x0 + postH, rho, postR),
      instances: Float32Array.from({ length: count }, (_, i) => (2 * Math.PI * (i + 0.5 * (k % 2))) / count),
    });
  }
  return parts;
}

/** Total triangle count with instances expanded. */
export function triangleCount(parts: EnginePart[]): number {
  return parts.reduce((n, p) => n + (p.mesh.indices.length / 3) * (p.instances?.length ?? 1), 0);
}

