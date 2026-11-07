import { expect, it, vi } from 'vitest';
import { NativeAdapter } from '../../audio-native/src/native_adapter';
import { Diagnostics } from '../../vscode/src/diagnostics';
import { SpeechService } from '../../vscode/src/speech_service';
import { CompanionOutput } from '../src/companion_output';

vi.mock('node:worker_threads', () => ({
  // This fake reproduces a constructor-time module-loading failure.
  // oxlint-disable-next-line typescript/no-extraneous-class
  Worker: class {
    constructor() {
      throw Object.assign(new Error('private worker path'), { code: 'MODULE_NOT_FOUND' });
    }
  },
}));
vi.mock('../../vscode/src/speech_setup', () => ({ installedSpeechModel: () => Promise.resolve('/private/model') }));
vi.mock('../../vscode/src/speech_runtime_status', () => ({ speechRuntimeAvailable: () => Promise.resolve(true) }));

it('records a sanitized worker-module failure through the real companion output', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const arch = Object.getOwnPropertyDescriptor(process, 'arch');
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  try {
    const diagnostics = new Diagnostics({ version: 'test', build: 'build' });
    const adapter = new NativeAdapter({
      list: () => Promise.resolve([{ id: 'device', label: 'Private device' }]),
      start: () => {
        throw new Error('should not play');
      },
    });
    let speech: SpeechService;
    const output = new CompanionOutput({
      adapter,
      connectionEpoch: 'epoch',
      page: () => 1,
      choice: () => ({ kind: 'device', id: 'device' }),
      ready: () => true,
      event: (event) => {
        speech.audioEvent(event);
      },
      status: () => {},
      localDiagnostic: (phase, reason) => {
        diagnostics.record({ kind: 'speech', event: 'runtime', provider: 'kokoro', phase, ...(reason === undefined ? {} : { reason }) });
      },
    });
    speech = new SpeechService({
      runtimeDirectory: '/private/runtime',
      storageDirectory: '/private/storage',
      localDesktop: true,
      kokoroSupported: true,
      settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
      output,
    });
    await speech.speak('Synthetic narration.');
    const report = diagnostics.snapshot();
    expect(report.events).toContainEqual(
      expect.objectContaining({ kind: 'speech', event: 'runtime', phase: 'failed', reason: 'worker_module' }),
    );
    expect(JSON.stringify(report)).not.toContain('private');
    speech.dispose();
    output.dispose();
  } finally {
    if (platform !== undefined) Object.defineProperty(process, 'platform', platform);
    if (arch !== undefined) Object.defineProperty(process, 'arch', arch);
  }
});
