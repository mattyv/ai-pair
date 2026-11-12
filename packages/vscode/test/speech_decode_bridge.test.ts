import { afterEach, expect, it, vi } from 'vitest';
import { createOpenRouterAudioDecoder, SpeechDecodeBridge } from '../src/speech_decode_bridge';
import { SpeechDecodeLifecycle, type DecodeDocument, type DecodeProbe, type DecodeRequest } from '../src/speech_decode_lifecycle';

vi.mock('../src/speech_decode_lifecycle', () => {
  // The mock factory is hoisted before the test module's ordinary declarations.
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  function sameDocument(left: DecodeDocument | undefined, right: DecodeDocument): boolean {
    return left !== undefined && left.pageId === right.pageId && left.documentGeneration === right.documentGeneration;
  }
  function sameRequest(left: DecodeRequest | undefined, right: DecodeRequest): boolean {
    return sameDocument(left, right) && left?.requestId === right.requestId;
  }
  function sameProbe(left: DecodeProbe | undefined, right: DecodeProbe): boolean {
    return sameDocument(left, right) && left?.probeId === right.probeId;
  }
  return {
    SpeechDecodeLifecycle: class {
      private current?: DecodeDocument;
      private pending?: DecodeProbe;
      private readyState = false;
      private active?: DecodeRequest;
      private slot?: DecodeRequest;
      activate(document: DecodeDocument): void {
        this.current = document;
        this.pending = undefined;
        this.readyState = false;
        this.active = undefined;
      }
      probe(probe: DecodeProbe): boolean {
        if (!sameDocument(this.current, probe) || this.pending !== undefined || this.readyState) return false;
        this.pending = probe;
        return true;
      }
      probeFailed(probe: DecodeProbe): boolean {
        if (!sameProbe(this.pending, probe)) return false;
        this.pending = undefined;
        return true;
      }
      ready(probe: DecodeProbe): boolean {
        if (!sameDocument(this.current, probe) || !sameProbe(this.pending, probe)) return false;
        this.pending = undefined;
        this.readyState = true;
        return true;
      }
      isReadyFor(document: DecodeDocument): boolean {
        return sameDocument(this.current, document) && this.readyState;
      }
      begin(request: DecodeRequest): boolean {
        if (!this.isReadyFor(request) || this.active !== undefined || this.slot !== undefined) return false;
        this.active = request;
        return true;
      }
      dispatch(request: DecodeRequest): boolean {
        if (!sameRequest(this.active, request) || this.slot !== undefined) return false;
        this.slot = request;
        return true;
      }
      cancel(request: DecodeRequest): void {
        if (sameRequest(this.active, request)) this.active = undefined;
      }
      settle(request: DecodeRequest): boolean {
        if (!sameRequest(this.slot, request)) return false;
        this.slot = undefined;
        const accepted = sameRequest(this.active, request) && sameDocument(this.current, request);
        if (sameRequest(this.active, request)) this.active = undefined;
        return accepted;
      }
      destroy(document: DecodeDocument): void {
        if (sameDocument(this.slot, document)) this.slot = undefined;
        if (sameDocument(this.current, document)) {
          this.current = undefined;
          this.pending = undefined;
          this.active = undefined;
          this.readyState = false;
        }
      }
    },
  };
});

interface PostedMessage {
  type: string;
  document: DecodeDocument;
  probeId?: number;
  requestId?: number;
  format?: 'mp3' | 'pcm';
  audioBase64?: string;
  sampleRate?: number;
  channels?: number;
}
function isPostedMessage(value: unknown): value is PostedMessage {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string' && 'document' in value;
}
function lastMessage(post: ReturnType<typeof makePost>, type: string): PostedMessage {
  const message = post.mock.calls.map((call) => call[0]).findLast((value) => isPostedMessage(value) && value.type === type);
  if (!isPostedMessage(message)) throw new Error(`Missing ${type}`);
  return message;
}
function makePost(): ReturnType<typeof vi.fn<(message: object) => Promise<boolean>>> {
  return vi.fn<(message: object) => Promise<boolean>>().mockResolvedValue(true);
}
function wav(): Uint8Array {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  view.setUint32(4, 38, true);
  bytes.set(new TextEncoder().encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true);
  view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode('data'), 36);
  view.setUint32(40, 2, true);
  view.setInt16(44, 123, true);
  return bytes;
}
function setup(): {
  bridge: SpeechDecodeBridge;
  post: ReturnType<typeof makePost>;
  document: DecodeDocument;
  setPage: (page: number) => void;
} {
  const post = makePost();
  let pageId = 1;
  const bridge = new SpeechDecodeBridge({ post, page: () => pageId, probeTimeoutMs: 100, decodeTimeoutMs: 200 });
  const document = bridge.prepare(1);
  bridge.activate(document);
  return {
    bridge,
    post,
    document,
    setPage: (page) => {
      pageId = page;
    },
  };
}
async function admitted(context: ReturnType<typeof setup>, id = 1): Promise<import('../src/speech_types').OpenRouterAudioDecodeLease> {
  const promise = context.bridge.admit(id, new AbortController().signal);
  await vi.waitFor(() => {
    expect(context.post).toHaveBeenCalled();
  });
  const probe = lastMessage(context.post, 'speechDecodeProbe');
  if (probe.probeId === undefined) throw new Error('Missing probe ID');
  context.bridge.ready(context.document, probe.probeId, true);
  return promise;
}
it('rejects OpenRouter admission until a local panel can reserve a decoder', async () => {
  const signal = new AbortController().signal;
  await expect(createOpenRouterAudioDecoder(() => undefined).admit(1, signal)).rejects.toThrow('Decoder unavailable');
  await expect(createOpenRouterAudioDecoder(() => ({})).admit(1, signal)).rejects.toThrow('Decoder unavailable');
  const lease: import('../src/speech_types').OpenRouterAudioDecodeLease = {
    signal,
    decode: vi.fn(() => Promise.resolve({ wav: new Uint8Array([1]), durationMs: 1 })),
    cancel: () => {},
  };
  const admit = vi.fn(() => Promise.resolve(lease));
  await expect(createOpenRouterAudioDecoder(() => ({ admitSpeechDecode: admit })).admit(2, signal)).resolves.toBe(lease);
  expect(admit).toHaveBeenCalledWith(2, signal);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('waits for the matching readiness response before granting a lease', async () => {
  const context = setup();
  const pending = context.bridge.admit(1, new AbortController().signal);
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await vi.waitFor(() => {
    expect(context.post).toHaveBeenCalled();
  });
  const probe = lastMessage(context.post, 'speechDecodeProbe');
  if (probe.probeId === undefined) throw new Error('Missing probe ID');
  context.bridge.ready(context.document, probe.probeId + 1, true);
  await Promise.resolve();
  expect(settled).toBe(false);
  context.bridge.ready(context.document, probe.probeId, true);
  const lease = await pending;
  lease.cancel();
});

it('times out a probe and ignores its late acknowledgement during a retry', async () => {
  vi.useFakeTimers();
  const context = setup();
  const first = context.bridge.admit(1, new AbortController().signal);
  const firstRejected = expect(first).rejects.toThrow();
  await Promise.resolve();
  const old = lastMessage(context.post, 'speechDecodeProbe');
  if (old.probeId === undefined) throw new Error('Missing probe ID');
  await vi.advanceTimersByTimeAsync(100);
  await firstRejected;
  const retry = context.bridge.admit(2, new AbortController().signal);
  await Promise.resolve();
  const next = lastMessage(context.post, 'speechDecodeProbe');
  if (next.probeId === undefined) throw new Error('Missing retry probe ID');
  expect(next.probeId).not.toBe(old.probeId);
  let settled = false;
  void retry.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  context.bridge.ready(context.document, old.probeId, true);
  await Promise.resolve();
  expect(settled).toBe(false);
  context.bridge.ready(context.document, next.probeId, true);
  (await retry).cancel();
});

it('rejects an admission when a boot freezes immediately after readiness resolves', async () => {
  const context = setup();
  const pending = context.bridge.admit(1, new AbortController().signal);
  await vi.waitFor(() => {
    expect(context.post).toHaveBeenCalled();
  });
  const probe = lastMessage(context.post, 'speechDecodeProbe');
  if (probe.probeId === undefined) throw new Error('Missing probe ID');
  context.bridge.ready(context.document, probe.probeId, true);
  context.bridge.prepare(context.document.pageId);
  await expect(pending).rejects.toThrow('Decoder unavailable');
});

it('keeps admissions frozen when a non-current document tries to resume', async () => {
  const context = setup();
  const candidate = context.bridge.prepare(2);
  context.bridge.resume(candidate);
  await expect(context.bridge.admit(1, new AbortController().signal)).rejects.toThrow('Decoder unavailable');
  context.bridge.resume(context.document);
  (await admitted(context, 2)).cancel();
});

it('releases an admission canceled before decode and permits the next request', async () => {
  const context = setup();
  const lease = await admitted(context);
  await expect(context.bridge.admit(2, new AbortController().signal)).rejects.toThrow();
  lease.cancel();
  expect(lease.signal.aborted).toBe(true);
  const next = await context.bridge.admit(2, new AbortController().signal);
  next.cancel();
  expect(context.post.mock.calls.filter((call) => isPostedMessage(call[0]) && call[0].type === 'speechDecode')).toHaveLength(0);
});

it('revokes an admitted lease when its browser document is replaced', async () => {
  const context = setup();
  const lease = await admitted(context);
  expect(lease.signal.aborted).toBe(false);
  context.setPage(2);
  context.bridge.activate(context.bridge.prepare(2));
  expect(lease.signal.aborted).toBe(true);
  await expect(lease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal)).rejects.toThrow();
});

it('revokes an admitted lease when its browser document is destroyed', async () => {
  const context = setup();
  const lease = await admitted(context);
  context.bridge.destroy(context.document);
  expect(lease.signal.aborted).toBe(true);
});

it('retires active decode work when its owning document is destroyed', async () => {
  const context = setup();
  const lease = await admitted(context);
  const pending = lease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal);
  const rejection = expect(pending).rejects.toThrow();
  await vi.waitFor(() => {
    expect(lastMessage(context.post, 'speechDecode').requestId).toBeDefined();
  });
  context.bridge.destroy(context.document);
  expect(lease.signal.aborted).toBe(true);
  await rejection;
  context.setPage(2);
  const nextDocument = context.bridge.prepare(2);
  context.bridge.activate(nextDocument);
  const next = context.bridge.admit(2, new AbortController().signal);
  await vi.waitFor(() => {
    expect(lastMessage(context.post, 'speechDecodeProbe').document).toEqual(nextDocument);
  });
  const probe = lastMessage(context.post, 'speechDecodeProbe');
  if (probe.probeId === undefined) throw new Error('Missing probe ID');
  context.bridge.ready(nextDocument, probe.probeId, true);
  (await next).cancel();
});

it('retains a canceled physical decode until its matching result arrives', async () => {
  const context = setup();
  const lease = await admitted(context);
  const pending = lease.decode({ format: 'mp3', bytes: new Uint8Array([1, 2]) }, new AbortController().signal);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => {
    expect(lastMessage(context.post, 'speechDecode').requestId).toBeDefined();
  });
  const request = lastMessage(context.post, 'speechDecode');
  if (request.requestId === undefined) throw new Error('Missing request ID');
  expect(request).toMatchObject({ format: 'mp3', audioBase64: Buffer.from([1, 2]).toString('base64') });
  lease.cancel();
  await rejected;
  await expect(context.bridge.admit(2, new AbortController().signal)).rejects.toThrow();
  context.bridge.decoded(context.document, request.requestId + 1, { wavBase64: Buffer.from(wav()).toString('base64'), durationMs: 600 });
  await expect(context.bridge.admit(2, new AbortController().signal)).rejects.toThrow();
  context.bridge.decoded(context.document, request.requestId, { wavBase64: Buffer.from(wav()).toString('base64'), durationMs: 600 });
  (await context.bridge.admit(2, new AbortController().signal)).cancel();
});

it('holds old document work across replacement until actual destruction', async () => {
  const context = setup();
  const lease = await admitted(context);
  const result = lease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal);
  const rejection = expect(result).rejects.toThrow();
  await vi.waitFor(() => {
    expect(lastMessage(context.post, 'speechDecode').requestId).toBeDefined();
  });
  const request = lastMessage(context.post, 'speechDecode');
  if (request.requestId === undefined) throw new Error('Missing request ID');
  context.setPage(2);
  const nextDocument = context.bridge.prepare(2);
  context.bridge.activate(nextDocument);
  await rejection;
  const next = context.bridge.admit(2, new AbortController().signal);
  const nextRejected = expect(next).rejects.toThrow();
  await nextRejected;
  context.bridge.decoded(nextDocument, request.requestId, { wavBase64: Buffer.from(wav()).toString('base64'), durationMs: 600 });
  context.bridge.destroy(context.document);
  const afterDestroy = context.bridge.admit(3, new AbortController().signal);
  await vi.waitFor(() => {
    expect(lastMessage(context.post, 'speechDecodeProbe').document).toEqual(nextDocument);
  });
  const probe = lastMessage(context.post, 'speechDecodeProbe');
  if (probe.probeId === undefined) throw new Error('Missing probe ID');
  context.bridge.ready(nextDocument, probe.probeId, true);
  (await afterDestroy).cancel();
});

it.each(['false', 'throw'] as const)('rejects a %s probe post and allows retry', async (failure) => {
  const context = setup();
  if (failure === 'false') context.post.mockResolvedValueOnce(false);
  else context.post.mockRejectedValueOnce(new Error('private'));
  await expect(context.bridge.admit(1, new AbortController().signal)).rejects.toThrow();
  const retry = context.bridge.admit(2, new AbortController().signal);
  await vi.waitFor(() => {
    expect(context.post).toHaveBeenCalledTimes(2);
  });
  const probe = lastMessage(context.post, 'speechDecodeProbe');
  if (probe.probeId === undefined) throw new Error('Missing probe ID');
  context.bridge.ready(context.document, probe.probeId, true);
  (await retry).cancel();
});

it.each(['false', 'throw'] as const)('releases a slot when decode post returns %s', async (failure) => {
  const context = setup();
  const lease = await admitted(context);
  if (failure === 'false') context.post.mockResolvedValueOnce(false);
  else context.post.mockRejectedValueOnce(new Error('private'));
  await expect(lease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal)).rejects.toThrow();
  (await context.bridge.admit(2, new AbortController().signal)).cancel();
});

it('rejects an unavailable readiness response and allows another probe', async () => {
  const context = setup();
  const pending = context.bridge.admit(1, new AbortController().signal);
  const failure = expect(pending).rejects.toThrow();
  await vi.waitFor(() => {
    expect(context.post).toHaveBeenCalled();
  });
  const probe = lastMessage(context.post, 'speechDecodeProbe');
  if (probe.probeId === undefined) throw new Error('Missing probe ID');
  context.bridge.ready(context.document, probe.probeId, false);
  await failure;
  const retry = context.bridge.admit(2, new AbortController().signal);
  await vi.waitFor(() => {
    expect(context.post).toHaveBeenCalledTimes(2);
  });
  const next = lastMessage(context.post, 'speechDecodeProbe');
  if (next.probeId === undefined) throw new Error('Missing probe ID');
  context.bridge.ready(context.document, next.probeId, true);
  (await retry).cancel();
});

it.each([
  { wavBase64: '!!!', durationMs: 600 },
  { wavBase64: Buffer.from('not a WAV').toString('base64'), durationMs: 600 },
  { wavBase64: Buffer.from(Uint8Array.from(wav(), (byte, index) => (index === 0 ? 0 : byte))).toString('base64'), durationMs: 600 },
  { wavBase64: 'A'.repeat(21_000_000), durationMs: 600 },
  { wavBase64: Buffer.from(wav()).toString('base64'), durationMs: -1 },
  { wavBase64: Buffer.from(wav()).toString('base64'), durationMs: 40_601 },
])('rejects malformed or oversized decoded output %#', async (value) => {
  const context = setup();
  const lease = await admitted(context);
  const pending = lease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal);
  const rejection = expect(pending).rejects.toThrow();
  await vi.waitFor(() => {
    expect(lastMessage(context.post, 'speechDecode').requestId).toBeDefined();
  });
  const message = lastMessage(context.post, 'speechDecode');
  if (message.requestId === undefined) throw new Error('Missing request ID');
  context.bridge.decoded(context.document, message.requestId, value);
  await rejection;
  (await context.bridge.admit(2, new AbortController().signal)).cancel();
});

it('rejects a decoded result without WAV data', async () => {
  const context = setup();
  const lease = await admitted(context);
  const pending = lease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal);
  const rejection = expect(pending).rejects.toThrow();
  await vi.waitFor(() => {
    expect(lastMessage(context.post, 'speechDecode').requestId).toBeDefined();
  });
  const request = lastMessage(context.post, 'speechDecode');
  if (request.requestId === undefined) throw new Error('Missing request ID');
  context.bridge.decoded(context.document, request.requestId);
  await rejection;
});

it('returns only the matching request and document result', async () => {
  const context = setup();
  const lease = await admitted(context);
  const pending = lease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal);
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await vi.waitFor(() => {
    expect(lastMessage(context.post, 'speechDecode').requestId).toBeDefined();
  });
  const message = lastMessage(context.post, 'speechDecode');
  if (message.requestId === undefined) throw new Error('Missing request ID');
  const output = { wavBase64: Buffer.from(wav()).toString('base64'), durationMs: 600 };
  context.bridge.decoded({ ...context.document, documentGeneration: context.document.documentGeneration + 1 }, message.requestId, output);
  context.bridge.decoded(context.document, message.requestId + 1, output);
  await Promise.resolve();
  expect(settled).toBe(false);
  context.bridge.decoded(context.document, message.requestId, output);
  await expect(pending).resolves.toEqual({ wav: wav(), durationMs: 1000 / 24_000 });
  lease.cancel();
});

it('times out logical decode without freeing its physical slot before destruction', async () => {
  vi.useFakeTimers();
  const context = setup();
  const pendingAdmission = context.bridge.admit(1, new AbortController().signal);
  await Promise.resolve();
  const probe = lastMessage(context.post, 'speechDecodeProbe');
  if (probe.probeId === undefined) throw new Error('Missing probe ID');
  context.bridge.ready(context.document, probe.probeId, true);
  const lease = await pendingAdmission;
  const pending = lease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal);
  const rejected = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(200);
  await rejected;
  await expect(context.bridge.admit(2, new AbortController().signal)).rejects.toThrow();
  context.bridge.destroy(context.document);
});

it('posts bounded PCM bytes and metadata through the generic audio message', async () => {
  const context = setup();
  const lease = await admitted(context);
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const pending = lease.decode({ format: 'pcm', bytes, sampleRate: 44_100, channels: 2 }, new AbortController().signal);
  await vi.waitFor(() => {
    expect(lastMessage(context.post, 'speechDecode').requestId).toBeDefined();
  });
  const message = lastMessage(context.post, 'speechDecode');
  if (message.requestId === undefined) throw new Error('Missing request ID');
  expect(message).toMatchObject({ format: 'pcm', audioBase64: Buffer.from(bytes).toString('base64'), sampleRate: 44_100, channels: 2 });
  context.bridge.decoded(context.document, message.requestId, { wavBase64: Buffer.from(wav()).toString('base64'), durationMs: 600 });
  await expect(pending).resolves.toEqual({ wav: wav(), durationMs: 1000 / 24_000 });
});

it('releases a probe when its owning document is destroyed', async () => {
  const context = setup();
  const pending = context.bridge.admit(1, new AbortController().signal);
  const rejection = expect(pending).rejects.toThrow();
  await vi.waitFor(() => {
    expect(context.post).toHaveBeenCalledOnce();
  });
  context.bridge.destroy(context.document);
  await rejection;
});

it('rejects admission when the page changes while its probe is pending', async () => {
  const context = setup();
  const pending = context.bridge.admit(1, new AbortController().signal);
  const rejection = expect(pending).rejects.toThrow();
  await vi.waitFor(() => {
    expect(context.post).toHaveBeenCalledOnce();
  });
  const probe = lastMessage(context.post, 'speechDecodeProbe');
  if (probe.probeId === undefined) throw new Error('Missing probe ID');
  context.setPage(2);
  context.bridge.ready(context.document, probe.probeId, true);
  await rejection;
});

it('rejects admission if the lifecycle refuses the current readiness probe', async () => {
  const context = setup();
  vi.spyOn(SpeechDecodeLifecycle.prototype, 'probe').mockReturnValue(false);
  await expect(context.bridge.admit(1, new AbortController().signal)).rejects.toThrow();
  expect(context.post).not.toHaveBeenCalled();
});

it('rejects admission if the lifecycle refuses to reserve a ready request', async () => {
  const context = setup();
  const pending = context.bridge.admit(1, new AbortController().signal);
  const rejection = expect(pending).rejects.toThrow();
  await vi.waitFor(() => {
    expect(context.post).toHaveBeenCalledOnce();
  });
  const probe = lastMessage(context.post, 'speechDecodeProbe');
  if (probe.probeId === undefined) throw new Error('Missing probe ID');
  context.bridge.ready(context.document, probe.probeId, true);
  vi.spyOn(SpeechDecodeLifecycle.prototype, 'begin').mockReturnValue(false);
  await rejection;
});

it('handles abort during probe setup and ignores the later probe completion', async () => {
  const context = setup();
  const controller = new AbortController();
  const add = controller.signal.addEventListener.bind(controller.signal);
  vi.spyOn(controller.signal, 'addEventListener').mockImplementation((...args) => {
    add(...args);
    controller.abort();
  });
  await expect(context.bridge.admit(1, controller.signal)).rejects.toThrow();
});

it('rejects malformed PCM inputs before posting a decode request', async () => {
  const context = setup();
  const lease = await admitted(context);
  await expect(
    lease.decode({ format: 'pcm', bytes: new Uint8Array([1]), sampleRate: 24_000, channels: 1 }, new AbortController().signal),
  ).rejects.toThrow();
  lease.cancel();
  (await context.bridge.admit(2, new AbortController().signal)).cancel();
  expect(context.post.mock.calls.filter((call) => isPostedMessage(call[0]) && call[0].type === 'speechDecode')).toHaveLength(0);
});

it.each(['probe', 'decode'] as const)('releases work when post throws synchronously for %s', async (kind) => {
  const context = setup();
  if (kind === 'probe') {
    context.post.mockImplementationOnce(() => {
      throw new Error('private');
    });
    await expect(context.bridge.admit(1, new AbortController().signal)).rejects.toThrow();
    const retry = context.bridge.admit(2, new AbortController().signal);
    await vi.waitFor(() => {
      expect(context.post).toHaveBeenCalledTimes(2);
    });
    const probe = lastMessage(context.post, 'speechDecodeProbe');
    if (probe.probeId === undefined) throw new Error('Missing probe ID');
    context.bridge.ready(context.document, probe.probeId, true);
    (await retry).cancel();
    return;
  }
  const lease = await admitted(context);
  context.post.mockImplementationOnce(() => {
    throw new Error('private');
  });
  await expect(lease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal)).rejects.toThrow();
  (await context.bridge.admit(2, new AbortController().signal)).cancel();
});

it('ignores a late post failure after a matching decoded result settled', async () => {
  const context = setup();
  const lease = await admitted(context);
  let resolvePost: ((sent: boolean) => void) | undefined;
  context.post.mockReturnValueOnce(
    new Promise((resolve) => {
      resolvePost = resolve;
    }),
  );
  const pending = lease.decode({ format: 'mp3', bytes: new Uint8Array([1]) }, new AbortController().signal);
  await vi.waitFor(() => {
    expect(lastMessage(context.post, 'speechDecode').requestId).toBeDefined();
  });
  const request = lastMessage(context.post, 'speechDecode');
  if (request.requestId === undefined) throw new Error('Missing request ID');
  context.bridge.decoded(context.document, request.requestId, { wavBase64: Buffer.from(wav()).toString('base64'), durationMs: 600 });
  await expect(pending).resolves.toEqual({ wav: wav(), durationMs: 1000 / 24_000 });
  resolvePost?.(false);
  await Promise.resolve();
});
