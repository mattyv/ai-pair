// Exercises the real service in Electron with synthetic cloud and output ports.
import * as assert from 'node:assert/strict';
import { SpeechService, type CloudSpeechFailureReason, type SpeechOutput, type SpeechServiceOptions } from '../src/speech_service';
import type { ElevenLabsSpeechPort, SpeechAudioResult } from '../src/speech_types';

/** Supplies a valid synthetic cloud selection. */
function settings() {
  return { enabled: true, provider: 'elevenlabs' as const, voice: 'af_heart', speed: 1, elevenLabsVoice: 'voice', elevenLabsSpeed: 1 };
}

/** Checks every bounded cloud error and the current-unit cancellation races. */
export async function cloudServicePaths(): Promise<void> {
  let failure: unknown;
  let synchronous = false;
  let cancelSynchronously = false;
  let cancel: (() => void) | undefined;
  let pending: PromiseWithResolvers<SpeechAudioResult> | undefined;
  const cloud: ElevenLabsSpeechPort = {
    synthesize: () => {
      if (cancelSynchronously) cancel?.();
      if (synchronous) throw failure;
      return pending?.promise ?? Promise.reject(failure);
    },
    voices: () => Promise.resolve({ voices: [] }),
  };
  const statuses: Array<{ state: string; message?: string }> = [];
  const diagnostics: CloudSpeechFailureReason[] = [];
  let throwDiagnostic = false;
  let playedId: number | undefined;
  const output: SpeechOutput = {
    play: (id) => {
      playedId = id;
      return 1;
    },
    control: () => {},
    status: (id, state, message) => {
      void id;
      statuses.push({ state, message });
    },
  };
  const service = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    cloud,
    output,
    settings,
    cloudDiagnostic: (reason) => {
      if (throwDiagnostic) throw new Error('private observer error');
      diagnostics.push(reason);
    },
  });
  cancel = () => {
    service.cancel();
  };
  try {
    const cases: Array<[unknown, CloudSpeechFailureReason, string | undefined]> = [
      [{ kind: 'key' }, 'no_key', 'API key'],
      [{ kind: 'auth' }, 'auth', 'authorize'],
      [{ kind: 'rate' }, 'rate', 'rate limit'],
      [{ kind: 'network' }, 'network', 'service returned an error'],
      [{ kind: 'timeout' }, 'timeout', 'timed out'],
      [{ kind: 'invalid' }, 'invalid', 'invalid response'],
      [{ kind: 'canceled' }, 'canceled', undefined],
      [new Error('private exception'), 'unknown', 'unavailable'],
    ];
    for (const [error, reason, message] of cases) {
      failure = error;
      statuses.length = 0;
      await service.speak('Private text.');
      assert.equal(diagnostics.at(-1), reason);
      if (message === undefined) assert.ok(!statuses.some((status) => status.state === 'unavailable'));
      else assert.ok(statuses.some((status) => status.state === 'unavailable' && status.message?.includes(message) === true));
    }
    synchronous = true;
    failure = { kind: 'rate' };
    await service.speak('Synchronous failure.');
    assert.equal(diagnostics.at(-1), 'rate');
    const beforeSynchronousCancel = diagnostics.length;
    cancelSynchronously = true;
    await service.speak('Synchronous cancellation.');
    assert.equal(diagnostics.length, beforeSynchronousCancel);
    cancelSynchronously = false;
    synchronous = false;
    throwDiagnostic = true;
    failure = { kind: 'network' };
    statuses.length = 0;
    await service.speak('Observer failure.');
    assert.ok(statuses.some((status) => status.state === 'unavailable' && status.message?.includes('service returned an error') === true));
    throwDiagnostic = false;
    const before = diagnostics.length;
    pending = Promise.withResolvers<SpeechAudioResult>();
    const canceled = service.speak('Canceled request.');
    service.cancel();
    await canceled;
    pending.reject(new Error('private late failure'));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(diagnostics.length, before);
    pending = Promise.withResolvers<SpeechAudioResult>();
    const canceledSuccess = service.speak('Canceled late success.');
    service.cancel();
    await canceledSuccess;
    pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(playedId, undefined);
    assert.equal(diagnostics.length, before);
    pending = Promise.withResolvers<SpeechAudioResult>();
    const timed = service.speak('Timed request.');
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        timed,
        new Promise<never>((_, reject) => {
          watchdog = setTimeout(() => {
            reject(new Error('Speech watchdog did not settle'));
          }, 25_000);
        }),
      ]);
    } finally {
      if (watchdog !== undefined) clearTimeout(watchdog);
    }
    assert.equal(diagnostics.at(-1), 'timeout');
    const afterTimeout = diagnostics.length;
    pending.reject(new Error('private late timeout'));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(diagnostics.length, afterTimeout);
    pending = Promise.withResolvers<SpeechAudioResult>();
    const success = service.speak('Recovery.');
    pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    assert.notEqual(playedId, undefined);
    if (playedId === undefined) throw new Error('No playback');
    assert.equal(service.audioEvent({ id: playedId, pageId: 1, event: 'ended' }), 'ended');
    await success;
    pending = undefined;
    const withoutObserver = new SpeechService({ runtimeDirectory: '', storageDirectory: '', localDesktop: true, cloud, output, settings });
    try {
      failure = { kind: 'auth' };
      await withoutObserver.speak('No observer.');
    } finally {
      withoutObserver.dispose();
    }
    let missingReason: CloudSpeechFailureReason | undefined;
    const missingOptions: SpeechServiceOptions = {
      runtimeDirectory: '',
      storageDirectory: '',
      localDesktop: true,
      cloud,
      settings,
      output: {
        ...output,
        status: (id, state) => {
          void id;
          if (state === 'preparing') missingOptions.cloud = undefined;
        },
      },
      cloudDiagnostic: (reason) => {
        missingReason = reason;
      },
    };
    const missing = new SpeechService(missingOptions);
    try {
      await missing.speak('Provider removed.');
      assert.equal(missingReason, 'unknown');
    } finally {
      missing.dispose();
    }
    assert.doesNotMatch(JSON.stringify({ diagnostics, statuses }), /private/i);
  } finally {
    service.dispose();
  }
}
