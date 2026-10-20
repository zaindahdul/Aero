import type { EngineDesign } from '../core/design';
import { type EnginePart, buildEngineModel } from '../core/cad/engineModel';
import { profileCSV, profileDXF, toBinarySTL } from '../core/cad/exporters';

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slug = (d: EngineDesign) => d.inputs.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'engine';

export type StlSelection = 'assembly' | 'liner' | 'jacket' | 'injector';

const GROUPS: Record<StlSelection, EnginePart['group'][]> = {
  assembly: ['liner', 'ribs', 'jacket', 'extension', 'manifold', 'injector'],
  liner: ['liner', 'ribs', 'extension'],
  jacket: ['jacket', 'manifold'],
  injector: ['injector'],
};

export function exportSTL(design: EngineDesign, which: StlSelection) {
  const parts = buildEngineModel(design, { segments: 192 }).filter((p) => GROUPS[which].includes(p.group));
  download(`${slug(design)}-${which}.stl`, toBinarySTL(parts, `Laval ${design.inputs.name} ${which} (mm)`), 'model/stl');
}

export function exportDXF(design: EngineDesign) {
  download(`${slug(design)}-profile.dxf`, profileDXF(design), 'application/dxf');
}

export function exportCSV(design: EngineDesign) {
  download(`${slug(design)}-contour.csv`, profileCSV(design), 'text/csv');
}

/** Design report without the large flow-field arrays. */
export function exportJSON(design: EngineDesign) {
  const { nozzleFlow, ...rest } = design;
  const report = {
    generator: 'Laval rocket engine design suite',
    ...rest,
    nozzleFlow: { optimized: nozzleFlow.optimized, shock: nozzleFlow.shock, xStart: nozzleFlow.xStart },
  };
  download(`${slug(design)}-design.json`, JSON.stringify(report, null, 1), 'application/json');
}

export function exportPNG(dataUrl: string, design: EngineDesign) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${slug(design)}-render.png`;
  a.click();
}
