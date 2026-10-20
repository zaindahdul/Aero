/// <reference lib="webworker" />
import { designEngine, mixtureRatioSweep, type EngineInputs } from '../core/design';

export type WorkerRequest =
  | { id: number; kind: 'design'; inputs: EngineInputs }
  | { id: number; kind: 'sweep'; oxidizer: string; fuel: string; pc: number; eps: number; frozen: boolean; ofMin: number; ofMax: number };

export type WorkerResponse =
  | { id: number; kind: 'design'; ok: true; design: ReturnType<typeof designEngine> }
  | { id: number; kind: 'sweep'; ok: true; sweep: ReturnType<typeof mixtureRatioSweep> }
  | { id: number; kind: 'design' | 'sweep'; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.kind === 'design') {
      const design = designEngine(req.inputs);
      const m = design.nozzleFlow.moc;
      const transfer = [m.x.buffer, m.r.buffer, m.mach.buffer, m.parentPlus.buffer, m.parentMinus.buffer, m.triangles.buffer] as ArrayBuffer[];
      ctx.postMessage({ id: req.id, kind: 'design', ok: true, design } satisfies WorkerResponse, transfer);
    } else {
      const sweep = mixtureRatioSweep(req.oxidizer, req.fuel, req.pc, req.eps, req.frozen, req.ofMin, req.ofMax);
      ctx.postMessage({ id: req.id, kind: 'sweep', ok: true, sweep } satisfies WorkerResponse);
    }
  } catch (e) {
    ctx.postMessage({ id: req.id, kind: req.kind, ok: false, error: (e as Error).message } satisfies WorkerResponse);
  }
};
