import type { EngineDesign, EngineInputs } from '../core/design';
import type { WorkerRequest, WorkerResponse } from '../worker/engine.worker';

type SweepArgs = Omit<Extract<WorkerRequest, { kind: 'sweep' }>, 'id' | 'kind'>;
export type SweepPoint = Extract<WorkerResponse, { kind: 'sweep'; ok: true }>['sweep'][number];

/**
 * Talks to the solver worker. Design requests coalesce: while one is running,
 * only the most recent pending request is kept, so dragging a slider never
 * queues up stale solves.
 */
export class EngineClient {
  private worker: Worker;
  private nextId = 1;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private busy = false;
  private pendingDesign: { inputs: EngineInputs; resolve: (d: EngineDesign) => void; reject: (e: Error) => void } | null = null;
  private queue: WorkerRequest[] = [];

  constructor() {
    this.worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const res = ev.data;
      const w = this.waiting.get(res.id);
      this.waiting.delete(res.id);
      if (w) {
        if (res.ok) w.resolve(res.kind === 'design' ? res.design : res.sweep);
        else w.reject(new Error(res.error));
      }
      this.busy = false;
      this.pump();
    };
  }

  design(inputs: EngineInputs): Promise<EngineDesign> {
    return new Promise((resolve, reject) => {
      // Supersede any design that has not started yet.
      this.pendingDesign?.reject(new SupersededError());
      this.pendingDesign = { inputs, resolve, reject };
      this.pump();
    });
  }

  sweep(args: SweepArgs): Promise<SweepPoint[]> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.queue.push({ id, kind: 'sweep', ...args });
      this.pump();
    });
  }

  private pump() {
    if (this.busy) return;
    let req: WorkerRequest | undefined;
    if (this.pendingDesign) {
      const p = this.pendingDesign;
      this.pendingDesign = null;
      const id = this.nextId++;
      this.waiting.set(id, { resolve: p.resolve as (v: unknown) => void, reject: p.reject });
      req = { id, kind: 'design', inputs: p.inputs };
    } else {
      req = this.queue.shift();
    }
    if (!req) return;
    this.busy = true;
    this.worker.postMessage(req);
  }
}

export class SupersededError extends Error {
  constructor() {
    super('superseded');
  }
}
