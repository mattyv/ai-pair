// Exercises interrupted speech gates through the loaded controller and player.
import * as assert from 'node:assert/strict';
import { z } from 'zod';
import type { Controller, PanelEvent } from '@ai-pair/core';
import type { Api } from '../src/extension';

/** Waits for an observable gate without leaving a test pending indefinitely. */
async function until(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}

/** Bounds a controller operation. */
async function within<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, 12_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Interrupts narration at the admission, prior-speech, and paused playback gates. */
export async function speechCoveragePaths(api: Api): Promise<void> {
  const LoadedController = z.custom<typeof Controller>((value) => typeof value === 'function').parse(api.controller.constructor);
  const events: PanelEvent[] = [];
  let retirement: Promise<boolean> = Promise.resolve(true);
  let entered = 0;
  let spoke = 0;
  let finish: (() => void) | undefined;
  const controller = new LoadedController(
    api.editor,
    {
      post: (event) => {
        events.push(event);
      },
    },
    undefined,
    {
      waitForRetirement: () => {
        entered++;
        return retirement;
      },
      speak: () => {
        spoke++;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      attentionCue: () => Promise.resolve(),
      pause: () => {},
      resume: () => {},
      cancel: () => {
        finish?.();
      },
    },
  );
  function readingFinished(): boolean {
    const reading = events.findIndex((event) => event.type === 'reading');
    return reading >= 0 && events.slice(reading + 1).some((event) => event.type === 'state' && event.state === 'typing');
  }
  controller.setSpeed(20);
  controller.setReadingSpeed(20);
  const admission = Promise.withResolvers<boolean>();
  try {
    retirement = admission.promise;
    await within(controller.start('interrupt speech admission'), 'admission session did not start');
    await within(controller.step([{ say: 'Waiting for admission.', speak: true }]), 'admission batch was not accepted');
    await until(() => entered === 1, 'speech admission did not start');
    controller.userInterrupt();
    admission.resolve(true);
    const admissionReport = await within(controller.step([]), 'admission interruption did not settle');
    assert.ok(admissionReport.batches.some((batch) => batch.status === 'interrupted'));
    assert.equal(spoke, 0, 'interrupted admission started speech');
    await within(controller.end(), 'admission session did not end');

    retirement = Promise.resolve(true);
    events.length = 0;
    await within(controller.start('interrupt previous speech'), 'speech session did not start');
    await within(
      controller.step([
        { say: 'First pending speech.', speak: true, speech_mode: 'continue' },
        { say: 'Do not display this.', speak: true },
      ]),
      'speech batch was not accepted',
    );
    await until(() => spoke === 1 && readingFinished(), 'the first reading did not finish');
    controller.userInterrupt();
    const priorReport = await within(controller.step([]), 'previous speech interruption did not settle');
    assert.ok(priorReport.batches.some((batch) => batch.status === 'interrupted'));
    assert.ok(!events.some((event) => event.type === 'say' && event.text === 'Do not display this.'));
    await within(controller.end(), 'speech session did not end');

    events.length = 0;
    await within(controller.start('interrupt paused speech'), 'paused session did not start');
    await within(controller.step([{ say: 'Pause before completion.', speak: true }]), 'paused batch was not accepted');
    await until(() => spoke === 2 && readingFinished(), 'the paused reading did not finish');
    controller.pause();
    finish?.();
    // Let the resolved speech promise reach the paused timeline before interrupting.
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    controller.userInterrupt();
    const pausedReport = await within(controller.step([]), 'paused speech interruption did not settle');
    assert.ok(pausedReport.batches.some((batch) => batch.status === 'interrupted'));
    console.log('Speech gates: interrupted admission, previous speech, and paused completion');
  } finally {
    admission.resolve(false);
    finish?.();
    controller.endSession();
    controller.disconnect();
  }
}
