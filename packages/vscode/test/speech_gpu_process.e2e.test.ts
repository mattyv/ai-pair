import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createGpuSynthesisClient } from '../src/speech_gpu_client';
import { LOCAL_CAPABILITIES } from '../src/speech_local_protocol';
import { tryAcquireGpuProcessSlot } from '../src/speech_gpu_slot';

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await fs.rm(directory, { recursive: true, force: true });
  directory = undefined;
});

it('keeps a separate warm process and reaps it before reuse after cancellation', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-pair-gpu-process-'));
  const modelDirectory = path.join(directory, 'model');
  await fs.mkdir(modelDirectory);
  const script = `
    let epoch;
    process.on('message', (message) => {
      if (message.type === 'init') {
        epoch = message.epoch;
        process.send({ type: 'ready', version: 1, epoch, capabilities: ${JSON.stringify(LOCAL_CAPABILITIES)} });
      } else if (message.type === 'synthesize' && message.id === 1) {
        process.send({ type: 'result', version: 1, epoch, id: message.id, part: message.part, wav: Buffer.from(Array.from({ length: 44 }, (_, index) => index)).toString('base64'), durationMs: 1 });
      }
      // A hung child deliberately ignores shutdown so the parent must kill it.
    });
  `;
  await fs.writeFile(path.join(directory, 'gpu_worker.mjs'), script);
  const listener = { ready: vi.fn(), retired: vi.fn() };
  const client = createGpuSynthesisClient({
    listener,
    capability: {
      runtimeDirectory: directory,
      modelDirectory,
      executablePath: process.execPath,
      loaderPath: path.join(directory, 'loader'),
      loaderSha256: 'a'.repeat(64),
      driverPath: path.join(directory, 'driver'),
      driverSha256: 'b'.repeat(64),
      driverDevice: '42',
      driverInode: '99',
      environment: {
        LANG: 'C',
        VK_DRIVER_FILES: path.join(directory, 'icd'),
        VK_LOADER_LAYERS_DISABLE: '~all~',
        LD_PRELOAD: path.join(directory, 'loader'),
      },
    },
  });
  try {
    client.load(modelDirectory);
    await vi.waitFor(() => {
      expect(client.state()).toBe('ready');
    });
    const first = await client.synthesize({ id: 1, part: 0, text: 'Synthetic.', voice: 'af_heart', speed: 1, final: true });
    expect(first.status).toBe('audio');
    if (first.status === 'audio') expect(first.wav).toEqual(Uint8Array.from({ length: 44 }, (_, index) => index));
    const second = client.synthesize({ id: 2, part: 0, text: 'Synthetic.', voice: 'af_heart', speed: 1, final: true });
    client.cancel();
    expect((await second).status).toBe('failed');
    expect(client.state()).toBe('retiring');
    expect(tryAcquireGpuProcessSlot()).toBeUndefined();
    expect(() => {
      client.load(modelDirectory);
    }).toThrow();
    await vi.waitFor(
      () => {
        expect(client.state()).toBe('cold');
      },
      { timeout: 5000 },
    );
    expect(listener.retired).toHaveBeenCalledOnce();
    const release = tryAcquireGpuProcessSlot();
    expect(release).toBeDefined();
    release?.();
  } finally {
    client.retire('worker_exit');
    await vi.waitFor(
      () => {
        expect(client.state()).toBe('cold');
      },
      { timeout: 5000 },
    );
  }
});
