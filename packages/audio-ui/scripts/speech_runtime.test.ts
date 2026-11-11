import { expect, it, vi } from 'vitest';
import { stageCompanionSpeech } from './speech_runtime.mts';

const mocks = vi.hoisted(() => ({ stage: vi.fn(), build: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../vscode/scripts/speech_runtime.mts', () => ({ stageSpeechRuntime: mocks.stage }));
vi.mock('esbuild', () => ({ build: mocks.build }));

it('stages the shared offline runtime and worker for the companion', async () => {
  mocks.stage.mockReturnValueOnce(true);
  await stageCompanionSpeech({ platform: 'linux', arch: 'x64', source: '/modules', destination: '/out' });
  expect(mocks.stage).toHaveBeenCalledWith({ platform: 'linux', arch: 'x64', source: '/modules', destination: '/out' });
  expect(mocks.build).toHaveBeenCalledWith(
    expect.objectContaining({ entryPoints: ['../vscode/src/speech_worker.ts'], outfile: '/out/worker.mjs' }),
  );
  expect(mocks.build).toHaveBeenCalledWith(
    expect.objectContaining({ entryPoints: ['../vscode/src/speech_tempo_worker.ts'], outfile: '/out/tempo_worker.mjs' }),
  );
  expect(mocks.build).toHaveBeenCalledWith(
    expect.objectContaining({
      entryPoints: ['../vscode/src/speech_phonemizer_bridge.ts'],
      outfile: '/out/node_modules/phonemizer/index.mjs',
    }),
  );
});

it('stages both workers on unsupported platforms', async () => {
  mocks.build.mockClear();
  mocks.stage.mockReturnValueOnce(false);
  await stageCompanionSpeech({ platform: 'win32', arch: 'x64', source: '/modules', destination: '/out' });
  expect(mocks.build).toHaveBeenCalledTimes(2);
  expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({ entryPoints: ['../vscode/src/speech_worker.ts'] }));
});
