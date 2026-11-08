// The mock models Node's ChildProcess, which is an EventEmitter.
/* oxlint-disable unicorn/prefer-event-target */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { HelperBackend } from '../src/helper_backend';

// A controllable transport fake; the framing implementation has its own tests.
vi.mock('../src/protocol', () => ({
  HelperEventFrames: class {
    private sequence = 0;
    private pending = '';
    constructor(private readonly emit: (event: { type: string }) => void) {}
    push(chunk: Uint8Array): boolean {
      this.pending += Buffer.from(chunk).toString('utf8');
      if (this.pending.length > 4096 && !this.pending.includes('\n')) return false;
      const lines = this.pending.split('\n');
      this.pending = lines.pop() ?? '';
      for (const line of lines) {
        let frame: unknown;
        try {
          frame = JSON.parse(line);
        } catch {
          return false;
        }
        if (
          typeof frame !== 'object' ||
          frame === null ||
          !('sequence' in frame) ||
          !('type' in frame) ||
          frame.sequence !== this.sequence ||
          typeof frame.type !== 'string'
        ) {
          return false;
        }
        this.sequence += 1;
        this.emit({ type: frame.type });
      }
      return true;
    }
    finish(): boolean {
      return this.pending.length === 0;
    }
  },
}));
vi.mock('../src/helper_catalog', () => ({
  parseCatalog: (text: string) => (text.includes('"devices"') ? { devices: [{ id: 'a', label: 'A' }], defaultId: 'a' } : undefined),
}));

const spawn = vi.hoisted(() => vi.fn());
const execFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn, execFile }));

it('sends the captured endpoint before PCM and keeps ownership through close', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const writes: string[] = [];
  child.stdin.on('data', (chunk: Buffer) => {
    writes.push(chunk.toString());
  });
  const backend = new HelperBackend('/trusted/bundled/helper', 'coreaudio');
  const emit = vi.fn<(...args: unknown[]) => void>();
  const handle = backend.start('device-a', new Uint8Array(44), emit);
  expect(JSON.parse(writes[0] ?? '')).toMatchObject({ sequence: 0, type: 'open', id: 'device-a' });
  child.stdout.write('{"version":1,"sequence":0,"type":"ready"}\n');
  expect(JSON.parse(writes[1] ?? '')).toMatchObject({ sequence: 1, type: 'play' });
  child.stdout.write('{"version":1,"sequence":1,"type":"started"}\n');
  expect(emit).toHaveBeenCalledWith('started');
  handle.stop();
  expect(JSON.parse(writes[2] ?? '')).toMatchObject({ sequence: 2, type: 'stop' });
  let closed = false;
  void handle.closed.then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  child.emit('close', 0);
  await handle.closed;
  expect(closed).toBe(true);
});

it('does not accept natural completion before the helper has started', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const emit = vi.fn<(...args: unknown[]) => void>();
  const handle = new HelperBackend('/trusted/bundled/helper', 'coreaudio').start('a', new Uint8Array(44), emit);
  child.stdout.write('{"version":1,"sequence":0,"type":"ended"}\n');
  expect(emit).toHaveBeenCalledWith('failed');
  expect(emit).not.toHaveBeenCalledWith('ended');
  expect(child.kill).toHaveBeenCalled();
  child.emit('close', 1);
  await handle.closed;
});

it('does not send audio while paused before helper readiness', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const writes: string[] = [];
  child.stdin.on('data', (chunk: Buffer) => {
    writes.push(chunk.toString());
  });
  const handle = new HelperBackend('/trusted/bundled/helper', 'coreaudio').start(
    'a',
    new Uint8Array(44),
    vi.fn<(...args: unknown[]) => void>(),
  );
  handle.pause();
  child.stdout.write('{"version":1,"sequence":0,"type":"ready"}\n');
  expect(writes).toHaveLength(1);
  handle.resume();
  expect(JSON.parse(writes[1] ?? '')).toMatchObject({ sequence: 1, type: 'play' });
  child.emit('close', 1);
  await handle.closed;
});

it('rejects retired before a terminal event and keeps the close promise pending after kill', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const events = vi.fn<(...args: unknown[]) => void>();
  const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), events);
  child.stdout.write('{"version":1,"sequence":0,"type":"retired"}\n');
  expect(events).toHaveBeenCalledWith('failed');
  expect(child.kill).toHaveBeenCalled();
  let closed = false;
  void handle.closed.then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  child.emit('close');
  await handle.closed;
});

it('rejects unsolicited pause acknowledgements', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const events = vi.fn<(...args: unknown[]) => void>();
  const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), events);
  child.stdout.write('{"version":1,"sequence":0,"type":"ready"}\n');
  child.stdout.write('{"version":1,"sequence":1,"type":"paused"}\n');
  expect(events).toHaveBeenCalledWith('failed');
  child.emit('close');
  await handle.closed;
});

it('reports unexpected process close as failure even after stop', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const events = vi.fn<(...args: unknown[]) => void>();
  const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), events);
  handle.stop();
  child.emit('close', 1);
  await handle.closed;
  expect(events).toHaveBeenCalledWith('failed');
  expect(events).not.toHaveBeenCalledWith('canceled');
});

it('discovers bounded catalog values and fails closed on discovery errors', async () => {
  execFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1);
    // The mocked execFile callback uses Node's normal completion signature.
    // oxlint-disable-next-line typescript/no-unsafe-call
    if (typeof callback === 'function') callback(undefined, '{"version":1,"devices":[{"id":"a","label":"A"}],"defaultId":"a"}', '');
  });
  const backend = new HelperBackend('/trusted/helper', 'coreaudio');
  expect(await backend.list()).toEqual([{ id: 'a', label: 'A' }]);
  expect(await backend.defaultId()).toBe('a');
  expect(await backend.capabilities()).toMatchObject({ defaultOutput: true, deviceSelection: true, pauseResume: true });
  execFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1);
    // oxlint-disable-next-line typescript/no-unsafe-call
    if (typeof callback === 'function') callback(new Error('private'), '', '');
  });
  expect(await backend.list()).toEqual([]);
  expect(await backend.defaultId()).toBeUndefined();
  expect(await backend.capabilities()).toMatchObject({ defaultOutput: false, deviceSelection: false, pauseResume: false });
});

it('accepts ordered start, pause, resume, drain and retirement', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const events = vi.fn<(...args: unknown[]) => void>();
  const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), events);
  child.stdout.write('{"version":1,"sequence":0,"type":"ready"}\n{"version":1,"sequence":1,"type":"started"}\n');
  handle.pause();
  handle.resume();
  child.stdout.write('{"version":1,"sequence":2,"type":"paused"}\n{"version":1,"sequence":3,"type":"resumed"}\n');
  child.stdout.write('{"version":1,"sequence":4,"type":"ended"}\n{"version":1,"sequence":5,"type":"retired"}\n');
  child.stdout.end();
  child.emit('close');
  await handle.closed;
  expect(events.mock.calls).toEqual([['started'], ['ended']]);
  expect(child.kill).not.toHaveBeenCalled();
});

it('forces a stalled helper to terminate but waits for the actual close', async () => {
  vi.useFakeTimers();
  try {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
    spawn.mockReturnValueOnce(child);
    const events = vi.fn<(...args: unknown[]) => void>();
    const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), events);
    vi.advanceTimersByTime(5000);
    expect(events).toHaveBeenCalledWith('failed');
    expect(child.kill).toHaveBeenCalledOnce();
    let closed = false;
    void handle.closed.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    child.emit('close');
    await handle.closed;
  } finally {
    vi.useRealTimers();
  }
});

it('fails on malformed, oversized, truncated, and repeated frames', async () => {
  for (const text of [
    'bad\n',
    'x'.repeat(4097),
    '{"version":1',
    '{"version":1,"sequence":0,"type":"ready"}\n{"version":1,"sequence":0,"type":"ready"}\n',
  ]) {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
    spawn.mockReturnValueOnce(child);
    const events = vi.fn<(...args: unknown[]) => void>();
    const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), events);
    child.stdout.write(text);
    child.stdout.emit('end');
    expect(events).toHaveBeenCalledWith('failed');
    child.emit('close');
    await handle.closed;
  }
});

it('fails closed on pipe errors and helper failure, and ignores later controls', async () => {
  for (const mode of ['pipe', 'spawn', 'helper']) {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
    spawn.mockReturnValueOnce(child);
    const events = vi.fn<(...args: unknown[]) => void>();
    const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), events);
    if (mode === 'pipe') child.stdin.emit('error', new Error('EPIPE'));
    if (mode === 'spawn') child.emit('error', new Error('spawn'));
    if (mode === 'helper') child.stdout.write('{"version":1,"sequence":0,"type":"failed"}\n{"version":1,"sequence":1,"type":"retired"}\n');
    handle.pause();
    handle.resume();
    handle.stop();
    child.emit('close');
    await handle.closed;
    expect(events.mock.calls).toEqual([['failed']]);
  }
});

it('does not publish a natural end if the helper violates retirement ordering', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const events = vi.fn<(...args: unknown[]) => void>();
  const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), events);
  child.stdout.write(
    '{"version":1,"sequence":0,"type":"ready"}\n{"version":1,"sequence":1,"type":"started"}\n{"version":1,"sequence":2,"type":"ended"}\n{"version":1,"sequence":3,"type":"started"}\n',
  );
  child.emit('close');
  await handle.closed;
  expect(events.mock.calls).toEqual([['started'], ['failed']]);
});

it('requires cancellation acknowledgement and retires only at process close', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const events = vi.fn<(...args: unknown[]) => void>();
  const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), events);
  handle.stop();
  child.stdout.write(
    '{"version":1,"sequence":0,"type":"ready"}\n{"version":1,"sequence":1,"type":"canceled"}\n{"version":1,"sequence":2,"type":"retired"}\n',
  );
  expect(events).not.toHaveBeenCalled();
  child.emit('close');
  await handle.closed;
  expect(events.mock.calls).toEqual([['canceled']]);
});

it('fails when a write throws synchronously', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  vi.spyOn(child.stdin, 'write').mockImplementation(() => {
    throw new Error('EPIPE');
  });
  spawn.mockReturnValueOnce(child);
  const events = vi.fn<(...args: unknown[]) => void>();
  const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), events);
  expect(events).toHaveBeenCalledWith('failed');
  child.emit('close');
  await handle.closed;
});

it('rejects duplicate readiness, unsolicited starts and unsolicited cancellation', async () => {
  for (const frames of [
    '{"version":1,"sequence":0,"type":"ready"}\n{"version":1,"sequence":1,"type":"ready"}\n',
    '{"version":1,"sequence":0,"type":"started"}\n',
    '{"version":1,"sequence":0,"type":"canceled"}\n',
  ]) {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
    spawn.mockReturnValueOnce(child);
    const events = vi.fn<(...args: unknown[]) => void>();
    const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), events);
    child.stdout.write(frames);
    expect(events).toHaveBeenCalledWith('failed');
    child.emit('close');
    await handle.closed;
  }
});

it('keeps ownership when the operating system rejects termination', async () => {
  vi.useFakeTimers();
  try {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill: vi.fn(() => {
        throw new Error('kill');
      }),
    });
    spawn.mockReturnValueOnce(child);
    const events = vi.fn<(...args: unknown[]) => void>();
    const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), events);
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    let closed = false;
    void handle.closed.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    child.emit('close');
    await handle.closed;
  } finally {
    vi.useRealTimers();
  }
});

it('treats synchronous discovery launch failure as unavailable', async () => {
  execFile.mockImplementationOnce(() => {
    throw new Error('spawn');
  });
  await expect(new HelperBackend('/trusted/helper', 'coreaudio').list()).resolves.toEqual([]);
});

it('suppresses a late start and natural drain after cancellation', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const events = vi.fn<(...args: unknown[]) => void>();
  const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), events);
  child.stdout.write('{"version":1,"sequence":0,"type":"ready"}\n');
  handle.stop();
  child.stdout.write(
    '{"version":1,"sequence":1,"type":"started"}\n{"version":1,"sequence":2,"type":"ended"}\n{"version":1,"sequence":3,"type":"retired"}\n',
  );
  child.emit('close');
  await handle.closed;
  expect(events.mock.calls).toEqual([['canceled']]);
});

it('waits for queued pause acknowledgement after start', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), vi.fn<(...args: unknown[]) => void>());
  child.stdout.write('{"version":1,"sequence":0,"type":"ready"}\n');
  handle.pause();
  child.stdout.write('{"version":1,"sequence":1,"type":"started"}\n{"version":1,"sequence":2,"type":"paused"}\n');
  handle.stop();
  child.stdout.write('{"version":1,"sequence":3,"type":"canceled"}\n{"version":1,"sequence":4,"type":"retired"}\n');
  child.emit('close');
  await handle.closed;
});

it('ignores extra frames after a protocol failure', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const events = vi.fn<(...args: unknown[]) => void>();
  const handle = new HelperBackend('/trusted/helper', 'coreaudio').start('a', new Uint8Array(44), events);
  child.stdout.write('{"version":1,"sequence":0,"type":"started"}\n{"version":1,"sequence":1,"type":"ready"}\n');
  child.emit('close');
  await handle.closed;
  expect(events.mock.calls).toEqual([['failed']]);
});

it('reports the trusted platform backend identity in capabilities', async () => {
  execFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1);
    // oxlint-disable-next-line typescript/no-unsafe-call
    if (typeof callback === 'function') callback(undefined, '{"devices":[]}', '');
  });
  expect(await new HelperBackend('/trusted/helper', 'coreaudio').capabilities()).toMatchObject({
    backend: 'coreaudio',
    deviceSelection: true,
  });
  expect(await new HelperBackend('/trusted/helper', 'wasapi').capabilities()).toMatchObject({ backend: 'wasapi', deviceSelection: true });
});
