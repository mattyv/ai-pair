import { afterEach, expect, it, vi } from 'vitest';
import { defaultFromDump, systemDefault } from '../src/linux_default';

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
afterEach(() => {
  vi.unstubAllEnvs();
  mocks.execFile.mockReset();
});

it('extracts only the default sink from the same PipeWire metadata graph', () => {
  const dump = [
    {
      type: 'PipeWire:Interface:Metadata',
      props: { 'metadata.name': 'default' },
      metadata: [{ subject: 0, key: 'default.audio.sink', value: { name: 'pair_test_null' } }],
    },
  ];
  expect(defaultFromDump(JSON.stringify(dump))).toBe('pair_test_null');
});

it('rejects missing, ambiguous, malformed and path-like default routes', () => {
  expect(defaultFromDump('bad json')).toBeUndefined();
  expect(defaultFromDump('{}')).toBeUndefined();
  const entry = { subject: 0, key: 'default.audio.sink', value: { name: '../other' } };
  const metadata = { type: 'PipeWire:Interface:Metadata', props: { 'metadata.name': 'default' }, metadata: [entry] };
  expect(defaultFromDump(JSON.stringify([metadata]))).toBeUndefined();
  entry.value.name = 'sink_a';
  expect(defaultFromDump(JSON.stringify([metadata, metadata]))).toBeUndefined();
});

it('ignores unrelated PipeWire objects and metadata before selecting the default', () => {
  const valid = { subject: 0, key: 'default.audio.sink', value: { name: 'sink_a' } };
  const dump = [
    0,
    { type: 'PipeWire:Interface:Node' },
    { type: 'PipeWire:Interface:Metadata', props: { 'metadata.name': 'other' }, metadata: [valid] },
    {
      type: 'PipeWire:Interface:Metadata',
      props: { 'metadata.name': 'default' },
      metadata: [0, { subject: 4, key: 'default.audio.sink', value: { name: 'wrong' } }, valid],
    },
  ];
  expect(defaultFromDump(JSON.stringify(dump))).toBe('sink_a');
});

it('reads the default from a bounded pw-dump invocation', async () => {
  vi.stubEnv('PIPEWIRE_REMOTE', '');
  const dump = JSON.stringify([
    {
      type: 'PipeWire:Interface:Metadata',
      props: { 'metadata.name': 'default' },
      metadata: [{ subject: 0, key: 'default.audio.sink', value: { name: 'sink_a' } }],
    },
  ]);
  mocks.execFile.mockImplementation(
    (
      program: string,
      args: string[],
      options: { timeout: number; maxBuffer: number },
      callback: (error: Error | null, stdout: string) => void,
    ) => {
      expect(program).toBe('pw-dump');
      expect(args).toEqual([]);
      expect(options.timeout).toBe(5000);
      expect(options.maxBuffer).toBe(1_048_576);
      // Node execFile uses null for a successful callback.
      // oxlint-disable-next-line unicorn/no-null
      callback(null, dump);
    },
  );
  await expect(systemDefault()).resolves.toBe('sink_a');
});

it('fails closed for remote graphs and process errors', async () => {
  vi.stubEnv('PIPEWIRE_REMOTE', 'remote');
  await expect(systemDefault()).resolves.toBeUndefined();
  expect(mocks.execFile).not.toHaveBeenCalled();
  vi.stubEnv('PIPEWIRE_REMOTE', '');
  mocks.execFile.mockImplementation(
    (program: string, args: string[], options: unknown, callback: (error: Error, stdout: string) => void) => {
      expect(program).toBe('pw-dump');
      expect(args).toEqual([]);
      expect(options).toBeDefined();
      callback(new Error('failure'), '');
    },
  );
  await expect(systemDefault()).resolves.toBeUndefined();
});

it('uses the local graph when no remote override is set', async () => {
  vi.stubEnv('PIPEWIRE_REMOTE', undefined);
  mocks.execFile.mockImplementation(
    (program: string, args: string[], options: unknown, callback: (error: Error | undefined, stdout: string) => void) => {
      expect(program).toBe('pw-dump');
      expect(args).toEqual([]);
      expect(options).toBeDefined();
      callback(undefined, '[]');
    },
  );
  await expect(systemDefault()).resolves.toBeUndefined();
  expect(mocks.execFile).toHaveBeenCalledOnce();
});
