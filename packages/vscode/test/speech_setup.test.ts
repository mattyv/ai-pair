/* eslint-disable @typescript-eslint/require-await, unicorn/no-null -- Async and Response mocks match the real APIs. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installedSpeechModel, setupSpeech, speechModelStatus } from '../src/speech_setup';

const fakes = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  cancelled: false,
  progress: [] as number[],
  counter: 0,
  failRename: false,
  failBackup: false,
  overrideRead: undefined as Uint8Array | undefined,
  invalidFile: false,
  readHook: undefined as ((file: string) => void) | undefined,
  statHook: undefined as ((file: string) => void) | undefined,
  statFailure: undefined as Error | undefined,
  progressHook: undefined as (() => void) | undefined,
  cancel: undefined as (() => void) | undefined,
}));

vi.mock('../src/speech_model_manifest', () => ({
  MODEL_REVISION: 'revision',
  MODEL_ASSETS: [
    { path: 'config.json', size: 6, sha256: 'b79606fb3afea5bd1609ed40b622142f1c98125abcfe89a76a661b0e8e343910' },
    { path: 'onnx/model_quantized.onnx', size: 4, sha256: '87e93f89f2be0db364e8be052f79f389e6c2da239831922e24513288af522a43' },
  ],
  MODEL_URL: 'https://huggingface.co/fixed/revision',
}));
vi.mock('vscode', () => ({
  ProgressLocation: { Notification: 1 },
  window: {
    withProgress: async (options: unknown, run: (progress: unknown, token: unknown) => Promise<void>) => (
      void options,
      run(
        {
          report: ({ increment }: { increment: number }) => {
            fakes.progress.push(increment);
            fakes.progressHook?.();
          },
        },
        {
          isCancellationRequested: fakes.cancelled,
          onCancellationRequested: (cancel: () => void) => {
            fakes.cancel = cancel;
            if (fakes.cancelled) cancel();
            return { dispose: () => {} };
          },
        },
      )
    ),
  },
}));
vi.mock('node:fs', async () => {
  const { Readable } = await import('node:stream');
  return {
    createReadStream: (file: string) => {
      fakes.readHook?.(file);
      return Readable.from([fakes.overrideRead ?? fakes.files.get(file) ?? new Uint8Array()]);
    },
  };
});
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}${++fakes.counter}`),
  stat: vi.fn(async (file: string) => {
    fakes.statHook?.(file);
    if (fakes.statFailure !== undefined) throw fakes.statFailure;
    const data = fakes.files.get(file);
    if (data === undefined && [...fakes.files.keys()].some((entry) => entry.startsWith(`${file}/`))) return { size: 0, isFile: () => false };
    if (data === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return { size: data.length, isFile: () => !fakes.invalidFile };
  }),
  open: vi.fn(async (file: string) => ({
    writeFile: async (data: Uint8Array) => {
      const prior = fakes.files.get(file) ?? new Uint8Array();
      fakes.files.set(file, new Uint8Array([...prior, ...data]));
    },
    close: async () => {},
  })),
  rename: vi.fn(async (from: string, to: string) => {
    if (fakes.failBackup && !from.includes('.setup-')) throw new Error('backup failed');
    if (fakes.failRename && from.includes('.setup-') && !from.endsWith('.old')) throw new Error('rename failed');
    if (![...fakes.files.keys()].some((file) => file.startsWith(`${from}/`))) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    for (const [file, data] of Array.from(fakes.files)) {
      if (file.startsWith(`${from}/`)) {
        fakes.files.delete(file);
        fakes.files.set(`${to}${file.slice(from.length)}`, data);
      }
    }
  }),
  rm: vi.fn(async (dir: string) => {
    for (const file of fakes.files.keys()) if (file.startsWith(`${dir}/`)) fakes.files.delete(file);
  }),
}));

afterEach(() => {
  fakes.files.clear();
  fakes.cancelled = false;
  fakes.progress.length = 0;
  fakes.counter = 0;
  fakes.failRename = false;
  fakes.failBackup = false;
  fakes.overrideRead = undefined;
  fakes.invalidFile = false;
  fakes.readHook = undefined;
  fakes.statHook = undefined;
  fakes.statFailure = undefined;
  fakes.progressHook = undefined;
  fakes.cancel = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function download(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => new Response(url.pathname.endsWith('config.json') ? 'config' : 'onnx')),
  );
}

describe('speech setup', () => {
  it('reports the pinned source, local path and verification result', async () => {
    expect(await speechModelStatus('/storage')).toEqual({
      path: '/storage/speech/revision', source: 'https://huggingface.co/fixed/revision',
      revision: 'revision', verified: false, download: 'missing',
    });
    download();
    await setupSpeech('/storage');
    expect(await speechModelStatus('/storage')).toMatchObject({ verified: true, download: 'installed' });
    fakes.files.set('/storage/speech/revision/config.json', new TextEncoder().encode('broken'));
    expect(await speechModelStatus('/storage')).toMatchObject({ verified: false, download: 'installed' });
  });

  it('reports unknown download status when the model path cannot be inspected', async () => {
    fakes.statFailure = Object.assign(new Error('denied'), { code: 'EACCES' });
    expect(await speechModelStatus('/storage')).toMatchObject({ verified: false, download: 'unknown' });
  });

  it('downloads and verifies all fixed assets before exposing the model directory', async () => {
    download();
    expect(await installedSpeechModel('/storage')).toBeUndefined();
    await setupSpeech('/storage');
    expect(await installedSpeechModel('/storage')).toBe('/storage/speech/revision');
    expect(fakes.progress.reduce((sum, increment) => sum + increment, 0)).toBeCloseTo(100);
  });

  it('rejects a corrupt download and never exposes a partial model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('wrong')),
    );
    await expect(setupSpeech('/storage')).rejects.toThrow();
    expect(await installedSpeechModel('/storage')).toBeUndefined();
    expect([...fakes.files.keys()]).toEqual([]);
  });

  it('cancels setup without installing a model', async () => {
    download();
    fakes.cancelled = true;
    await expect(setupSpeech('/storage')).rejects.toThrow(/cancel/i);
    expect(await installedSpeechModel('/storage')).toBeUndefined();
  });
  it('reuses a verified installation without network access', async () => {
    download();
    await setupSpeech('/storage');
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    await setupSpeech('/storage');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('replaces a corrupt prior installation only after verification', async () => {
    fakes.files.set('/storage/speech/revision/config.json', new TextEncoder().encode('broken'));
    download();
    await setupSpeech('/storage');
    expect(await installedSpeechModel('/storage')).toBe('/storage/speech/revision');
  });

  it('restores a prior installation if the atomic install fails', async () => {
    const prior = new TextEncoder().encode('broken');
    fakes.files.set('/storage/speech/revision/config.json', prior);
    fakes.failRename = true;
    download();
    await expect(setupSpeech('/storage')).rejects.toThrow('rename failed');
    expect(fakes.files.get('/storage/speech/revision/config.json')).toEqual(prior);
  });

  it('rejects disallowed redirects before contacting the new host', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/model' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(setupSpeech('/storage')).rejects.toThrow(/unsupported host/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects missing redirect locations and unsuccessful responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302 })),
    );
    await expect(setupSpeech('/storage')).rejects.toThrow(/redirect is invalid/);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await expect(setupSpeech('/storage')).rejects.toThrow(/download failed/);
  });

  it('follows an allowed CDN redirect and rejects redirect loops', async () => {
    const fetchMock = vi.fn(async (url: URL) =>
      url.hostname === 'huggingface.co'
        ? new Response(null, { status: 302, headers: { location: `https://cdn.hf.co${url.pathname}` } })
        : new Response(url.pathname.endsWith('config.json') ? 'config' : 'onnx'),
    );
    vi.stubGlobal('fetch', fetchMock);
    await setupSpeech('/storage');
    expect(await installedSpeechModel('/storage')).toBe('/storage/speech/revision');
    fakes.files.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again' } })),
    );
    await expect(setupSpeech('/storage')).rejects.toThrow(/too many times/);
  });

  it('stops a cancelled download and removes staging', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fakes.cancel?.();
        return new Response('config');
      }),
    );
    await expect(setupSpeech('/storage')).rejects.toThrow(/cancel/i);
    expect([...fakes.files.keys()]).toEqual([]);
  });
  it('rejects invalid file types and changed content during verification', async () => {
    fakes.files.set('/storage/speech/revision/config.json', new TextEncoder().encode('config'));
    fakes.invalidFile = true;
    expect(await installedSpeechModel('/storage')).toBeUndefined();
    fakes.invalidFile = false;
    for (const content of ['changed', 'wrong!', 'x']) {
      fakes.overrideRead = new TextEncoder().encode(content);
      expect(await installedSpeechModel('/storage')).toBeUndefined();
    }
  });

  it('rejects oversized, truncated and empty downloads', async () => {
    for (const data of ['toolong', 'x', '']) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(data)),
      );
      await expect(setupSpeech('/storage')).rejects.toThrow(/verification/);
    }
  });

  it('fails safely if the previous model cannot be backed up', async () => {
    fakes.failBackup = true;
    download();
    await expect(setupSpeech('/storage')).rejects.toThrow('backup failed');
    expect(await installedSpeechModel('/storage')).toBeUndefined();
  });

  it('times out a stalled download and cleans staging', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (url: URL, options: { signal: AbortSignal }) =>
            new Promise((resolve, reject) => {
              void url;
              void resolve;
              options.signal.addEventListener('abort', () => {
                reject(new Error('aborted'));
              });
            }),
        ),
      );
      const result = setupSpeech('/storage');
      const assertion = expect(result).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(900_000);
      await assertion;
      expect([...fakes.files.keys()]).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
  it('checks cancellation between downloaded assets', async () => {
    download();
    fakes.progressHook = () => {
      fakes.cancel?.();
    };
    await expect(setupSpeech('/storage')).rejects.toThrow(/cancel/);
  });

  it('rejects staging if its contents change before final verification', async () => {
    download();
    fakes.readHook = (file) => {
      if (file.includes('.setup-')) fakes.overrideRead = new TextEncoder().encode('wrong!');
    };
    await expect(setupSpeech('/storage')).rejects.toThrow(/verification/);
  });

  it('checks cancellation after staged verification and after inspecting the target', async () => {
    download();
    fakes.readHook = (file) => {
      if (file.includes('.setup-') && file.endsWith('.onnx')) fakes.cancel?.();
    };
    await expect(setupSpeech('/storage')).rejects.toThrow(/cancel/);
    fakes.readHook = undefined;
    fakes.files.clear();
    let targetChecks = 0;
    fakes.statHook = (file) => {
      if (file.includes('/revision/') && ++targetChecks === 2) fakes.cancel?.();
    };
    await expect(setupSpeech('/storage')).rejects.toThrow(/cancel/);
  });

  it('reuses a verified model installed concurrently before commit', async () => {
    download();
    let targetChecks = 0;
    fakes.statHook = (file) => {
      if (file.includes('/revision/') && ++targetChecks === 2) {
        fakes.files.set('/storage/speech/revision/config.json', new TextEncoder().encode('config'));
        fakes.files.set('/storage/speech/revision/onnx/model_quantized.onnx', new TextEncoder().encode('onnx'));
      }
    };
    await setupSpeech('/storage');
    expect(await installedSpeechModel('/storage')).toBe('/storage/speech/revision');
  });

  it('reports failed commit even without a previous directory', async () => {
    download();
    fakes.failRename = true;
    await expect(setupSpeech('/storage')).rejects.toThrow('rename failed');
  });

  it('cleans up even if cancelling a response body fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fakes.cancel?.();
        return new Response(new ReadableStream({ cancel: () => Promise.reject(new Error('cancel failed')) }));
      }),
    );
    await expect(setupSpeech('/storage')).rejects.toThrow(/cancel/);
  });
  it('stops before requesting a second asset when cancellation arrives as the first closes', async () => {
    let pulls = 0;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              if (pulls++ === 0) controller.enqueue(new TextEncoder().encode('config'));
              else {
                controller.close();
                queueMicrotask(() => {
                  fakes.cancel?.();
                });
              }
            },
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(setupSpeech('/storage')).rejects.toThrow(/cancel/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
