import { describe, expect, it } from 'vitest';

import { formatPayload, selectFormat } from '../server/output-format.js';

describe('selectFormat', () => {
  it('returns the requested mode when explicit', () => {
    expect(selectFormat({ flows: [] }, 'json')).toBe('json');
    expect(selectFormat({ flows: [] }, 'toon')).toBe('toon');
  });

  it("auto picks 'json' when there's no tabular sub-shape", () => {
    expect(selectFormat({ ok: true, message: 'hi' }, 'auto')).toBe('json');
  });

  it("auto picks 'json' when arrays are too short to amortize the TOON header", () => {
    expect(selectFormat({ flows: [{ id: 'a' }, { id: 'b' }] }, 'auto')).toBe('json');
  });

  it("auto picks 'toon' for arrays of homogeneous objects ≥ threshold", () => {
    const flows = [
      { id: 'a', name: 'one' },
      { id: 'b', name: 'two' },
      { id: 'c', name: 'three' },
    ];
    expect(selectFormat({ flows }, 'auto')).toBe('toon');
  });

  it("auto stays 'json' when array shapes diverge (rows have different keys)", () => {
    const mixed = [
      { id: 'a', name: 'one' },
      { id: 'b' }, // missing key
      { id: 'c', name: 'three' },
    ];
    expect(selectFormat({ items: mixed }, 'auto')).toBe('json');
  });

  it('finds tabular sub-shapes nested inside objects', () => {
    const payload = {
      total: 5,
      data: {
        items: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
          { x: 5, y: 6 },
        ],
      },
    };
    expect(selectFormat(payload, 'auto')).toBe('toon');
  });
});

describe('formatPayload', () => {
  it('emits valid JSON when format is json', () => {
    const r = formatPayload({ a: 1 }, 'json');
    expect(r.format).toBe('json');
    expect(JSON.parse(r.text)).toEqual({ a: 1 });
  });

  it('emits TOON for tabular auto-detected payloads', () => {
    const flows = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, name: `Flow ${i}` }));
    const r = formatPayload({ flows }, 'auto');
    expect(r.format).toBe('toon');
    // TOON's tabular form lists the keys once on the header row.
    // Verify the output mentions both keys without repeating them on
    // every record line.
    expect(r.text).toContain('id');
    expect(r.text).toContain('name');
    const idCount = r.text.match(/\bid\b/g)?.length ?? 0;
    expect(idCount).toBeLessThan(flows.length);
  });

  it('TOON output is shorter than indented JSON for tabular data', () => {
    const ops = Array.from({ length: 25 }, (_, i) => ({
      operationId: `Op_${i}`,
      method: 'POST',
      path: `/v1/things/${i}`,
      summary: `Operation number ${i}`,
    }));
    const json = formatPayload({ operations: ops }, 'json');
    const toon = formatPayload({ operations: ops }, 'toon');
    expect(toon.text.length).toBeLessThan(json.text.length);
    // The win on this shape should be substantial — at least 30%.
    expect(toon.text.length / json.text.length).toBeLessThan(0.7);
  });
});
