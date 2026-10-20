import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EngineDesign } from '../../core/design';
import { type EnginePart, type RenderMaterial, buildEngineModel } from '../../core/cad/engineModel';
import { heat, sequential } from '../colormaps';
import { createPlume } from './plume';
import { flowTriangles } from '../views/flowField';

export interface ViewOptions {
  section: boolean;
  heatmap: boolean;
  flowField: boolean;
  showJacket: boolean;
  fire: boolean;
  autoRotate: boolean;
}

export interface HoverInfo {
  name: string;
  detail: string;
  x: number;
  y: number;
}

const LOOKS: Record<RenderMaterial, { color: string; metalness: number; roughness: number }> = {
  copper: { color: '#c8794a', metalness: 1, roughness: 0.38 },
  inconel: { color: '#8f9196', metalness: 1, roughness: 0.52 },
  steel: { color: '#b9bdc3', metalness: 1, roughness: 0.46 },
  aluminium: { color: '#cdd2d9', metalness: 1, roughness: 0.5 },
  niobium: { color: '#9ea4b2', metalness: 1, roughness: 0.46 },
  carbon: { color: '#2a2b2f', metalness: 0.25, roughness: 0.55 },
  titanium: { color: '#a19e96', metalness: 1, roughness: 0.4 },
};

/** Cut-face colour per material, so liner, jacket and extension read apart in section. */
const CAP_COLORS: Record<RenderMaterial, string> = {
  copper: '#e39a64',
  inconel: '#8a8f98',
  steel: '#a9aeb6',
  aluminium: '#c4cad3',
  niobium: '#9aa3b8',
  carbon: '#45464c',
  titanium: '#9d998f',
};

/** sRGB component to linear (vertex colours are interpreted as linear). */
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

const MATERIAL_NAMES: Record<RenderMaterial, string> = {
  copper: 'Copper alloy',
  inconel: 'Nickel superalloy',
  steel: 'Stainless steel',
  aluminium: 'Aluminium alloy',
  niobium: 'Niobium alloy',
  carbon: 'Carbon-carbon',
  titanium: 'Titanium alloy',
};

interface PartObject {
  part: EnginePart;
  mesh: THREE.Mesh | THREE.InstancedMesh;
  cap: THREE.Mesh | THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  look: THREE.MeshStandardMaterial;
  heatMat: THREE.MeshStandardMaterial;
  tRange: [number, number];
}

export class EngineViewer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private engine = new THREE.Group();
  private objects: PartObject[] = [];
  private field: THREE.Mesh | null = null;
  private plume: ReturnType<typeof createPlume> | null = null;
  private clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private raf = 0;
  private timer = new THREE.Timer();
  private opts: ViewOptions = { section: false, heatmap: false, flowField: true, showJacket: true, fire: false, autoRotate: false };
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private tempRange: [number, number] = [0, 1];
  private framed = false;
  private framedSize = 1;
  private dirty = true;
  private active = true;
  onHover: ((h: HoverInfo | null) => void) | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#0d0e11');
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.12).texture;
    pmrem.dispose();

    const key = new THREE.DirectionalLight('#ffffff', 1.4);
    key.position.set(3, 4, 5);
    const rim = new THREE.DirectionalLight('#ffb27a', 1.1);
    rim.position.set(-4, 1, -3);
    this.scene.add(key, rim, new THREE.AmbientLight('#8090a8', 0.25));

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.001, 1000);
    this.camera.position.set(1.4, 0.4, 3.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotateSpeed = 0.8;
    this.controls.addEventListener('change', () => (this.dirty = true));

    // Engine axis +x (injector -> exit) points down the screen.
    this.engine.rotation.z = -Math.PI / 2;
    this.scene.add(this.engine);

    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerleave', () => this.onHover?.(null));
    this.loop();
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = `${width}px`;
    this.renderer.domElement.style.height = `${height}px`;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** Pauses rendering while the viewer is not on screen. */
  setActive(active: boolean) {
    this.active = active;
    this.dirty = true;
  }

  setDesign(design: EngineDesign) {
    this.clearModel();
    const parts = buildEngineModel(design, { segments: 112 });
    // Temperature range for the heat map: coolant inlet to hottest wall.
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const p of parts) {
      if (p.group === 'injector' || p.group === 'manifold' || !p.mesh.scalar) continue;
      for (const v of p.mesh.scalar) {
        tMin = Math.min(tMin, v);
        tMax = Math.max(tMax, v);
      }
    }
    this.tempRange = [Math.floor(tMin / 50) * 50, Math.ceil(tMax / 50) * 50];
    const dummy = new THREE.Object3D();

    for (const part of parts) {
      let geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(part.mesh.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(part.mesh.indices, 1));
      const thermal = part.group !== 'injector' && part.group !== 'manifold' && part.mesh.scalar;
      if (thermal) {
        const colors = new Float32Array(part.mesh.positions.length);
        const s = part.mesh.scalar!;
        for (let i = 0; i < s.length; i++) {
          const [r, g, b] = heat((s[i] - this.tempRange[0]) / (this.tempRange[1] - this.tempRange[0]));
          colors[3 * i] = lin(r);
          colors[3 * i + 1] = lin(g);
          colors[3 * i + 2] = lin(b);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      geometry = toCreasedNormals(geometry, (32 * Math.PI) / 180);
      const lookDef = LOOKS[part.material];
      const look = new THREE.MeshStandardMaterial({ ...lookDef, color: new THREE.Color(lookDef.color), clippingPlanes: [] });
      const heatMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.15, roughness: 0.55, clippingPlanes: [] });
      const capMat = new THREE.MeshBasicMaterial({ color: CAP_COLORS[part.material], side: THREE.BackSide, clippingPlanes: [this.clip] });
      let mesh: THREE.Mesh | THREE.InstancedMesh;
      let cap: THREE.Mesh | THREE.InstancedMesh;
      if (part.instances && part.instances.length > 1) {
        const n = part.instances.length;
        const im = new THREE.InstancedMesh(geometry, look, n);
        const ic = new THREE.InstancedMesh(geometry, capMat, n);
        for (let i = 0; i < n; i++) {
          dummy.rotation.set(part.instances[i], 0, 0);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
          ic.setMatrixAt(i, dummy.matrix);
        }
        mesh = im;
        cap = ic;
      } else {
        mesh = new THREE.Mesh(geometry, look);
        cap = new THREE.Mesh(geometry, capMat);
        if (part.instances?.length === 1) {
          mesh.rotation.x = part.instances[0];
          cap.rotation.x = part.instances[0];
        }
      }
      mesh.userData.partIndex = this.objects.length;
      cap.visible = false;
      this.engine.add(mesh, cap);
      let tr: [number, number] = [NaN, NaN];
      if (thermal) {
        const s = part.mesh.scalar!;
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of s) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        tr = [lo, hi];
      }
      this.objects.push({ part, mesh, cap, geometry, look, heatMat: thermal ? heatMat : look, tRange: tr });
    }

    this.field = this.buildFlowField(design);
    if (this.field) this.engine.add(this.field);
    this.plume = createPlume(design);
    this.engine.add(this.plume.mesh);
    this.applyOptions();
    this.dirty = true;
    // Re-frame on first load and whenever the engine size changes noticeably (new preset).
    const size = design.geometry.totalLength;
    if (!this.framed || Math.abs(size / this.framedSize - 1) > 0.25) {
      this.frame();
      this.framed = true;
      this.framedSize = size;
    }
  }

  /** Mach-number field in the meridional plane: 1-D chamber + MoC near the throat + Euler march downstream. */
  private buildFlowField(design: EngineDesign): THREE.Mesh | null {
    const { tris, mMax } = flowTriangles(design);
    if (!tris.length) return null;
    const n = tris.length / 3;
    const pos = new Float32Array(2 * n * 3);
    const col = new Float32Array(2 * n * 3);
    for (let v = 0; v < n; v++) {
      const [r, g, b] = sequential(tris[3 * v + 2] / mMax).map(lin);
      // Upper half as given; lower half mirrored with reversed winding.
      const mirror = n + (v - (v % 3)) + (2 - (v % 3));
      for (const [k, sgn] of [
        [v, 1],
        [mirror, -1],
      ] as const) {
        pos[3 * k] = tris[3 * v];
        pos[3 * k + 1] = sgn * tris[3 * v + 1];
        pos[3 * k + 2] = 0;
        col[3 * k] = r;
        col[3 * k + 1] = g;
        col[3 * k + 2] = b;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false }));
    mesh.position.z = -1e-4 * design.geometry.totalLength;
    mesh.renderOrder = 1;
    mesh.userData.mMax = mMax;
    return mesh;
  }

  get machRange(): number {
    return (this.field?.userData.mMax as number) ?? 1;
  }

  get temperatureRange(): [number, number] {
    return this.tempRange;
  }

  setOptions(o: Partial<ViewOptions>) {
    const ignite = o.fire === true && !this.opts.fire;
    this.opts = { ...this.opts, ...o };
    this.applyOptions();
    if (ignite) this.frame(true);
  }

  private applyOptions() {
    const o = this.opts;
    const planes = o.section ? [this.clip] : [];
    for (const ob of this.objects) {
      const mat = o.heatmap ? ob.heatMat : ob.look;
      mat.clippingPlanes = planes;
      mat.needsUpdate = true;
      ob.mesh.material = mat;
      const hiddenJacket = !o.showJacket && (ob.part.group === 'jacket' || ob.part.group === 'manifold');
      ob.mesh.visible = !hiddenJacket;
      ob.cap.visible = o.section && !hiddenJacket;
    }
    if (this.field) this.field.visible = o.section && o.flowField;
    if (this.plume) this.plume.mesh.visible = o.fire;
    this.controls.autoRotate = o.autoRotate;
    this.dirty = true;
  }

  frame(includePlume = false) {
    // Frame the hardware (and the plume while firing); hidden helpers are excluded.
    const box = new THREE.Box3();
    for (const ob of this.objects) box.expandByObject(ob.mesh);
    if (includePlume && this.plume) box.expandByObject(this.plume.mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    const dist = radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.05;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0.45, 0.18, 1).normalize().multiplyScalar(dist));
    this.camera.near = dist / 200;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  private onPointerMove = (e: PointerEvent) => {
    if (!this.onHover) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = this.objects.filter((o) => o.mesh.visible).map((o) => o.mesh);
    const hits = this.raycaster.intersectObjects(targets, false).filter((h) => !this.opts.section || this.clip.distanceToPoint(h.point) >= 0);
    if (!hits.length) return this.onHover(null);
    const ob = this.objects[hits[0].object.userData.partIndex as number];
    const count = ob.part.instances?.length ?? 1;
    const t = Number.isFinite(ob.tRange[0]) ? ` · ${ob.tRange[0].toFixed(0)}–${ob.tRange[1].toFixed(0)} K` : '';
    this.onHover({
      name: ob.part.name + (count > 1 ? ` ×${count}` : ''),
      detail: MATERIAL_NAMES[ob.part.material] + t,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update();
    const dt = this.timer.getDelta();
    if (!this.active) return;
    this.controls.update();
    const animating = this.opts.fire || this.opts.autoRotate;
    if (this.plume && this.opts.fire) this.plume.update(dt);
    if (!this.dirty && !animating) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  };

  private clearModel() {
    for (const ob of this.objects) {
      ob.geometry.dispose();
      ob.look.dispose();
      if (ob.heatMat !== ob.look) ob.heatMat.dispose();
      (ob.cap.material as THREE.Material).dispose();
      this.engine.remove(ob.mesh, ob.cap);
    }
    this.objects = [];
    if (this.field) {
      this.field.geometry.dispose();
      (this.field.material as THREE.Material).dispose();
      this.engine.remove(this.field);
      this.field = null;
    }
    if (this.plume) {
      this.plume.dispose();
      this.engine.remove(this.plume.mesh);
      this.plume = null;
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.clearModel();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
