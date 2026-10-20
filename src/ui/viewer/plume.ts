import * as THREE from 'three';
import type { EngineDesign } from '../../core/design';

/** Exhaust colours by propellant family (core, outer). */
function plumeColors(design: EngineDesign): [string, string, number] {
  const { oxidizer, fuel } = design.inputs;
  if (fuel === 'LH2') return ['#d9cfff', '#7d8cff', 0.45];
  if (fuel === 'LCH4') return ['#cad6ff', '#4f63ff', 0.85];
  if (fuel === 'RP1') return ['#fff3c8', '#ff8a2a', 1.0];
  if (fuel === 'ETHANOL' && oxidizer === 'LOX') return ['#dfe3ff', '#7b7dff', 0.8];
  if (fuel === 'MMH') return ['#ffd9b5', '#ff7c4d', 0.9];
  return ['#ffe0bd', '#ff9763', 0.85];
}

const vertex = /* glsl */ `
  uniform float uSpread;
  uniform float uAmp;
  uniform float uCells;
  varying float vXi;
  varying float vFres;
  void main() {
    vXi = uv.y;
    vec3 p = position;
    float s = 1.0 + uSpread * vXi + uAmp * sin(6.2831853 * vXi * uCells) * exp(-2.5 * vXi);
    p.yz *= max(0.2, s);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec3 n = normalize(normalMatrix * vec3(0.0, normal.y, normal.z));
    vFres = 1.0 - abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uCells;
  uniform float uIntensity;
  uniform vec3 uCore;
  uniform vec3 uOuter;
  varying float vXi;
  varying float vFres;
  void main() {
    float diamonds = 0.45 + 0.55 * pow(abs(cos(3.14159265 * vXi * uCells)), 8.0) * exp(-1.5 * vXi);
    float flicker = 0.88 + 0.12 * sin(vXi * 47.0 - uTime * 31.0) * sin(vXi * 13.0 + uTime * 17.0);
    float fade = smoothstep(0.0, 0.03, vXi) * (1.0 - smoothstep(0.25, 1.0, vXi));
    float core = pow(1.0 - vFres, 2.0);
    vec3 col = mix(uOuter, uCore, clamp(core * diamonds * 1.2, 0.0, 1.0));
    float a = fade * flicker * (0.25 + 0.75 * core) * diamonds * uIntensity;
    gl_FragColor = vec4(col * a, a);
  }
`;

/** Additive, animated exhaust plume attached at the nozzle exit (engine axis +x). */
export function createPlume(design: EngineDesign) {
  const re = design.geometry.exitDiameter / 2;
  const de = 2 * re;
  const xe = design.geometry.contour.xExit;
  const vacuum = design.inputs.thrustAmbient === 0;
  const pa = vacuum ? 0 : 101325;
  const me = design.performance.exitMach;
  const length = (vacuum ? 5 : 9) * de;
  const cell = Math.min(3 * de, Math.max(0.8 * de, 0.8 * de * Math.sqrt(Math.max(0.2, me * me - 1))));
  const ratio = pa > 0 ? design.performance.pe / pa : 10;
  const amp = vacuum ? 0 : 0.14 * Math.sign(ratio - 1) * Math.min(1, Math.abs(Math.log(ratio)));
  const spread = vacuum ? 2.6 : 0.55;
  const [core, outer, intensity] = plumeColors(design);

  const group = new THREE.Group();
  const materials: THREE.ShaderMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  for (const [scale, gain] of [
    [0.72, 1.0],
    [1.0, 0.55],
    [1.35, 0.22],
  ] as const) {
    const g = new THREE.CylinderGeometry(re * scale, re * scale, length, 64, 1, true);
    g.rotateZ(-Math.PI / 2);
    g.translate(xe + length / 2, 0, 0);
    // Cylinder uv.y runs bottom (0) -> top (1); after rotation the bottom is at the exit.
    const m = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uTime: { value: 0 },
        uCells: { value: length / cell },
        uIntensity: { value: intensity * gain },
        uSpread: { value: spread },
        uAmp: { value: amp },
        uCore: { value: new THREE.Color(core) },
        uOuter: { value: new THREE.Color(outer) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 10;
    group.add(mesh);
    materials.push(m);
    geometries.push(g);
  }
  group.visible = false;
  let t = 0;
  return {
    mesh: group,
    update(dt: number) {
      t += dt;
      for (const m of materials) m.uniforms.uTime.value = t;
    },
    dispose() {
      for (const m of materials) m.dispose();
      for (const g of geometries) g.dispose();
    },
  };
}
