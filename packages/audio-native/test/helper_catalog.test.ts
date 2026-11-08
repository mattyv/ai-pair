// The JSON wire protocol uses null when no system default exists.
/* oxlint-disable unicorn/no-null */
import { expect, it } from 'vitest';
import { parseCatalog } from '../src/helper_catalog';

it('accepts a bounded versioned helper catalog and concrete default', () => {
  expect(parseCatalog(JSON.stringify({ version: 1, devices: [{ id: 'id-a', label: 'A' }], defaultId: 'id-a' }))).toEqual({
    devices: [{ id: 'id-a', label: 'A' }],
    defaultId: 'id-a',
  });
});

it('rejects malformed, oversized, ambiguous or nonmember default catalogs', () => {
  expect(parseCatalog('bad')).toBeUndefined();
  expect(parseCatalog(' '.repeat(65_537))).toBeUndefined();
  expect(
    parseCatalog(
      JSON.stringify({
        version: 1,
        devices: [
          { id: 'a', label: 'A' },
          { id: 'a', label: 'B' },
        ],
        defaultId: 'a',
      }),
    ),
  ).toBeUndefined();
  expect(parseCatalog(JSON.stringify({ version: 1, devices: [], defaultId: 'missing' }))).toBeUndefined();
});

it('rejects invalid catalog envelopes and overlong device fields', () => {
  for (const value of [
    0,
    {},
    { version: 2, devices: [], defaultId: null },
    { version: 1, devices: 7, defaultId: null },
    { version: 1, devices: Array.from({ length: 65 }, (_, id) => ({ id: String(id), label: 'A' })), defaultId: null },
  ]) {
    expect(parseCatalog(JSON.stringify(value))).toBeUndefined();
  }
  for (const device of [
    0,
    {},
    { id: '', label: 'A' },
    { id: 'x'.repeat(513), label: 'A' },
    { id: 'a', label: 5 },
    { id: 'a', label: 'x'.repeat(257) },
  ]) {
    expect(parseCatalog(JSON.stringify({ version: 1, devices: [device], defaultId: null }))).toBeUndefined();
  }
  expect(parseCatalog(JSON.stringify({ version: 1, devices: [], defaultId: null }))).toEqual({ devices: [], defaultId: null });
});
