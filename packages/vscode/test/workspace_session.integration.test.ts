import { LOCAL_AUDIO_VERSION } from '@ai-pair/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSession } from '../src/workspace_session';

afterEach(() => {
  vi.useRealTimers();
});

describe('workspace companion session', () => {
  it('attaches the remote page, forwards actions, and sends heartbeat commands while active', async () => {
    vi.useFakeTimers();
    const attach = vi.fn<(_: number, send: (message: unknown) => void) => void>();
    const receive = vi.fn<(_: number, action: unknown) => void>();
    const close = vi.fn<(_: number) => void>();
    const send = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue(undefined);
    const lost = vi.fn<() => void>();
    const session = new WorkspaceSession({
      epoch: 'epoch',
      panel: { attachRemote: attach, receiveRemote: receive, closeRemote: close },
      send,
      lost,
    });
    expect(
      session.accept({
        version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
        connectionEpoch: 'epoch',
        sequence: 1,
        type: 'panelAction',
        pageEpoch: 1,
        action: { type: 'ready' },
      }),
    ).toBe(true);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenCalledWith(1, { type: 'ready' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ type: 'heartbeat', sequence: 2 });
    session.dispose();
    expect(close).toHaveBeenCalledWith(1);
  });

  it('settles speech only for the matching companion terminal frame', async () => {
    const send = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue(undefined);
    const session = new WorkspaceSession({
      epoch: 'epoch',
      panel: {
        attachRemote: vi.fn<(_: number, send: (message: unknown) => void) => void>(),
        receiveRemote: vi.fn<(_: number, action: unknown) => void>(),
        closeRemote: vi.fn<(_: number) => void>(),
      },
      send,
      lost: vi.fn<() => void>(),
    });
    session.accept({
      version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
      connectionEpoch: 'epoch',
      sequence: 1,
      type: 'panelAction',
      pageEpoch: 1,
      action: { type: 'ready' },
    });
    const speaking = session.narration.speak('Hello.');
    expect(
      session.accept({
        version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
        connectionEpoch: 'epoch',
        sequence: 2,
        type: 'terminal',
        pageEpoch: 1,
        jobId: '1',
        outcome: 'ended',
      }),
    ).toBe(true);
    await speaking;
    session.dispose();
  });
  it('retires the exact old job after a replacement page is ready', async () => {
    const send = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue(undefined);
    const session = new WorkspaceSession({
      epoch: 'epoch',
      panel: {
        attachRemote: vi.fn<(_: number, send: (message: unknown) => void) => void>(),
        receiveRemote: vi.fn<(_: number, action: unknown) => void>(),
        closeRemote: vi.fn<(_: number) => void>(),
      },
      send,
      lost: vi.fn<() => void>(),
    });
    session.accept({
      version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
      connectionEpoch: 'epoch',
      sequence: 1,
      type: 'panelAction',
      pageEpoch: 1,
      action: { type: 'ready' },
    });
    const old = session.narration.speak('Old.');
    session.accept({
      version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
      connectionEpoch: 'epoch',
      sequence: 2,
      type: 'panelAction',
      pageEpoch: 2,
      action: { type: 'ready' },
    });
    await old;
    expect(
      session.accept({
        version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
        connectionEpoch: 'epoch',
        sequence: 3,
        type: 'terminal',
        pageEpoch: 1,
        jobId: '1',
        outcome: 'failed',
      }),
    ).toBe(true);
    const next = session.narration.speak('New.');
    await Promise.resolve();
    expect(send.mock.calls.map(([value]) => value)).toContainEqual(expect.objectContaining({ type: 'speak', jobId: '2', pageEpoch: 2 }));
    session.narration.cancel();
    await next;
    session.dispose();
  });
});
