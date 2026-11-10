import { AUDIO_DIAGNOSTICS_SCHEMA, gpuDiagnostics, localSpeechReport, type DiagnosticSnapshot } from '@ai-pair/protocol';
import type { DiagnosticSnapshot as WorkspaceSnapshot } from './diagnostics';

/** Dependencies for the bounded, read-only diagnostics collector. */
export interface DiagnosticCollectorOptions {
  snapshot: () => WorkspaceSnapshot;
  companion: boolean;
  command: (name: string) => PromiseLike<unknown>;
  timeoutMs: number;
  audio?: () => PromiseLike<DiagnosticSnapshot['audio']>;
}

/** Returns a fallback when a read throws or exceeds its deadline. */
async function bounded<T>(operation: () => PromiseLike<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(operation)
        .catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          resolve(undefined);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Collects sanitized workspace and companion facts without initiating playback. */
export async function collectDiagnostics(options: DiagnosticCollectorOptions): Promise<DiagnosticSnapshot> {
  // specs/DiagnosticsRequest.tla, Complete: each companion read is bounded and independently validated.
  const snapshot = options.snapshot();
  const [speechRaw, gpuRaw, audioRaw] = await Promise.all([
    options.companion ? bounded(() => options.command('speech'), options.timeoutMs) : undefined,
    options.companion ? bounded(() => options.command('gpu'), options.timeoutMs) : undefined,
    options.companion
      ? bounded(() => options.command('audio'), options.timeoutMs)
      : options.audio === undefined
        ? undefined
        : bounded(options.audio, options.timeoutMs),
  ]);
  const speech = localSpeechReport.safeParse(speechRaw);
  const gpu = gpuDiagnostics.safeParse(gpuRaw);
  const audio = AUDIO_DIAGNOSTICS_SCHEMA.safeParse(audioRaw);
  return {
    ...snapshot,
    ...(options.companion ? { localSpeech: speech.success ? speech.data : ('unavailable' as const) } : {}),
    ...(gpu.success ? { gpu: gpu.data } : {}),
    ...(audio.success ? { audio: audio.data } : {}),
  };
}
