import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createGpuProofRunner } from '../src/speech_gpu_proof_runner';

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await fs.rm(directory, { recursive: true, force: true });
  directory = undefined;
});

it('SettledReaped: aborts and reaps a real proof child before permitting a successor', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gpu-abort-integration-'));
  const marker = path.join(directory, 'started');
  await fs.writeFile(
    path.join(directory, 'gpu_proof_worker.mjs'),
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'started');\nsetInterval(() => {}, 1000);\n`,
  );
  const capability = {
    runtimeDirectory: directory,
    modelDirectory: directory,
    executablePath: process.execPath,
    loaderPath: '/loader',
    loaderSha256: 'a'.repeat(64),
    driverPath: '/driver',
    driverSha256: 'b'.repeat(64),
    driverDevice: '1',
    driverInode: '2',
    environment: { LANG: 'C' as const, VK_DRIVER_FILES: '/driver.json', VK_LOADER_LAYERS_DISABLE: '~all~' as const, LD_PRELOAD: '/loader' },
  };
  const controller = new AbortController();
  const pending = createGpuProofRunner(capability)('tiny', controller.signal);
  for (let attempt = 0; attempt < 200; attempt++) {
    if (
      await fs.access(marker).then(
        () => true,
        () => false,
      )
    ) {
      break;
    }
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve(undefined);
      }, 10);
    });
  }
  expect(await fs.readFile(marker, 'utf8')).toBe('started');
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  const next = new AbortController();
  next.abort();
  await expect(createGpuProofRunner(capability)('model', next.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
