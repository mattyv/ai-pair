import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ dump: '', help: '--pdeathsig', fail: false, calls: [] as string[] }));
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: (program: string, args: string[], options: unknown, done: (error: Error | undefined, text: string) => void) => {
    void args;
    void options;
    fake.calls.push(program);
    if (fake.fail) {
      done(new Error('unavailable'), '');
      return;
    }
    done(undefined, program === 'pw-dump' ? fake.dump : program === 'setpriv' ? fake.help : 'pw-play 1');
  },
}));
import { discoverOutputs } from '../src/speech_native_output';

function sink(name: string, description?: string) {
  return {
    type: 'PipeWire:Interface:Node',
    info: { props: { 'media.class': 'Audio/Sink', 'node.name': name, 'node.description': description } },
  };
}
const invalidProps: unknown = JSON.parse('null');
const remote = process.env.PIPEWIRE_REMOTE;
const hostPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
beforeEach(() => {
  // PipeWire discovery runs only on Linux; the tests pin it so they pass on any host.
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  delete process.env.PIPEWIRE_REMOTE;
  fake.dump = JSON.stringify([sink('test.sink', 'Test speakers')]);
  fake.help = '--pdeathsig';
  fake.fail = false;
  fake.calls = [];
});
afterEach(() => {
  if (hostPlatform !== undefined) Object.defineProperty(process, 'platform', hostPlatform);
  if (remote === undefined) delete process.env.PIPEWIRE_REMOTE;
  else process.env.PIPEWIRE_REMOTE = remote;
});
describe('output discovery', () => {
  it('discovers named PipeWire sinks without pactl', async () => {
    expect(await discoverOutputs()).toEqual({
      supported: true,
      devices: [{ choice: { kind: 'native', backend: 'pipewire', name: 'test.sink' }, label: 'Test speakers', available: true }],
    });
    expect(fake.calls).toEqual(['pw-dump', 'pw-play', 'setpriv']);
  });
  it('refuses an explicitly selected PipeWire remote', async () => {
    process.env.PIPEWIRE_REMOTE = 'remote';
    expect(await discoverOutputs()).toMatchObject({ supported: false, devices: [] });
    expect(fake.calls).toEqual([]);
  });
  it('does not report malformed or unavailable programs as usable', async () => {
    fake.dump = 'not json';
    expect(await discoverOutputs()).toMatchObject({ supported: false, devices: [] });
    fake.fail = true;
    expect(await discoverOutputs()).toMatchObject({ supported: false, devices: [] });
  });
  it('rejects missing process-death protection', async () => {
    fake.help = '';
    expect(await discoverOutputs()).toMatchObject({ supported: false, reason: 'unsupported' });
  });
  it('rejects malformed lists and filters non-sinks and unsafe names', async () => {
    fake.dump = JSON.stringify({});
    expect(await discoverOutputs()).toMatchObject({ supported: false, reason: 'invalid' });
    fake.dump = JSON.stringify([
      undefined,
      {},
      { type: 'other' },
      { type: 'PipeWire:Interface:Node' },
      { type: 'PipeWire:Interface:Node', info: { props: invalidProps } },
      { type: 'PipeWire:Interface:Node', info: {} },
      { type: 'PipeWire:Interface:Node', info: { props: {} } },
      { type: 'PipeWire:Interface:Node', info: { props: { 'media.class': 'Audio/Source', 'node.name': 'source' } } },
      sink('../bad'),
      sink('ok'),
    ]);
    expect(await discoverOutputs()).toEqual({
      supported: true,
      devices: [{ choice: { kind: 'native', backend: 'pipewire', name: 'ok' }, label: 'ok', available: true }],
    });
  });
  it('bounds labels and the number of sinks after unrelated nodes', async () => {
    fake.dump = JSON.stringify([{}, ...Array.from({ length: 65 }, (_, index) => sink(`sink.${index}`, 'x'.repeat(201)))]);
    const result = await discoverOutputs();
    expect(result.devices).toHaveLength(64);
    expect(result.devices[0]?.label).toHaveLength(200);
  });
  it('allows an empty remote override', async () => {
    process.env.PIPEWIRE_REMOTE = '';
    expect(await discoverOutputs()).toMatchObject({ supported: true });
  });
  it('reports unsupported hosts without starting commands', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      expect(await discoverOutputs()).toMatchObject({ supported: false, reason: 'unsupported' });
    } finally {
      if (original !== undefined) Object.defineProperty(process, 'platform', original);
    }
  });
});
