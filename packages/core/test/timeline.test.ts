// The timeline's sleeps, pauses, and interrupts (specs/Timeline.tla). timeline.ts imports nothing, so the test needs no
// mocks; fake timers stand in for the clock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { instant, Timeline } from '../src/timeline';

describe('timeline', () => {
  const sleepMs = 100;
  const longerSleepMs = 300;
  const beforePauseMs = 40;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ResolvedOnce: resolves an interrupted sleep false once, and the next sleep after reset only when its own time is up', async () => {
    const timeline = new Timeline(/* paused= */ false);
    const results: boolean[] = [];
    void timeline.sleep(sleepMs).then((completed) => {
      results.push(completed);
    });
    timeline.interrupt();
    await vi.advanceTimersByTimeAsync(sleepMs);
    expect(results).toEqual([false]);
    expect(await timeline.sleep(sleepMs)).toBe(false);

    timeline.reset();
    void timeline.sleep(longerSleepMs).then((completed) => {
      results.push(completed);
    });
    await vi.advanceTimersByTimeAsync(longerSleepMs - sleepMs);
    expect(results).toEqual([false]);
    await vi.advanceTimersByTimeAsync(sleepMs);
    expect(results).toEqual([false, true]);
  });

  it('NoTimerWhilePaused, ResumeContinues: pauses a sleep with its time left, and resumes it for only that', async () => {
    const timeline = new Timeline(/* paused= */ false);
    const results: boolean[] = [];
    void timeline.sleep(sleepMs).then((completed) => {
      results.push(completed);
    });
    await vi.advanceTimersByTimeAsync(beforePauseMs);
    timeline.pause();
    await vi.advanceTimersByTimeAsync(sleepMs);
    expect(results).toEqual([]);

    timeline.resume();
    await vi.advanceTimersByTimeAsync(sleepMs - beforePauseMs - 1);
    expect(results).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(results).toEqual([true]);
  });

  it('ResumeContinues: holds a sleep begun while paused until the resume, then runs all of its time', async () => {
    const timeline = new Timeline(/* paused= */ true);
    const results: boolean[] = [];
    void timeline.sleep(sleepMs).then((completed) => {
      results.push(completed);
    });
    await vi.advanceTimersByTimeAsync(sleepMs);
    expect(results).toEqual([]);

    timeline.resume();
    await vi.advanceTimersByTimeAsync(sleepMs);
    expect(results).toEqual([true]);
  });

  it('LatestPending: an earlier sleep that runs out leaves the later sleep that replaced it pending, for an interrupt to cut short', async () => {
    const timeline = new Timeline(/* paused= */ false);
    const results: boolean[] = [];
    void timeline.sleep(sleepMs).then((completed) => {
      results.push(completed);
    });
    void timeline.sleep(longerSleepMs).then((completed) => {
      results.push(completed);
    });
    await vi.advanceTimersByTimeAsync(sleepMs);
    expect(results).toEqual([true]);

    timeline.interrupt();
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toEqual([true, false]);
  });

  it('leaves a sleep that was never paused on its own deadline when it is resumed', async () => {
    const timeline = new Timeline(/* paused= */ false);
    const results: boolean[] = [];
    void timeline.sleep(sleepMs).then((completed) => {
      results.push(completed);
    });
    await vi.advanceTimersByTimeAsync(beforePauseMs);
    timeline.resume();
    await vi.advanceTimersByTimeAsync(sleepMs - beforePauseMs - 1);
    expect(results).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(results).toEqual([true]);
  });

  it('is interrupted, its signal aborted, from an interrupt until the reset, which gives it a new signal', () => {
    const timeline = new Timeline(/* paused= */ false);
    const first = timeline.signal;
    // Not interrupted: the reset keeps the signal.
    timeline.reset();
    expect(timeline.signal).toBe(first);
    // No sleep pending: only the flag and the signal change.
    timeline.interrupt();
    expect(timeline.isInterrupted).toBe(true);
    expect(first.aborted).toBe(true);
    timeline.reset();
    expect(timeline.isInterrupted).toBe(false);
    expect(timeline.signal).not.toBe(first);
    expect(timeline.signal.aborted).toBe(false);
  });

  it('takes a pause or a resume with no sleep pending, and a second pause, as nothing more', async () => {
    const timeline = new Timeline(/* paused= */ false);
    timeline.pause();
    timeline.pause();
    timeline.resume();
    timeline.pause();
    const results: boolean[] = [];
    void timeline.sleep(sleepMs).then((completed) => {
      results.push(completed);
    });
    timeline.resume();
    await vi.advanceTimersByTimeAsync(sleepMs);
    expect(results).toEqual([true]);
  });
});

describe('instant', () => {
  it('never waits, and is never interrupted', async () => {
    expect(await instant.sleep(1000)).toBe(true);
    expect(instant.isInterrupted).toBe(false);
    expect(instant.signal.aborted).toBe(false);
  });
});

describe('finishing a reading countdown', () => {
  it('FinishEarly: completes the current timer once without interrupting later sleeps', async () => {
    vi.useFakeTimers();
    try {
      const timeline = new Timeline(false);
      timeline.finish();
      const first = timeline.sleep(1000);
      timeline.finish();
      expect(await first).toBe(true);
      expect(timeline.isInterrupted).toBe(false);
      const second = timeline.sleep(50);
      await vi.advanceTimersByTimeAsync(50);
      expect(await second).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('NoTimerWhilePaused: does not finish a timer held by a pause', async () => {
    vi.useFakeTimers();
    try {
      const timeline = new Timeline(true);
      let finished = false;
      void timeline.sleep(100).then(() => {
        finished = true;
      });
      timeline.finish();
      await vi.advanceTimersByTimeAsync(100);
      expect(finished).toBe(false);
      timeline.resume();
      await vi.advanceTimersByTimeAsync(100);
      expect(finished).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('holding a reading timer', () => {
  it('NoTimerWhileHeld: holds only the remaining time and resumes it on release', async () => {
    vi.useFakeTimers();
    try {
      const timeline = new Timeline(false);
      let completed = false;
      void timeline.sleep(1000).then(() => {
        completed = true;
      });
      await vi.advanceTimersByTimeAsync(200);
      timeline.hold();
      await vi.advanceTimersByTimeAsync(2000);
      expect(completed).toBe(false);
      timeline.release();
      await vi.advanceTimersByTimeAsync(799);
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(completed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ReleaseKeepsPause, EligibleRelease: does not release a separate playback pause when the hold ends', async () => {
    vi.useFakeTimers();
    try {
      const timeline = new Timeline(false);
      let completed = false;
      void timeline.sleep(100).then(() => {
        completed = true;
      });
      timeline.hold();
      timeline.pause();
      timeline.release();
      await vi.advanceTimersByTimeAsync(1000);
      expect(completed).toBe(false);
      timeline.resume();
      await vi.advanceTimersByTimeAsync(100);
      expect(completed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

it('keeps a reading hold through a playback pause and ignores finish until released', async () => {
  vi.useFakeTimers();
  try {
    const timeline = new Timeline(false);
    const sleep = timeline.sleep(100);
    let completed = false;
    void sleep.then(() => {
      completed = true;
    });
    timeline.hold();
    timeline.hold();
    timeline.pause();
    timeline.resume();
    timeline.finish();
    await vi.advanceTimersByTimeAsync(500);
    expect(completed).toBe(false);
    timeline.release();
    timeline.release();
    await vi.advanceTimersByTimeAsync(100);
    expect(await sleep).toBe(true);
    timeline.hold();
    timeline.release();
  } finally {
    vi.useRealTimers();
  }
});

it('drops a reading hold on interruption before a later sleep', async () => {
  vi.useFakeTimers();
  try {
    const timeline = new Timeline(false);
    const interrupted = timeline.sleep(100);
    timeline.hold();
    timeline.interrupt();
    expect(await interrupted).toBe(false);
    timeline.reset();
    const next = timeline.sleep(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await next).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
