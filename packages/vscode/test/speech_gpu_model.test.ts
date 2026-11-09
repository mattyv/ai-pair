import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { installedGpuModel, setupGpuModel } from '../src/speech_gpu_model';
import { GpuModelTimeoutError } from '../src/speech_gpu_model_error';

const fakes = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  close: vi.fn().mockResolvedValue(undefined),
  base: true,
  progress: [] as number[],
  notFile: false,
  extraRead: false,
  onCopy: undefined as (() => void) | undefined,
  onStat: undefined as ((file: string) => void) | undefined,
}));
vi.mock('../src/speech_model_manifest', () => ({
  MODEL_REVISION: 'revision',
  MODEL_URL: 'https://huggingface.co/fixed',
  MODEL_ASSETS: [
    { path: 'tokenizer.json', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
    { path: 'onnx/model_quantized.onnx', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
  ],
}));
vi.mock('../src/speech_gpu_model_error', () => ({ GpuModelTimeoutError: class extends Error {} }));
vi.mock('../src/speech_gpu_model_manifest', () => ({
  GPU_MODEL_ASSET: { path: 'onnx/model.onnx', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
}));
vi.mock('../src/speech_setup', () => ({
  installedSpeechModel: vi.fn(() => Promise.resolve(fakes.base ? '/store/speech/revision' : undefined)),
}));
vi.mock('node:fs', async () => {
  const { Readable } = await import('node:stream');
  return {
    createReadStream: (file: string) =>
      Readable.from([fakes.extraRead ? new TextEncoder().encode('abcd') : (fakes.files.get(file) ?? new Uint8Array())]),
  };
});
vi.mock('node:fs/promises', () => ({
  stat: vi.fn((file: string) => {
    fakes.onStat?.(file);
    const data = fakes.files.get(file);
    if (data === undefined) return Promise.reject(new Error('missing'));
    return Promise.resolve({ size: data.length, isFile: () => !fakes.notFile });
  }),
  mkdir: vi.fn(() => Promise.resolve()),
  copyFile: vi.fn((from: string, to: string) => {
    const data = fakes.files.get(from);
    if (data === undefined) return Promise.reject(new Error('missing'));
    fakes.files.set(to, data);
    fakes.onCopy?.();
    return Promise.resolve();
  }),
  mkdtemp: vi.fn(() => Promise.resolve('/store/speech-gpu/.gpu-temp')),
  open: vi.fn((file: string) =>
    Promise.resolve({
      writeFile: (bytes: Uint8Array) => {
        fakes.files.set(file, bytes);
        return Promise.resolve();
      },
      close: fakes.close,
    }),
  ),
  rename: vi.fn((from: string, to: string) => {
    const entries = [...fakes.files.entries()].filter(([file]) => file.startsWith(`${from}/`));
    if (entries.length === 0) return Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    for (const [file, data] of entries) {
      fakes.files.set(`${to}${file.slice(from.length)}`, data);
      fakes.files.delete(file);
    }
    return Promise.resolve();
  }),
  rm: vi.fn(() => Promise.resolve()),
}));
beforeEach(() => {
  fakes.files.set('/store/speech/revision/tokenizer.json', new TextEncoder().encode('abc'));
  fakes.files.set('/store/speech/revision/onnx/model_quantized.onnx', new TextEncoder().encode('abc'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  fakes.files.clear();
  fakes.base = true;
  fakes.notFile = false;
  fakes.extraRead = false;
  fakes.onCopy = undefined;
  fakes.onStat = undefined;
  fakes.progress.length = 0;
});

it('InstalledOnlyIfVerified: installs the separate verified GPU model only after explicit setup', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('abc')));
  expect(await installedGpuModel('/store')).toBeUndefined();
  expect(
    await setupGpuModel('/store', {
      signal: new AbortController().signal,
      progress: (bytes) => {
        fakes.progress.push(bytes);
      },
    }),
  ).toBe('/store/speech-gpu/revision');
  expect(fakes.progress).toEqual([3]);
  expect(await installedGpuModel('/store')).toBe('/store/speech-gpu/revision');
  expect(fakes.files.has('/store/speech/revision/onnx/model.onnx')).toBe(false);
  expect(fakes.files.has('/store/speech-gpu/revision/tokenizer.json')).toBe(true);
  expect(fakes.files.has('/store/speech-gpu/revision/onnx/model_quantized.onnx')).toBe(false);
});
it('rejects a corrupt download and preserves the CPU model', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad')));
  await expect(setupGpuModel('/store', { signal: new AbortController().signal, progress: () => {} })).rejects.toThrow();
  expect(fakes.files.has('/store/speech/revision/onnx/model.onnx')).toBe(false);
});
it('requires the existing verified CPU assets and honors cancellation', async () => {
  fakes.base = false;
  expect(await installedGpuModel('/store')).toBeUndefined();
  await expect(setupGpuModel('/store', { signal: new AbortController().signal, progress: () => {} })).rejects.toThrow();
  fakes.base = true;
  const abort = new AbortController();
  abort.abort();
  await expect(setupGpuModel('/store', { signal: abort.signal, progress: () => {} })).rejects.toThrow();
});

it('follows only allowed HTTPS redirects and returns an existing verified GPU cache', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(undefined, { status: 302, headers: { location: 'https://cdn.hf.co/model' } }))
    .mockResolvedValueOnce(new Response('abc'));
  vi.stubGlobal('fetch', fetcher);
  const options = { signal: new AbortController().signal, progress: () => {} };
  await setupGpuModel('/store', options);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await setupGpuModel('/store', options);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('rejects unsupported redirects, excessive redirects and bad responses without installation', async () => {
  const options = { signal: new AbortController().signal, progress: () => {} };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(undefined, { status: 302, headers: { location: 'http://example.test/model' } })),
  );
  await expect(setupGpuModel('/store', options)).rejects.toThrow('Unsupported');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(undefined, { status: 302 })));
  await expect(setupGpuModel('/store', options)).rejects.toThrow('redirect');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(undefined, { status: 302, headers: { location: '/again' } })));
  await expect(setupGpuModel('/store', options)).rejects.toThrow('Too many');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(undefined, { status: 404 })));
  await expect(setupGpuModel('/store', options)).rejects.toThrow('download failed');
  expect(fakes.files.has('/store/speech-gpu/revision/onnx/model.onnx')).toBe(false);
});

it('NoBadInstall: rejects oversize, truncated, or corrupted bytes and a changed shared asset', async () => {
  const options = { signal: new AbortController().signal, progress: () => {} };
  for (const body of ['abcd', 'ab', 'bad']) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    await expect(setupGpuModel('/store', options)).rejects.toThrow('verification failed');
  }
  fakes.files.set('/store/speech/revision/tokenizer.json', new TextEncoder().encode('bad'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('abc')));
  await expect(setupGpuModel('/store', options)).rejects.toThrow('verification failed');
  expect(fakes.files.has('/store/speech-gpu/revision/onnx/model.onnx')).toBe(false);
});

it('cancels after progress and cleans the staging directory', async () => {
  const abort = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('a'));
      controller.enqueue(new TextEncoder().encode('bc'));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
  await expect(
    setupGpuModel('/store', {
      signal: abort.signal,
      progress: () => {
        abort.abort();
      },
    }),
  ).rejects.toThrow('cancel');
  expect(fs.rm).toHaveBeenCalledWith('/store/speech-gpu/.gpu-temp', { recursive: true, force: true });
  expect(fakes.files.has('/store/speech-gpu/revision/onnx/model.onnx')).toBe(false);
});

it('NoLostPrevious: restores an older GPU cache if the atomic replacement fails', async () => {
  fakes.files.set('/store/speech-gpu/revision/tokenizer.json', new TextEncoder().encode('old'));
  fakes.files.set('/store/speech-gpu/revision/onnx/model.onnx', new TextEncoder().encode('old'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('abc')));
  const rename = vi.mocked(fs.rename);
  const original = rename.getMockImplementation();
  if (original === undefined) throw new Error('missing fake');
  rename.mockImplementationOnce(original).mockRejectedValueOnce(new Error('commit failed'));
  await expect(setupGpuModel('/store', { signal: new AbortController().signal, progress: () => {} })).rejects.toThrow('commit failed');
  expect(new TextDecoder().decode(fakes.files.get('/store/speech-gpu/revision/onnx/model.onnx'))).toBe('old');
  expect(rename).toHaveBeenCalledTimes(3);
});

it('replaces an invalid GPU cache after verification and removes its backup', async () => {
  fakes.files.set('/store/speech-gpu/revision/tokenizer.json', new TextEncoder().encode('old'));
  fakes.files.set('/store/speech-gpu/revision/onnx/model.onnx', new TextEncoder().encode('old'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('abc')));
  await setupGpuModel('/store', { signal: new AbortController().signal, progress: () => {} });
  expect(await installedGpuModel('/store')).toBe('/store/speech-gpu/revision');
  expect(fs.rm).toHaveBeenCalledWith('/store/speech-gpu/.gpu-temp.old', { recursive: true, force: true });
});

it('rejects filesystem errors before commit and does not hide them as a missing cache', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('abc')));
  vi.mocked(fs.rename).mockRejectedValueOnce(new Error('permission denied'));
  await expect(setupGpuModel('/store', { signal: new AbortController().signal, progress: () => {} })).rejects.toThrow('permission denied');
  expect(fakes.files.has('/store/speech-gpu/revision/onnx/model.onnx')).toBe(false);
});

it('rejects non-files and unexpected growth while verifying a cache', async () => {
  fakes.files.set('/store/speech-gpu/revision/tokenizer.json', new TextEncoder().encode('abc'));
  fakes.notFile = true;
  expect(await installedGpuModel('/store')).toBeUndefined();
  fakes.notFile = false;
  fakes.extraRead = true;
  expect(await installedGpuModel('/store')).toBeUndefined();
});

it('CancelledDoesNotInstall: honors cancellation while copying shared assets and before dispatching replacement', async () => {
  const copying = new AbortController();
  fakes.onCopy = () => {
    copying.abort();
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('abc'))),
  );
  await expect(setupGpuModel('/store', { signal: copying.signal, progress: () => {} })).rejects.toThrow();
  fakes.onCopy = undefined;
  const committing = new AbortController();
  const rename = vi.mocked(fs.rename);
  const original = rename.getMockImplementation();
  if (original === undefined) throw new Error('missing fake');
  fakes.files.set('/store/speech-gpu/revision/tokenizer.json', new TextEncoder().encode('old'));
  rename.mockImplementationOnce(async (...args) => {
    await original(...args);
    committing.abort();
  });
  await expect(setupGpuModel('/store', { signal: committing.signal, progress: () => {} })).rejects.toThrow('cancel');
  expect(new TextDecoder().decode(fakes.files.get('/store/speech-gpu/revision/tokenizer.json'))).toBe('old');
});

it('uses a concurrently installed verified cache and aborts before commit when requested', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('abc'))),
  );
  function putValid(): void {
    fakes.files.set('/store/speech-gpu/revision/tokenizer.json', new TextEncoder().encode('abc'));
    fakes.files.set('/store/speech-gpu/revision/onnx/model.onnx', new TextEncoder().encode('abc'));
  }
  await setupGpuModel('/store', { signal: new AbortController().signal, progress: putValid });
  expect(fs.rename).not.toHaveBeenCalled();
  fakes.files.delete('/store/speech-gpu/revision/tokenizer.json');
  fakes.files.delete('/store/speech-gpu/revision/onnx/model.onnx');
  const abort = new AbortController();
  let targetChecks = 0;
  fakes.onStat = (file) => {
    if (file === '/store/speech-gpu/revision/tokenizer.json' && ++targetChecks === 2) abort.abort();
  };
  await expect(setupGpuModel('/store', { signal: abort.signal, progress: () => {} })).rejects.toThrow('cancel');
});

it('propagates a failed commit without a prior target', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('abc'))),
  );
  const rename = vi.mocked(fs.rename);
  const original = rename.getMockImplementation();
  if (original === undefined) throw new Error('missing fake');
  rename.mockImplementationOnce(original).mockRejectedValueOnce(new Error('commit failed'));
  await expect(setupGpuModel('/store', { signal: new AbortController().signal, progress: () => {} })).rejects.toThrow('commit failed');
});

it('honors cancellation before copying and tolerates reader cancellation failure', async () => {
  const early = new AbortController();
  const mkdtemp = vi.mocked(fs.mkdtemp);
  const original = mkdtemp.getMockImplementation();
  if (original === undefined) throw new Error('missing fake');
  mkdtemp.mockImplementationOnce(async (...args) => {
    const result = await original(...args);
    early.abort();
    return result;
  });
  await expect(setupGpuModel('/store', { signal: early.signal, progress: () => {} })).rejects.toThrow('cancel');
  const late = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('a'));
    },
    cancel() {
      return Promise.reject(new Error('private'));
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
  await expect(
    setupGpuModel('/store', {
      signal: late.signal,
      progress: () => {
        late.abort();
      },
    }),
  ).rejects.toThrow('cancel');
});

it('closes the staged file if the response reader cannot be acquired', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => {
          throw new Error('reader failed');
        },
      },
    }),
  );
  await expect(setupGpuModel('/store', { signal: new AbortController().signal, progress: () => {} })).rejects.toThrow('reader failed');
  expect(fakes.close).toHaveBeenCalledOnce();
});

it('SetupProgress: bounds a stalled model request and cleans staging after timeout', async () => {
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: URL, options: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          void url;
          void resolve;
          options.signal.addEventListener(
            'abort',
            () => {
              reject(new Error('timeout'));
            },
            { once: true },
          );
        }),
    ),
  );
  const setup = setupGpuModel('/store', { signal: new AbortController().signal, progress: () => {} });
  await vi.waitFor(() => {
    expect(fetch).toHaveBeenCalledOnce();
  });
  timeout.abort();
  await expect(setup).rejects.toBeInstanceOf(GpuModelTimeoutError);
  expect(fs.rm).toHaveBeenCalledWith('/store/speech-gpu/.gpu-temp', { recursive: true, force: true });
});

it('NoLostPrevious: preserves the backup if both commit and rollback fail', async () => {
  fakes.files.set('/store/speech-gpu/revision/tokenizer.json', new TextEncoder().encode('old'));
  fakes.files.set('/store/speech-gpu/revision/onnx/model.onnx', new TextEncoder().encode('old'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('abc')));
  const rename = vi.mocked(fs.rename);
  const original = rename.getMockImplementation();
  if (original === undefined) throw new Error('missing fake');
  rename
    .mockImplementationOnce(original)
    .mockRejectedValueOnce(new Error('commit failed'))
    .mockRejectedValueOnce(new Error('rollback failed'));
  await expect(setupGpuModel('/store', { signal: new AbortController().signal, progress: () => {} })).rejects.toThrow('rollback failed');
  expect(new TextDecoder().decode(fakes.files.get('/store/speech-gpu/.gpu-temp.old/onnx/model.onnx'))).toBe('old');
  expect(fs.rm).not.toHaveBeenCalledWith('/store/speech-gpu/.gpu-temp.old', expect.anything());
});
