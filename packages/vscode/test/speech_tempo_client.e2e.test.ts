import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import { afterEach, expect, it } from 'vitest';
import { SpeechTempoClient } from '../src/speech_tempo_client';

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await fs.rm(directory, { recursive: true, force: true });
  directory = undefined;
});

it('runs the packaged worker in a real process and returns owned synthetic PCM', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-pair-tempo-test-'));
  const workerPath = path.join(directory, 'tempo_worker.mjs');
  await esbuild.build({
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
    entryPoints: [path.join(import.meta.dirname, '../src/speech_tempo_worker.ts')],
    outfile: workerPath,
  });
  const client = new SpeechTempoClient(workerPath);
  const input = Int16Array.from({ length: 4800 }, (_, index) => Math.round(8000 * Math.sin(index / 20)));
  const original = input.slice();
  try {
    const output = await client.transform({ unitId: 1, part: 0, rate: 0.75, pcm: input }, new AbortController().signal);
    expect(output.length).toBe(6400);
    expect(input).toEqual(original);
    expect(output.some((sample) => sample !== 0)).toBe(true);
  } finally {
    await client.dispose();
  }
});

it('returns an owned unchanged copy for input shorter than the transform window', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-pair-tempo-test-'));
  const workerPath = path.join(directory, 'tempo_worker.mjs');
  await esbuild.build({
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
    entryPoints: [path.join(import.meta.dirname, '../src/speech_tempo_worker.ts')],
    outfile: workerPath,
  });
  const client = new SpeechTempoClient(workerPath);
  const input = Int16Array.from({ length: 2400 }, (_, index) => Math.round(8000 * Math.sin(index / 20)));
  const original = input.slice();
  try {
    const output = await client.transform({ unitId: 1, part: 0, rate: 0.75, pcm: input }, new AbortController().signal);
    expect(output).toEqual(original);
    expect(output.buffer).not.toBe(input.buffer);
  } finally {
    await client.dispose();
  }
});
