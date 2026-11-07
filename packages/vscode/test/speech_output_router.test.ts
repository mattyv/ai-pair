import { describe, expect, it, vi } from 'vitest';
import { SpeechOutputRouter } from '../src/speech_output_router';
import type { OutputChoice } from '../src/speech_output_types';

const native: OutputChoice = { kind: 'native', backend: 'pipewire', name: 'sink_a' };

describe('SpeechOutputRouter', () => {
  it('refuses an unavailable saved device before synthesis without falling back', async () => {
    const browser = { play: vi.fn(), control: vi.fn<(...args: unknown[]) => void>(), status: vi.fn<(...args: unknown[]) => void>() };
    const driver = { available: vi.fn(() => true), play: vi.fn(), control: vi.fn<(...args: unknown[]) => void>() };
    const router = new SpeechOutputRouter({
      driver,
      discover: () => Promise.resolve({ supported: false, devices: [] }),
      choice: () => native,
      defaultOutput: browser,
      currentPage: () => 7,
      audioEvent: vi.fn<(...args: unknown[]) => void>(),
    });
    expect(await router.prepare(1)).toBe(false);
    expect(router.play(1, new Uint8Array(44), 1000)).toBeUndefined();
    expect(browser.play).not.toHaveBeenCalled();
    expect(driver.play).not.toHaveBeenCalled();
  });

  it('invalidates pending discovery even if the same device is reselected', async () => {
    let resolve!: (value: { supported: boolean; devices: never[] }) => void;
    function discover(): Promise<{ supported: boolean; devices: never[] }> {
      return new Promise((done) => {
        resolve = done;
      });
    }
    const router = new SpeechOutputRouter({
      driver: { available: vi.fn(() => true), play: vi.fn(), control: vi.fn<(...args: unknown[]) => void>() },
      discover,
      choice: () => native,
      defaultOutput: { play: vi.fn(), control: vi.fn<(...args: unknown[]) => void>(), status: vi.fn<(...args: unknown[]) => void>() },
      currentPage: () => 7,
      audioEvent: vi.fn<(...args: unknown[]) => void>(),
    });
    const pending = router.prepare(1);
    router.invalidate();
    resolve({ supported: true, devices: [] });
    expect(await pending).toBe(false);
  });
});

it('does not let an older prepare replace a newer reservation', async () => {
  const first = Promise.withResolvers<{
    supported: boolean;
    devices: Array<{ choice: Extract<OutputChoice, { kind: 'native' }>; label: string; available: boolean }>;
  }>();
  const second = Promise.withResolvers<typeof first.promise extends Promise<infer T> ? T : never>();
  const discover = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const driver = { available: vi.fn(() => true), play: vi.fn(() => true), control: vi.fn<(...args: unknown[]) => void>() };
  const browser = { play: vi.fn(), control: vi.fn<(...args: unknown[]) => void>(), status: vi.fn<(...args: unknown[]) => void>() };
  const router = new SpeechOutputRouter({
    driver,
    discover,
    choice: () => native,
    defaultOutput: browser,
    currentPage: () => 7,
    audioEvent: vi.fn<(...args: unknown[]) => void>(),
  });
  const a = router.prepare(1);
  const b = router.prepare(2);
  const catalog = { supported: true, devices: [{ choice: native, label: 'A', available: true }] };
  second.resolve(catalog);
  expect(await b).toBe(true);
  first.resolve(catalog);
  expect(await a).toBe(false);
  expect(router.play(2, new Uint8Array(44), 1000)).toBe(7);
  expect(browser.play).not.toHaveBeenCalled();
});

it('a stale play cannot consume a newer reserved route', async () => {
  const driver = { available: vi.fn(() => true), play: vi.fn(() => true), control: vi.fn<(...args: unknown[]) => void>() };
  const router = new SpeechOutputRouter({
    driver,
    discover: () => Promise.resolve({ supported: true, devices: [{ choice: native, label: 'A', available: true }] }),
    choice: () => native,
    defaultOutput: { play: vi.fn(), control: vi.fn<(...args: unknown[]) => void>(), status: vi.fn<(...args: unknown[]) => void>() },
    currentPage: () => 7,
    audioEvent: vi.fn<(...args: unknown[]) => void>(),
  });
  expect(await router.prepare(2)).toBe(true);
  expect(router.play(1, new Uint8Array(44), 1000)).toBeUndefined();
  expect(router.play(2, new Uint8Array(44), 1000)).toBe(7);
});

it('uses the browser only for an explicitly reserved default route', async () => {
  const browser = {
    play: vi.fn(() => 3),
    control: vi.fn<(...args: unknown[]) => void>(),
    status: vi.fn<(...args: unknown[]) => void>(),
    localDiagnostic: vi.fn<(...args: unknown[]) => void>(),
  };
  const driver = { available: vi.fn(() => true), play: vi.fn(() => true), control: vi.fn<(...args: unknown[]) => void>() };
  const discover = vi.fn();
  const router = new SpeechOutputRouter({
    driver,
    discover,
    choice: () => ({ kind: 'default' }),
    defaultOutput: browser,
    currentPage: () => 3,
    audioEvent: vi.fn<(...args: unknown[]) => void>(),
  });
  expect(await router.prepare(9)).toBe(true);
  expect(discover).not.toHaveBeenCalled();
  expect(router.play(9, new Uint8Array(44), 1000)).toBe(3);
  router.control(9, 3, 'pause');
  router.status(9, 'speaking');
  router.localDiagnostic?.('ready');
  expect(browser.control).toHaveBeenCalledWith(9, 3, 'pause');
  expect(browser.status).toHaveBeenCalledWith(9, 'speaking', undefined);
  expect(browser.localDiagnostic).toHaveBeenCalledWith('ready', undefined);
  expect(driver.play).not.toHaveBeenCalled();
});

it('rejects failed discovery, a missing or unavailable device, and a changed epoch', async () => {
  const pending = Promise.withResolvers<{
    supported: boolean;
    devices: Array<{ choice: Extract<OutputChoice, { kind: 'native' }>; label: string; available: boolean }>;
  }>();
  const discover = vi
    .fn()
    .mockRejectedValueOnce(new Error('private'))
    .mockResolvedValueOnce({ supported: true, devices: [] })
    .mockResolvedValueOnce({ supported: true, devices: [{ choice: native, label: 'A', available: false }] })
    .mockReturnValueOnce(pending.promise);
  const browser = { play: vi.fn(), control: vi.fn<(...args: unknown[]) => void>(), status: vi.fn<(...args: unknown[]) => void>() };
  const driver = { available: vi.fn(() => true), play: vi.fn(), control: vi.fn<(...args: unknown[]) => void>() };
  const router = new SpeechOutputRouter({
    driver,
    discover,
    choice: () => native,
    defaultOutput: browser,
    currentPage: () => 7,
    audioEvent: vi.fn<(...args: unknown[]) => void>(),
  });
  expect(await router.prepare(1)).toBe(false);
  expect(await router.prepare(2)).toBe(false);
  expect(await router.prepare(3)).toBe(false);
  const last = router.prepare(4);
  router.invalidate();
  pending.resolve({ supported: true, devices: [{ choice: native, label: 'A', available: true }] });
  expect(await last).toBe(false);
  expect(browser.play).not.toHaveBeenCalled();
  expect(driver.play).not.toHaveBeenCalled();
});

it('requires a ready page and an accepted native process, without browser fallback', async () => {
  const browser = { play: vi.fn(), control: vi.fn<(...args: unknown[]) => void>(), status: vi.fn<(...args: unknown[]) => void>() };
  const driver = { available: vi.fn(() => true), play: vi.fn(() => false), control: vi.fn<(...args: unknown[]) => void>() };
  const currentPage = vi.fn<() => number | undefined>().mockReturnValueOnce(undefined).mockReturnValue(7);
  const router = new SpeechOutputRouter({
    driver,
    discover: () => Promise.resolve({ supported: true, devices: [{ choice: native, label: 'A', available: true }] }),
    choice: () => native,
    defaultOutput: browser,
    currentPage,
    audioEvent: vi.fn<(...args: unknown[]) => void>(),
  });
  expect(await router.prepare(1)).toBe(true);
  expect(router.play(1, new Uint8Array(44), 1000)).toBeUndefined();
  expect(driver.play).not.toHaveBeenCalled();
  expect(await router.prepare(2)).toBe(true);
  expect(router.play(2, new Uint8Array(44), 1000)).toBeUndefined();
  expect(browser.play).not.toHaveBeenCalled();
});

it('routes native control and defers owned events; stop rejects late callbacks', async () => {
  const browser = { play: vi.fn(), control: vi.fn<(...args: unknown[]) => void>(), status: vi.fn<(...args: unknown[]) => void>() };
  const driver = {
    available: vi.fn(() => true),
    play: vi.fn<(name: string, wav: Uint8Array, event: (kind: 'started' | 'ended' | 'failed') => void) => boolean>(() => true),
    control: vi.fn<(...args: unknown[]) => void>(),
  };
  const audioEvent = vi.fn<(...args: unknown[]) => void>();
  const router = new SpeechOutputRouter({
    driver,
    discover: () => Promise.resolve({ supported: true, devices: [{ choice: native, label: 'A', available: true }] }),
    choice: () => native,
    defaultOutput: browser,
    currentPage: () => 7,
    audioEvent,
  });
  expect(await router.prepare(1)).toBe(true);
  expect(router.play(1, new Uint8Array(44), 1000)).toBe(7);
  const callback = driver.play.mock.calls[0]?.[2];
  if (callback === undefined) throw new Error('Missing native callback');
  callback('started');
  expect(audioEvent).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(audioEvent).toHaveBeenCalledWith({ id: 1, pageId: 7, event: 'started' });
  router.control(1, 7, 'pause');
  router.control(1, 7, 'resume');
  router.control(1, 7, 'stop');
  expect(driver.control.mock.calls).toEqual([['pause'], ['resume'], ['stop']]);
  callback('ended');
  await Promise.resolve();
  expect(audioEvent).toHaveBeenCalledTimes(1);
});

it('forwards natural native completion once and invalidates an active route', async () => {
  const driver = {
    available: vi.fn(() => true),
    play: vi.fn<(name: string, wav: Uint8Array, event: (kind: 'started' | 'ended' | 'failed') => void) => boolean>(() => true),
    control: vi.fn<(...args: unknown[]) => void>(),
  };
  const audioEvent = vi.fn<(...args: unknown[]) => void>();
  const router = new SpeechOutputRouter({
    driver,
    discover: () => Promise.resolve({ supported: true, devices: [{ choice: native, label: 'A', available: true }] }),
    choice: () => native,
    defaultOutput: { play: vi.fn(), control: vi.fn<(...args: unknown[]) => void>(), status: vi.fn<(...args: unknown[]) => void>() },
    currentPage: () => 7,
    audioEvent,
  });
  expect(await router.prepare(1)).toBe(true);
  expect(router.play(1, new Uint8Array(44), 1000)).toBe(7);
  const first = driver.play.mock.calls[0]?.[2];
  if (first === undefined) throw new Error('Missing callback');
  first('ended');
  await Promise.resolve();
  first('failed');
  await Promise.resolve();
  expect(audioEvent.mock.calls).toEqual([[{ id: 1, pageId: 7, event: 'ended' }]]);
  expect(await router.prepare(2)).toBe(true);
  expect(router.play(2, new Uint8Array(44), 1000)).toBe(7);
  const second = driver.play.mock.calls[1]?.[2];
  if (second === undefined) throw new Error('Missing callback');
  router.invalidate();
  expect(driver.control).toHaveBeenCalledWith('stop');
  second('ended');
  await Promise.resolve();
  expect(audioEvent).toHaveBeenCalledTimes(1);
});

it('blocks default synthesis and playback while a canceled native child is retiring', async () => {
  const browser = { play: vi.fn(() => 3), control: vi.fn<(...args: unknown[]) => void>(), status: vi.fn<(...args: unknown[]) => void>() };
  const driver = { available: vi.fn(() => true), play: vi.fn(() => true), control: vi.fn<(...args: unknown[]) => void>() };
  let choice: OutputChoice = native;
  const router = new SpeechOutputRouter({
    driver,
    discover: () => Promise.resolve({ supported: true, devices: [{ choice: native, label: 'A', available: true }] }),
    choice: () => choice,
    defaultOutput: browser,
    currentPage: () => 3,
    audioEvent: vi.fn<(...args: unknown[]) => void>(),
  });
  expect(await router.prepare(1)).toBe(true);
  expect(router.play(1, new Uint8Array(44), 1000)).toBe(3);
  driver.available.mockReturnValue(false);
  router.invalidate();
  choice = { kind: 'default' };
  expect(await router.prepare(2)).toBe(false);
  expect(router.play(2, new Uint8Array(44), 1000)).toBeUndefined();
  expect(browser.play).not.toHaveBeenCalled();
  driver.available.mockReturnValue(true);
  expect(await router.prepare(3)).toBe(true);
  expect(router.play(3, new Uint8Array(44), 1000)).toBe(3);
});

it('rechecks native ownership before playing a prepared default route', async () => {
  const browser = { play: vi.fn(() => 3), control: vi.fn<(...args: unknown[]) => void>(), status: vi.fn<(...args: unknown[]) => void>() };
  const driver = { available: vi.fn(() => true), play: vi.fn(() => true), control: vi.fn<(...args: unknown[]) => void>() };
  const router = new SpeechOutputRouter({
    driver,
    discover: () => Promise.resolve({ supported: false, devices: [] }),
    choice: () => ({ kind: 'default' }),
    defaultOutput: browser,
    currentPage: () => 3,
    audioEvent: vi.fn<(...args: unknown[]) => void>(),
  });
  expect(await router.prepare(1)).toBe(true);
  driver.available.mockReturnValue(false);
  expect(router.play(1, new Uint8Array(44), 1000)).toBeUndefined();
  expect(browser.play).not.toHaveBeenCalled();
});

it('rejects admission if a native child becomes owned during discovery', async () => {
  const pending = Promise.withResolvers<{
    supported: boolean;
    devices: Array<{ choice: Extract<OutputChoice, { kind: 'native' }>; label: string; available: boolean }>;
  }>();
  const driver = { available: vi.fn(() => true), play: vi.fn(() => true), control: vi.fn<(...args: unknown[]) => void>() };
  const browser = { play: vi.fn(), control: vi.fn<(...args: unknown[]) => void>(), status: vi.fn<(...args: unknown[]) => void>() };
  const router = new SpeechOutputRouter({
    driver,
    discover: () => pending.promise,
    choice: () => native,
    defaultOutput: browser,
    currentPage: () => 3,
    audioEvent: vi.fn<(...args: unknown[]) => void>(),
  });
  const result = router.prepare(1);
  driver.available.mockReturnValue(false);
  pending.resolve({ supported: true, devices: [{ choice: native, label: 'A', available: true }] });
  expect(await result).toBe(false);
  expect(router.play(1, new Uint8Array(44), 1000)).toBeUndefined();
  expect(browser.play).not.toHaveBeenCalled();
  expect(driver.play).not.toHaveBeenCalled();
});

it('blocks native admission until the matching browser stop is acknowledged', async () => {
  const browser = { play: vi.fn(() => 3), control: vi.fn<(...args: unknown[]) => void>(), status: vi.fn<(...args: unknown[]) => void>() };
  const driver = { available: vi.fn(() => true), play: vi.fn(() => true), control: vi.fn<(...args: unknown[]) => void>() };
  const discover = vi.fn(() => Promise.resolve({ supported: true, devices: [{ choice: native, label: 'A', available: true }] }));
  let choice: OutputChoice = { kind: 'default' };
  const router = new SpeechOutputRouter({
    driver,
    discover,
    choice: () => choice,
    defaultOutput: browser,
    currentPage: () => 3,
    audioEvent: vi.fn<(...args: unknown[]) => void>(),
  });
  expect(await router.prepare(1)).toBe(true);
  expect(router.play(1, new Uint8Array(44), 1000)).toBe(3);
  router.control(1, 3, 'stop');
  router.invalidate();
  choice = native;
  expect(await router.prepare(2)).toBe(false);
  expect(discover).not.toHaveBeenCalled();
  router.browserRetired(2, 3);
  router.browserRetired(1, 4);
  expect(await router.prepare(3)).toBe(false);
  router.browserRetired(1, 3);
  expect(await router.prepare(4)).toBe(true);
  expect(router.play(4, new Uint8Array(44), 1000)).toBe(3);
});

it('only a requested stop or closure of the same page retires browser ownership', async () => {
  const browser = { play: vi.fn(() => 3), control: vi.fn<(...args: unknown[]) => void>(), status: vi.fn<(...args: unknown[]) => void>() };
  const driver = { available: vi.fn(() => true), play: vi.fn(() => true), control: vi.fn<(...args: unknown[]) => void>() };
  let choice: OutputChoice = { kind: 'default' };
  const router = new SpeechOutputRouter({
    driver,
    discover: () => Promise.resolve({ supported: true, devices: [{ choice: native, label: 'A', available: true }] }),
    choice: () => choice,
    defaultOutput: browser,
    currentPage: () => 3,
    audioEvent: vi.fn<(...args: unknown[]) => void>(),
  });
  expect(await router.prepare(1)).toBe(true);
  expect(router.play(1, new Uint8Array(44), 1000)).toBe(3);
  choice = native;
  router.browserRetired(1, 3);
  router.pageClosed(4);
  expect(await router.prepare(2)).toBe(false);
  router.pageClosed(3);
  expect(await router.prepare(3)).toBe(true);
});

it('does not retain browser ownership when a page rejects playback', async () => {
  const browser = {
    play: vi.fn(() => undefined),
    control: vi.fn<(...args: unknown[]) => void>(),
    status: vi.fn<(...args: unknown[]) => void>(),
  };
  const driver = { available: vi.fn(() => true), play: vi.fn(() => true), control: vi.fn<(...args: unknown[]) => void>() };
  const router = new SpeechOutputRouter({
    driver,
    discover: () => Promise.resolve({ supported: false, devices: [] }),
    choice: () => ({ kind: 'default' }),
    defaultOutput: browser,
    currentPage: () => undefined,
    audioEvent: vi.fn<(...args: unknown[]) => void>(),
  });
  expect(await router.prepare(1)).toBe(true);
  expect(router.play(1, new Uint8Array(44), 1000)).toBeUndefined();
  expect(await router.prepare(2)).toBe(true);
});
