import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoredSetting, settleWithin } from '../src/setting_store';

afterEach(() => {
  vi.useRealTimers();
});

/** A setting whose writes the test settles by hand, and whose stored value it changes. */
function harness(initial: string): {
  setting: StoredSetting<string>;
  stored: { value: string };
  writes: Array<PromiseWithResolvers<void> & { value: string }>;
  failed: ReturnType<typeof vi.fn<(value: string, error: unknown) => void>>;
} {
  const stored = { value: initial };
  const writes: Array<PromiseWithResolvers<void> & { value: string }> = [];
  const failed = vi.fn<(value: string, error: unknown) => void>();
  const setting = new StoredSetting<string>({
    read: () => stored.value,
    write: (value) => {
      const write = { ...Promise.withResolvers<void>(), value };
      writes.push(write);
      return write.promise;
    },
    failed,
  });
  return { setting, stored, writes, failed };
}

describe('a stored setting (#119)', () => {
  it('ShowsChoice: reads the requested value while its write is in flight, then the stored one', async () => {
    const h = harness('newestFirst');
    expect(h.setting.get()).toBe('newestFirst');
    const done = h.setting.set('oldestFirst');
    expect(h.setting.get()).toBe('oldestFirst');
    h.stored.value = 'oldestFirst';
    h.writes[0]?.resolve();
    await done;
    expect(h.setting.get()).toBe('oldestFirst');
    h.stored.value = 'newestFirst';
    expect(h.setting.get()).toBe('newestFirst');
  });

  it('ShowsChoice: an older write landing never replaces a newer choice', async () => {
    const h = harness('typing');
    const first = h.setting.set('lines');
    const second = h.setting.set('blocks');
    h.stored.value = 'lines';
    h.writes[0]?.resolve();
    await first;
    expect(h.setting.get()).toBe('blocks');
    h.stored.value = 'blocks';
    h.writes[1]?.resolve();
    await second;
    expect(h.setting.get()).toBe('blocks');
  });

  it('ShowsChoice: keeps the choice until the stored value catches up with a write that already landed', async () => {
    const h = harness('typing');
    const done = h.setting.set('lines');
    h.writes[0]?.resolve();
    await done;
    expect(h.setting.get()).toBe('lines');
    h.setting.changed();
    expect(h.setting.get()).toBe('typing');
    const again = h.setting.set('blocks');
    h.writes[1]?.resolve();
    await again;
    expect(h.setting.get()).toBe('blocks');
    h.stored.value = 'blocks';
    expect(h.setting.get()).toBe('blocks');
    // Caught up, the choice is dropped: a later change made elsewhere shows.
    h.stored.value = 'typing';
    expect(h.setting.get()).toBe('typing');
  });

  it('NoSilentFailure, SettledTruth: reports only the latest failed write, and then reads the stored value', async () => {
    const h = harness('typing');
    const first = h.setting.set('lines');
    const second = h.setting.set('blocks');
    h.writes[0]?.reject(new Error('older'));
    await first;
    expect(h.failed).not.toHaveBeenCalled();
    expect(h.setting.get()).toBe('blocks');
    h.writes[1]?.reject(new Error('latest'));
    await second;
    expect(h.failed).toHaveBeenCalledExactlyOnceWith('blocks', new Error('latest'));
    expect(h.setting.get()).toBe('typing');
  });

  it('NoSilentFailure: treats a write that throws at once as failed', async () => {
    const failed = vi.fn<(value: number, error: unknown) => void>();
    const setting = new StoredSetting<number>({
      read: () => 1,
      write: () => {
        throw new Error('no settings');
      },
      failed,
    });
    setting.changed();
    await setting.set(2);
    expect(failed).toHaveBeenCalledExactlyOnceWith(2, new Error('no settings'));
    expect(setting.get()).toBe(1);
  });

  it('NoLostWrite: settles once every write in flight has landed or failed', async () => {
    const h = harness('a');
    void h.setting.set('b');
    void h.setting.set('c');
    let settled = false;
    const all = h.setting.settled().then(() => {
      settled = true;
    });
    h.writes[0]?.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    h.writes[1]?.reject(new Error('gone'));
    await all;
    expect(settled).toBe(true);
    await expect(h.setting.settled()).resolves.toBeUndefined();
  });

  it('NoLostWrite: a reload waits for writes in flight, but no longer than its bound', async () => {
    vi.useFakeTimers();
    const quick = harness('a');
    const stuck = harness('a');
    void quick.setting.set('b');
    void stuck.setting.set('b');
    let done = false;
    const flushed = settleWithin([quick.setting, stuck.setting], 1000).then(() => {
      done = true;
    });
    quick.writes[0]?.resolve();
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flushed;
    expect(done).toBe(true);
  });

  it('NoLostWrite: a reload with nothing in flight goes at once', async () => {
    vi.useFakeTimers();
    const idle = harness('a');
    await expect(settleWithin([idle.setting], 1000)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
