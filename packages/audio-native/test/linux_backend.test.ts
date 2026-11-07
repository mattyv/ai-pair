import { expect, it, vi } from 'vitest';
import { LinuxBackend } from '../src/linux_backend';

const defaults = vi.hoisted(() => ({ discover: vi.fn(), systemDefault: vi.fn(), available: vi.fn(), play: vi.fn(), control: vi.fn() }));
vi.mock('../../vscode/src/speech_native_output', () => ({
  discoverOutputs: defaults.discover,
  NativeOutputDriver: class {
    available = defaults.available;
    play = defaults.play;
    control = defaults.control;
  },
}));
vi.mock('../src/linux_default', () => ({ systemDefault: defaults.systemDefault }));

it('maps the proven PipeWire discovery to local output IDs and resolves the concrete default', async () => {
  const driver = { play: vi.fn(), control: vi.fn(), available: vi.fn(() => true) };
  const backend = new LinuxBackend({
    driver,
    discover: () =>
      Promise.resolve({
        supported: true,
        devices: [{ choice: { kind: 'native', backend: 'pipewire', name: 'sink_a' }, label: 'A', available: true }],
      }),
    defaultSink: () => Promise.resolve('sink_a'),
  });
  await expect(backend.list()).resolves.toEqual([{ id: 'sink_a', label: 'A' }]);
  await expect(backend.defaultId()).resolves.toBe('sink_a');
});

it('holds the child until the existing driver confirms it has closed', async () => {
  let available = true;
  const control = vi.fn<(...args: unknown[]) => void>();
  const driver = {
    play: vi.fn(() => {
      available = false;
      return true;
    }),
    control,
    available: vi.fn(() => available),
  };
  const backend = new LinuxBackend({ driver, discover: vi.fn(), defaultSink: vi.fn() });
  const onEvent = vi.fn<(...args: unknown[]) => void>();
  const child = backend.start('sink_a', new Uint8Array(44), onEvent);
  child.stop();
  expect(control).toHaveBeenCalledWith('stop');
  let retired = false;
  void child.closed.then(() => {
    retired = true;
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 30);
  });
  expect(retired).toBe(false);
  available = true;
  await child.closed;
  expect(retired).toBe(true);
});

it('does not advertise system default when no concrete local sink resolves', async () => {
  const driver = { play: vi.fn(), control: vi.fn(), available: vi.fn(() => true) };
  const backend = new LinuxBackend({
    driver,
    discover: () => Promise.resolve({ supported: true, devices: [] }),
    defaultSink: () => Promise.resolve(undefined),
  });
  expect(await backend.capabilities()).toMatchObject({ backend: 'pipewire', deviceSelection: true, defaultOutput: false });
});

it('handles stream controls and reports exactly one terminal outcome', async () => {
  let available = true;
  let callback: ((type: 'started' | 'ended' | 'failed') => void) | undefined;
  const control = vi.fn<(...args: unknown[]) => void>();
  const driver = {
    available: vi.fn(() => available),
    control,
    play: vi.fn((name: string, bytes: Uint8Array, event: (type: 'started' | 'ended' | 'failed') => void) => {
      expect(name).toBe('sink_a');
      expect(bytes.byteLength).toBe(44);
      callback = event;
      available = false;
      return true;
    }),
  };
  const backend = new LinuxBackend({
    driver,
    discover: () => Promise.resolve({ supported: false, devices: [] }),
    defaultSink: () => Promise.resolve(undefined),
  });
  expect(await backend.capabilities()).toMatchObject({ defaultOutput: false, deviceSelection: false });
  expect(await backend.list()).toEqual([]);
  const events = vi.fn<(...args: unknown[]) => void>();
  const handle = backend.start('sink_a', new Uint8Array(44), events);
  callback?.('started');
  handle.pause();
  handle.resume();
  callback?.('failed');
  handle.pause();
  handle.resume();
  handle.stop();
  callback?.('ended');
  expect(events.mock.calls.map(([type]) => type)).toEqual(['started', 'failed']);
  expect(control.mock.calls.map(([action]) => action)).toEqual(['pause', 'resume']);
  available = true;
  await handle.closed;
});

it('refuses a busy driver, invalid sink, or failed process start', () => {
  const driver = { available: vi.fn(() => false), play: vi.fn(() => false), control: vi.fn<(...args: unknown[]) => void>() };
  const backend = new LinuxBackend({ driver });
  const emit = vi.fn<(...args: unknown[]) => void>();
  expect(() => backend.start('sink_a', new Uint8Array(44), emit)).toThrow();
  driver.available.mockReturnValue(true);
  expect(() => backend.start('../bad', new Uint8Array(44), emit)).toThrow();
  expect(() => backend.start('sink_a', new Uint8Array(44), emit)).toThrow();
});

it('uses its default collaborators only after successful local discovery', async () => {
  defaults.discover.mockResolvedValue({
    supported: true,
    devices: [{ choice: { kind: 'native', backend: 'pipewire', name: 'sink_a' }, label: 'A', available: true }],
  });
  defaults.systemDefault.mockResolvedValue('sink_a');
  const backend = new LinuxBackend();
  expect(await backend.capabilities()).toMatchObject({ defaultOutput: true, deviceSelection: true });
  expect(await backend.defaultId()).toBe('sink_a');
});
