import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/core/presets';
import { decodeDesign, encodeDesign } from '../src/ui/share';

describe('shareable design links', () => {
  it('round-trips every preset through the URL hash', () => {
    for (const p of PRESETS) expect(decodeDesign(encodeDesign(p.inputs))).toEqual(p.inputs);
  });
  it('rejects malformed hashes', () => {
    expect(decodeDesign('#design=not-base64!!')).toBeNull();
    expect(decodeDesign('#other')).toBeNull();
  });
});
