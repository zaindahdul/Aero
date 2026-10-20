/**
 * CAD exchange formats: binary STL of the solid model (millimetres), and the
 * meridional wall profile as DXF polylines and CSV for re-creating the
 * revolved geometry in a parametric CAD package.
 */
import type { EngineDesign } from '../design';
import type { EnginePart } from './engineModel';
import { rotateX } from './mesh';

const MM = 1000;

/** Binary STL with every instance expanded; coordinates in mm. */
export function toBinarySTL(parts: EnginePart[], header = 'Laval thrust chamber assembly'): ArrayBuffer {
  let triangles = 0;
  for (const p of parts) triangles += (p.mesh.indices.length / 3) * (p.instances?.length ?? 1);
  const buf = new ArrayBuffer(84 + 50 * triangles);
  const view = new DataView(buf);
  new Uint8Array(buf, 0, 80).set(new TextEncoder().encode(header.slice(0, 79)));
  view.setUint32(80, triangles, true);
  let off = 84;
  for (const part of parts) {
    const angles = part.instances ?? Float32Array.of(0);
    for (const angle of angles) {
      const pos = angle === 0 ? part.mesh.positions : rotateX(part.mesh, angle);
      const ix = part.mesh.indices;
      for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t] * 3;
        const b = ix[t + 1] * 3;
        const c = ix[t + 2] * 3;
        const ux = pos[b] - pos[a];
        const uy = pos[b + 1] - pos[a + 1];
        const uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a];
        const vy = pos[c + 1] - pos[a + 1];
        const vz = pos[c + 2] - pos[a + 2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        view.setFloat32(off, nx / len, true);
        view.setFloat32(off + 4, ny / len, true);
        view.setFloat32(off + 8, nz / len, true);
        off += 12;
        for (const v of [a, b, c]) {
          view.setFloat32(off, pos[v] * MM, true);
          view.setFloat32(off + 4, pos[v + 1] * MM, true);
          view.setFloat32(off + 8, pos[v + 2] * MM, true);
          off += 12;
        }
        view.setUint16(off, 0, true);
        off += 2;
      }
    }
  }
  return buf;
}

/** Wall offsets along the normal, matching the solid model's layers (mm). */
function layers(design: EngineDesign) {
  const { x, r } = design.geometry.wall;
  const st = design.thermal.stations;
  const n = x.length;
  const pick = (xi: number) => st.reduce((best, s) => (Math.abs(s.x - xi) < Math.abs(best.x - xi) ? s : best), st[0]);
  const gas: [number, number][] = [];
  const liner: [number, number][] = [];
  const ribTop: [number, number][] = [];
  const jacket: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    const a = Math.atan2(r[i1] - r[i0], x[i1] - x[i0]);
    const s = pick(x[i]);
    const off = (d: number): [number, number] => [(x[i] - d * Math.sin(a)) * MM, (r[i] + d * Math.cos(a)) * MM];
    gas.push(off(0));
    liner.push(off(s.linerThickness));
    if (s.cooled) {
      ribTop.push(off(s.linerThickness + s.channelHeight));
      jacket.push(off(s.linerThickness + s.channelHeight + s.jacketThickness));
    }
  }
  return { gas, liner, ribTop, jacket };
}

/** DXF (R12 ASCII) of the meridional profile: one polyline per construction layer, mm. */
export function profileDXF(design: EngineDesign): string {
  const L = layers(design);
  const out: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
  const poly = (layer: string, pts: [number, number][]) => {
    if (pts.length < 2) return;
    out.push('0', 'POLYLINE', '8', layer, '66', '1', '70', '0');
    for (const [px, py] of pts) out.push('0', 'VERTEX', '8', layer, '10', px.toFixed(4), '20', py.toFixed(4), '30', '0.0');
    out.push('0', 'SEQEND', '8', layer);
  };
  poly('GAS_WALL', L.gas);
  poly('LINER_OUTER', L.liner);
  poly('CHANNEL_TOP', L.ribTop);
  poly('JACKET_OUTER', L.jacket);
  // Engine centreline, for the revolve operation.
  const x0 = L.gas[0][0].toFixed(4);
  const x1 = L.gas[L.gas.length - 1][0].toFixed(4);
  out.push('0', 'LINE', '8', 'AXIS', '10', x0, '20', '0.0', '30', '0.0', '11', x1, '21', '0.0', '31', '0.0');
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n');
}

/** CSV of the gas-side wall contour, mm. */
export function profileCSV(design: EngineDesign): string {
  const { x, r } = design.geometry.wall;
  const rows = ['x_mm,r_mm'];
  for (let i = 0; i < x.length; i++) rows.push(`${(x[i] * MM).toFixed(4)},${(r[i] * MM).toFixed(4)}`);
  return rows.join('\n');
}
