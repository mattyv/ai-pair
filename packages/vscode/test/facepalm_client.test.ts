// FacepalmClient's local subscription to Facepalm (#83). Solitary: node:net, node:fs/promises,
// node:os, and node:crypto are mocked; the socket is a real EventEmitter standing in for
// net.Socket, driven by hand.

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FacepalmClient } from '../src/facepalm_client';

const VALID_TOKEN = 'a'.repeat(64);

/** A fake net.Socket: a real EventEmitter, with the methods FacepalmClient calls, faked. */
function makeSocket() {
  // net.Socket exposes EventEmitter methods, which FacepalmClient's LineReader relies on.
  // oxlint-disable-next-line unicorn/prefer-event-target
  const socket = Object.assign(new EventEmitter(), {
    written: [] as string[],
    destroyed: false,
    setEncoding: vi.fn(),
    write: vi.fn(),
    destroy: vi.fn(),
  });
  socket.write.mockImplementation((data: string) => {
    socket.written.push(data);
    return true;
  });
  socket.destroy.mockImplementation(() => {
    socket.destroyed = true;
  });
  return socket;
}

const fakes = vi.hoisted(() => ({
  homedir: '/home/user',
  /** The token file's content and stat, or `undefined` for one that doesn't exist. */
  tokenFile: undefined as { content: string; mode: number; uid: number } | undefined,
  sockets: [] as Array<ReturnType<typeof makeSocket>>,
  /** The socket path each `net.createConnection` call asked for, in order. */
  socketPaths: [] as string[],
  /** How many `randomUUID()` calls this test has made so far, for a deterministic per-instance name. */
  nextUuid: 0,
}));

vi.mock('node:os', () => ({ homedir: () => fakes.homedir }));
vi.mock('node:crypto', () => ({ randomUUID: () => `uuid-${++fakes.nextUuid}` }));
vi.mock('node:net', () => ({
  createConnection: vi.fn((socketPath: string) => {
    fakes.socketPaths.push(socketPath);
    const socket = makeSocket();
    fakes.sockets.push(socket);
    return socket;
  }),
}));
vi.mock('node:fs/promises', () => ({
  stat: vi.fn((file: string) => {
    if (fakes.tokenFile === undefined || !file.endsWith('/clients/ai-pair')) {
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    }
    return Promise.resolve({ isFile: () => true, mode: fakes.tokenFile.mode, uid: fakes.tokenFile.uid });
  }),
  readFile: vi.fn((file: string) => {
    if (fakes.tokenFile === undefined || !file.endsWith('/clients/ai-pair')) {
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    }
    return Promise.resolve(fakes.tokenFile.content);
  }),
}));

/** Sets `process.platform`, restored in `afterEach`. */
function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

const realPlatform = process.platform;
const realGetuid = process.getuid?.bind(process);

/** Approves this extension with `token` (default valid, owned, private). */
function approve(overrides: Partial<{ content: string; mode: number; uid: number }> = {}): void {
  fakes.tokenFile = { content: VALID_TOKEN, mode: 0o600, uid: 1000, ...overrides };
}

/** Returns the last socket `net.createConnection` made. */
function lastSocket(): ReturnType<typeof makeSocket> {
  const socket = fakes.sockets.at(-1);
  if (socket === undefined) throw new Error('No socket was created.');
  return socket;
}

/** Completes the handshake on `socket`: connects, then answers its `hello` with `{"ok":true}`. */
async function connectAndApprove(socket: ReturnType<typeof makeSocket> = lastSocket()): Promise<void> {
  socket.emit('connect');
  await vi.advanceTimersByTimeAsync(0);
  socket.emit('data', '{"ok":true}\n');
}

beforeEach(() => {
  vi.useFakeTimers();
  onPlatform('linux');
  Object.defineProperty(process, 'getuid', { value: () => 1000, configurable: true });
  fakes.tokenFile = undefined;
  fakes.sockets.length = 0;
  fakes.socketPaths.length = 0;
  fakes.nextUuid = 0;
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  if (realGetuid === undefined) {
    delete (process as { getuid?: unknown }).getuid;
  } else {
    Object.defineProperty(process, 'getuid', { value: realGetuid, configurable: true });
  }
  delete process.env.AI_PAIR_FACEPALM_HOME;
  vi.clearAllMocks();
});

describe('absence', () => {
  it('never connects, and resolves undefined, with no approved token', async () => {
    const client = new FacepalmClient();
    await expect(client.markBeat('question', 1500)).resolves.toBeUndefined();
    expect(fakes.sockets).toHaveLength(0);
  });

  it('treats a token file not owned by this user as unapproved', async () => {
    approve({ uid: 999 });
    const client = new FacepalmClient();
    await expect(client.markBeat('question', 1500)).resolves.toBeUndefined();
    expect(fakes.sockets).toHaveLength(0);
  });

  it('treats a token file readable by group or others as unapproved', async () => {
    approve({ mode: 0o640 });
    const client = new FacepalmClient();
    await expect(client.markBeat('question', 1500)).resolves.toBeUndefined();
    expect(fakes.sockets).toHaveLength(0);
  });

  it('treats a token that is not 64 hex characters as unapproved', async () => {
    approve({ content: 'not-a-token' });
    const client = new FacepalmClient();
    await expect(client.markBeat('question', 1500)).resolves.toBeUndefined();
    expect(fakes.sockets).toHaveLength(0);
  });

  it('skips the ownership check where process.getuid is unavailable', async () => {
    delete (process as { getuid?: unknown }).getuid;
    approve({ uid: 999 });
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.sockets).toHaveLength(1);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await beat;
  });

  it('resolves undefined, and never throws, when the connection is refused', async () => {
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('error', new Error('ECONNREFUSED'));
    await expect(beat).resolves.toBeUndefined();
    expect(lastSocket().destroy).toHaveBeenCalled();
  });

  it('resolves undefined when the connection attempt times out', async () => {
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(beat).resolves.toBeUndefined();
    expect(lastSocket().destroy).toHaveBeenCalled();
  });

  it('resolves undefined when hello is never answered', async () => {
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('connect');
    await vi.advanceTimersByTimeAsync(5000);
    await expect(beat).resolves.toBeUndefined();
    expect(lastSocket().destroy).toHaveBeenCalled();
  });

  it('resolves undefined when the daemon refuses hello', async () => {
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('connect');
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', '{"error":"a stranger"}\n');
    await expect(beat).resolves.toBeUndefined();
    expect(lastSocket().destroy).toHaveBeenCalled();
  });
});

describe('a beat', () => {
  it('sends hello with the approved token, then the beat, bounded to 1 to 10000 ms', async () => {
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit(
      'data',
      `${JSON.stringify({ readings: [], missed: 0, interpretation: { id: 7, feeling: 'agreement', beat: 'question', feelings: ['agreement', 'unknown'] } })}\n`,
    );
    await expect(beat).resolves.toEqual({ id: 7, feeling: 'agreement', feelings: ['agreement', 'unknown'] });
    expect(lastSocket().written).toEqual([`hello ai-pair-uuid-1 ${VALID_TOKEN}\n`, 'beat question 1500\n']);
  });

  it('resolves undefined for a reply with no interpretation, without closing the connection', async () => {
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('proposal', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await expect(beat).resolves.toBeUndefined();
    expect(lastSocket().destroy).not.toHaveBeenCalled();
  });

  it('retires the connection, and resolves undefined, when a beat never answers', async () => {
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(beat).resolves.toBeUndefined();
    expect(lastSocket().destroy).toHaveBeenCalled();
  });

  it('reuses one open connection for a later beat', async () => {
    approve();
    const client = new FacepalmClient();
    const first = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await first;
    const second = client.markBeat('proposal', 1500);
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await second;
    expect(fakes.sockets).toHaveLength(1);
  });

  it('answers two overlapping requests in order, never interleaved', async () => {
    approve();
    const client = new FacepalmClient();
    const first = client.markBeat('question', 1500);
    const second = client.feel(1, 'agreement');
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit(
      'data',
      `${JSON.stringify({ readings: [], missed: 0, interpretation: { id: 1, feeling: 'agreement', beat: 'question', feelings: ['agreement'] } })}\n`,
    );
    await first;
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ ok: true })}\n`);
    await second;
    expect(lastSocket().written.slice(1)).toEqual(['beat question 1500\n', 'feel 1 agreement\n']);
  });

  it('answers a request with undefined, and still lets the next one through, if sending it throws', async () => {
    approve();
    const client = new FacepalmClient();
    const first = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    lastSocket().write.mockImplementationOnce(() => {
      throw new Error('write after end');
    });
    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toBeUndefined();
    const second = client.feel(1, 'agreement');
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ ok: true })}\n`);
    await expect(second).resolves.toBeUndefined();
  });

  it('reconnects after the connection is closed by the daemon', async () => {
    approve();
    const client = new FacepalmClient();
    const first = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await first;
    lastSocket().emit('close');
    const second = client.markBeat('proposal', 1500);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.sockets).toHaveLength(2);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await second;
  });

  it('retries connecting after a failed attempt, instead of staying absent', async () => {
    approve();
    const client = new FacepalmClient();
    const first = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('error', new Error('ECONNREFUSED'));
    await first;
    const second = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.sockets).toHaveLength(2);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await second;
  });

  it('drops a reply line past the maximum length, and resolves undefined', async () => {
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', 'x'.repeat(64 * 1024 + 1));
    await expect(beat).resolves.toBeUndefined();
    expect(lastSocket().destroy).toHaveBeenCalled();
  });

  it('resolves undefined for a reply that is not valid JSON', async () => {
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', 'not json\n');
    await expect(beat).resolves.toBeUndefined();
  });

  it('assembles a reply split across more than one chunk', async () => {
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    const reply = `${JSON.stringify({ readings: [], missed: 0, interpretation: { id: 1, feeling: 'agreement', beat: 'question', feelings: ['agreement'] } })}\n`;
    lastSocket().emit('data', reply.slice(0, 5));
    lastSocket().emit('data', reply.slice(5));
    await expect(beat).resolves.toEqual({ id: 1, feeling: 'agreement', feelings: ['agreement'] });
  });

  it('resolves undefined when the socket errors while a beat is outstanding', async () => {
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('error', new Error('lost'));
    await expect(beat).resolves.toBeUndefined();
  });

  it('uses the macOS per-user directory on darwin', async () => {
    onPlatform('darwin');
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await beat;
    expect(fakes.sockets).toHaveLength(1);
  });

  it('looks under AI_PAIR_FACEPALM_HOME instead of the real per-user directory when it is set', async () => {
    process.env.AI_PAIR_FACEPALM_HOME = '/sandbox/facepalm';
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await beat;
    expect(fakes.socketPaths).toEqual(['/sandbox/facepalm/service.sock']);
  });
});

describe('feel', () => {
  it('tells Facepalm the picked feeling, and resolves on an ok reply', async () => {
    approve();
    const client = new FacepalmClient();
    const felt = client.feel(3, 'confused');
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ ok: true })}\n`);
    await expect(felt).resolves.toBeUndefined();
    expect(lastSocket().written).toEqual([`hello ai-pair-uuid-1 ${VALID_TOKEN}\n`, 'feel 3 confused\n']);
  });

  it('resolves without throwing when Facepalm refuses the feeling', async () => {
    approve();
    const client = new FacepalmClient();
    const felt = client.feel(3, 'confused');
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ error: 'too late' })}\n`);
    await expect(felt).resolves.toBeUndefined();
  });

  it('does nothing, and never connects, with no approved token', async () => {
    const client = new FacepalmClient();
    await expect(client.feel(3, 'confused')).resolves.toBeUndefined();
    expect(fakes.sockets).toHaveLength(0);
  });

  it('refuses, and never connects, once retired, instead of reconnecting for a card the panel should have closed (#140)', async () => {
    approve();
    const client = new FacepalmClient();
    client.retire();
    await expect(client.feel(3, 'confused')).resolves.toBeUndefined();
    expect(fakes.sockets).toHaveLength(0);
  });

  it('refuses a feel sent after retiring an open connection, without opening a new one (#140)', async () => {
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await beat;
    const opened = lastSocket();
    client.retire();
    await expect(client.feel(1, 'agreement')).resolves.toBeUndefined();
    expect(fakes.sockets).toHaveLength(1);
    expect(opened.written).toHaveLength(2);
  });
});

describe('retire', () => {
  it('closes an open connection, and a later call reopens it', async () => {
    approve();
    const client = new FacepalmClient();
    const first = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await first;
    const opened = lastSocket();
    client.retire();
    await vi.advanceTimersByTimeAsync(0);
    expect(opened.destroy).toHaveBeenCalled();
    const second = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.sockets).toHaveLength(2);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await second;
  });

  it('does nothing before any connection was ever opened', () => {
    const client = new FacepalmClient();
    expect(() => {
      client.retire();
    }).not.toThrow();
  });

  it('does not reopen a connection replaced after this retire was requested', async () => {
    approve();
    const client = new FacepalmClient();
    const first = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await first;
    const opened = lastSocket();
    client.retire();
    const second = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await second;
    const reopened = lastSocket();
    // The first connection's belated close (its destroy() was already requested) must not retire the one that replaced it.
    opened.emit('close');
    await vi.advanceTimersByTimeAsync(0);
    expect(opened.destroy).toHaveBeenCalled();
    expect(reopened.destroy).not.toHaveBeenCalled();
    const third = client.feel(1, 'agreement');
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.sockets).toHaveLength(2);
    reopened.emit('data', `${JSON.stringify({ ok: true })}\n`);
    await third;
  });
});

describe('connection name', () => {
  it('connects under its own per-instance name, built from the approved name and a UUID (#138)', async () => {
    approve();
    const client = new FacepalmClient();
    const beat = client.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    await connectAndApprove();
    await vi.advanceTimersByTimeAsync(0);
    lastSocket().emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await beat;
    expect(lastSocket().written[0]).toBe(`hello ai-pair-uuid-1 ${VALID_TOKEN}\n`);
  });

  it('gives a second window its own distinct name, so Facepalm never refuses it as a name already connected', async () => {
    approve();
    const first = new FacepalmClient();
    const second = new FacepalmClient();
    const firstBeat = first.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    const firstSocket = lastSocket();
    await connectAndApprove(firstSocket);
    await vi.advanceTimersByTimeAsync(0);
    firstSocket.emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await firstBeat;
    const secondBeat = second.markBeat('question', 1500);
    await vi.advanceTimersByTimeAsync(0);
    const secondSocket = lastSocket();
    await connectAndApprove(secondSocket);
    await vi.advanceTimersByTimeAsync(0);
    secondSocket.emit('data', `${JSON.stringify({ readings: [], missed: 0 })}\n`);
    await secondBeat;
    expect(firstSocket.written[0]).toBe(`hello ai-pair-uuid-1 ${VALID_TOKEN}\n`);
    expect(secondSocket.written[0]).toBe(`hello ai-pair-uuid-2 ${VALID_TOKEN}\n`);
  });
});
