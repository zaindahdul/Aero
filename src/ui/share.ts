import type { EngineInputs } from '../core/design';
import { PRESETS } from '../core/presets';

const PREFIX = '#design=';

/** Encodes the inputs into a URL-safe hash fragment. */
export function encodeDesign(inputs: EngineInputs): string {
  const json = JSON.stringify(inputs);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Restores inputs from the hash, filling any missing fields from the default preset. */
export function decodeDesign(hash: string): EngineInputs | null {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const b64 = hash.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const parsed = JSON.parse(json) as Partial<EngineInputs>;
    const base = PRESETS[0].inputs;
    return {
      ...base,
      ...parsed,
      chamber: { ...base.chamber, ...parsed.chamber },
      nozzle: { ...base.nozzle, ...parsed.nozzle },
      cooling: { ...base.cooling, ...parsed.cooling },
      injector: { ...base.injector, ...parsed.injector },
      cycle: { ...base.cycle, ...parsed.cycle },
      numerics: { ...base.numerics, ...parsed.numerics },
    } as EngineInputs;
  } catch {
    return null;
  }
}
