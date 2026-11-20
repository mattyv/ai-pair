import { describe, expect, it } from 'vitest';
import { EVENT_SCHEMA, WORKER_CAPABILITY_LIMIT, WORKER_GRANT_SCHEMA, WORKER_PROVIDER_SCHEMA, WORKER_TEXT_LIMIT } from '../src/schemas';

describe('worker wire values', () => {
  it('accepts a bounded completion and rejects an oversized one', () => {
    expect(EVENT_SCHEMA.parse({ kind: 'worker_complete', text: 'done' })).toEqual({ kind: 'worker_complete', text: 'done' });
    expect(EVENT_SCHEMA.safeParse({ kind: 'worker_complete', text: 'x'.repeat(WORKER_TEXT_LIMIT + 1) }).success).toBe(false);
  });

  it('requires a valid port and a bounded nonempty capability', () => {
    expect(WORKER_GRANT_SCHEMA.safeParse({ port: 1234, capability: 'secret' }).success).toBe(true);
    expect(WORKER_GRANT_SCHEMA.safeParse({ port: 0, capability: 'secret' }).success).toBe(false);
    expect(WORKER_GRANT_SCHEMA.safeParse({ port: 1234, capability: '' }).success).toBe(false);
    expect(WORKER_GRANT_SCHEMA.safeParse({ port: 1234, capability: 'x'.repeat(WORKER_CAPABILITY_LIMIT + 1) }).success).toBe(false);
  });
});

it('accepts only the supported worker providers', () => {
  expect(WORKER_PROVIDER_SCHEMA.safeParse('codex').success).toBe(true);
  expect(WORKER_PROVIDER_SCHEMA.safeParse('claude').success).toBe(true);
  expect(WORKER_PROVIDER_SCHEMA.safeParse('other').success).toBe(false);
});
