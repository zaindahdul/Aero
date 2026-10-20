/** Minimal indexed triangle-mesh utilities (engine axis = +x). */

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  /** Optional per-vertex scalar (e.g. temperature) for colour mapping. */
  scalar?: Float32Array;
}

export class MeshBuilder {
  private pos: number[] = [];
  private idx: number[] = [];
  private sca: number[] = [];

  vertex(x: number, y: number, z: number, s = 0): number {
    this.pos.push(x, y, z);
    this.sca.push(s);
    return this.pos.length / 3 - 1;
  }

  /** Adds a triangle, skipping degenerate ones (repeated vertices at poles). */
  tri(a: number, b: number, c: number) {
    if (a === b || b === c || a === c) return;
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number) {
    // a-b-c-d counter-clockwise when viewed from outside.
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  build(): MeshData {
    return {
      positions: Float32Array.from(this.pos),
      indices: Uint32Array.from(this.idx),
      scalar: Float32Array.from(this.sca),
    };
  }
}

/**
 * Revolves a closed (x, r) profile loop about the x axis. The loop must be
 * counter-clockwise in the (x, r) plane (solid to the left of travel), which
 * yields outward-facing triangles. Vertices on the axis collapse to poles,
 * so solids touching the axis stay watertight.
 */
export function revolve(loop: { x: number; r: number; s?: number }[], segments: number): MeshData {
  const mb = new MeshBuilder();
  const n = loop.length;
  const ids: number[][] = [];
  for (let k = 0; k < n; k++) {
    const p = loop[k];
    if (p.r < 1e-12) {
      const pole = mb.vertex(p.x, 0, 0, p.s ?? 0);
      ids.push(new Array(segments).fill(pole));
      continue;
    }
    const row: number[] = [];
    for (let j = 0; j < segments; j++) {
      const t = (2 * Math.PI * j) / segments;
      row.push(mb.vertex(p.x, p.r * Math.cos(t), p.r * Math.sin(t), p.s ?? 0));
    }
    ids.push(row);
  }
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      const a = ids[k][j];
      const b = ids[k1][j];
      const c = ids[k][j1];
      const d = ids[k1][j1];
      mb.tri(a, b, c);
      mb.tri(b, d, c);
    }
  }
  return mb.build();
}

/** Sweeps a closed cross-section (list of corner loops, one per station) into a capped tube. */
export function sweep(rings: { x: number; y: number; z: number }[][], scalars?: number[]): MeshData {
  const mb = new MeshBuilder();
  const m = rings[0].length;
  const ids = rings.map((ring, k) => ring.map((p) => mb.vertex(p.x, p.y, p.z, scalars?.[k] ?? 0)));
  for (let k = 0; k + 1 < rings.length; k++) {
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      mb.quad(ids[k][j], ids[k + 1][j], ids[k + 1][j1], ids[k][j1]);
    }
  }
  // End caps (convex cross-sections: fan triangulation).
  const first = ids[0];
  const last = ids[ids.length - 1];
  for (let j = 1; j + 1 < m; j++) {
    mb.tri(first[0], first[j], first[j + 1]);
    mb.tri(last[0], last[j + 1], last[j]);
  }
  return mb.build();
}

/** Signed volume (positive for outward-oriented closed meshes). */
export function signedVolume(mesh: MeshData): number {
  const p = mesh.positions;
  const ix = mesh.indices;
  let v = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3;
    const b = ix[t + 1] * 3;
    const c = ix[t + 2] * 3;
    v +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

/** True when every edge is shared by exactly two triangles with opposite winding. */
export function isWatertight(mesh: MeshData): boolean {
  const edges = new Map<string, number>();
  const ix = mesh.indices;
  for (let t = 0; t < ix.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = ix[t + e];
      const b = ix[t + ((e + 1) % 3)];
      const key = `${a},${b}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of edges) {
    if (count !== 1) return false;
    const [a, b] = key.split(',');
    if (edges.get(`${b},${a}`) !== 1) return false;
  }
  return true;
}

/** Rotates a mesh copy about the x axis. */
export function rotateX(mesh: MeshData, angle: number): Float32Array {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const p = mesh.positions;
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = p[i];
    out[i + 1] = c * p[i + 1] - s * p[i + 2];
    out[i + 2] = s * p[i + 1] + c * p[i + 2];
  }
  return out;
}
