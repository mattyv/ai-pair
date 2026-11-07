import * as path from 'node:path';
import * as esbuild from 'esbuild';
import { stageSpeechRuntime } from '../../vscode/scripts/speech_runtime.mts';

/** Inputs for staging the companion's offline speech runtime. */
export interface CompanionSpeechStageOptions {
  platform: string;
  arch: string;
  source: string;
  destination: string;
}

/** Stages the shared runtime and bundles its worker from the audio-ui package directory. */
export async function stageCompanionSpeech(options: CompanionSpeechStageOptions): Promise<void> {
  stageSpeechRuntime(options);
  const common: esbuild.BuildOptions = {
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'warning',
  };
  if (options.platform === 'linux' && options.arch === 'x64') {
    await esbuild.build({
      ...common,
      entryPoints: ['../vscode/src/speech_phonemizer_bridge.ts'],
      outfile: path.join(options.destination, 'node_modules/phonemizer/index.mjs'),
    });
  }
  await esbuild.build({
    ...common,
    entryPoints: ['../vscode/src/speech_worker.ts'],
    external: ['kokoro-js', '@huggingface/transformers', 'phonemizer'],
    outfile: path.join(options.destination, 'worker.mjs'),
  });
}
