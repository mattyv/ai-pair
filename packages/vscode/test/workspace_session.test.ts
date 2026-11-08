import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalAudioFrame } from '@ai-pair/protocol';
import { WorkspaceSession } from '../src/workspace_session';

const fake = vi.hoisted(() => ({
  channelOptions: undefined as import('@ai-pair/protocol').CommandChannelOptions<import('@ai-pair/protocol').LocalAudioFrame> | undefined,
  narrationOptions: undefined as import('../src/remote_narration').RemoteNarrationOptions | undefined,
  updatesOptions: undefined as import('../src/panel_update_sender').PanelUpdateSenderOptions | undefined,
  bridgeOptions: undefined as import('../src/workspace_panel_bridge').WorkspacePanelBridgeOptions | undefined,
  page: undefined as number | undefined,
  send: vi.fn<(frame: import('@ai-pair/protocol').LocalAudioFrame) => Promise<boolean>>().mockResolvedValue(true),
  channelDispose: vi.fn<() => void>(),
  ack: vi.fn<(_: unknown) => boolean>().mockReturnValue(true),
  cancel: vi.fn<() => void>(),
  narrationDispose: vi.fn<() => void>(),
  post: vi.fn<(_: unknown) => Promise<boolean>>().mockResolvedValue(true),
  accept: vi.fn<(_: unknown) => boolean>().mockReturnValue(true),
  bridgeDispose: vi.fn<() => void>(),
}));
vi.mock('@ai-pair/protocol', async (original) => ({
  ...(await original<typeof import('@ai-pair/protocol')>()),
  CommandChannel: class {
    constructor(options: typeof fake.channelOptions) {
      fake.channelOptions = options;
    }
    send = fake.send;
    dispose = fake.channelDispose;
  },
}));
vi.mock('../src/remote_narration', () => ({
  RemoteNarration: class {
    constructor(options: typeof fake.narrationOptions) {
      fake.narrationOptions = options;
    }
    ack = fake.ack;
    cancel = fake.cancel;
    dispose = fake.narrationDispose;
  },
}));
vi.mock('../src/panel_update_sender', () => ({
  PanelUpdateSender: class {
    constructor(options: typeof fake.updatesOptions) {
      fake.updatesOptions = options;
    }
    post = fake.post;
  },
}));
vi.mock('../src/workspace_panel_bridge', () => ({
  WorkspacePanelBridge: class {
    constructor(options: typeof fake.bridgeOptions) {
      fake.bridgeOptions = options;
    }
    page() {
      return fake.page;
    }
    accept = fake.accept;
    dispose = fake.bridgeDispose;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fake.page = undefined;
});
afterEach(() => {
  vi.useRealTimers();
});

const frame: LocalAudioFrame = { version: 1, connectionEpoch: 'epoch', sequence: 2, type: 'heartbeat' };

describe('workspace session wiring', () => {
  it('wires callbacks and preserves ordered heartbeat and panel actions', async () => {
    const attachRemote = vi.fn<(_: number, send: (message: unknown) => void) => void>();
    const receiveRemote = vi.fn<(_: number, action: import('@ai-pair/protocol').LocalPanelAction) => void>();
    const closeRemote = vi.fn<(_: number) => void>();
    const lost = vi.fn<() => void>();
    const unavailable = vi.fn<() => void>();
    const session = new WorkspaceSession({
      epoch: 'epoch',
      panel: { attachRemote, receiveRemote, closeRemote },
      send: vi.fn<(_: LocalAudioFrame) => Promise<void>>().mockResolvedValue(),
      lost,
      unavailable,
    });
    expect(session.pageReady()).toBe(false);
    expect(session.accept('anything')).toBe(true);
    fake.bridgeOptions?.action({ type: 'ready' });
    expect(attachRemote).not.toHaveBeenCalled();
    fake.page = 1;
    expect(session.pageReady()).toBe(true);
    fake.bridgeOptions?.action({ type: 'ready' });
    const sendPanel = attachRemote.mock.calls[0]?.[1];
    sendPanel?.({ type: 'say', text: 'synthetic' });
    expect(fake.post).toHaveBeenCalled();
    fake.bridgeOptions?.action({ type: 'pause' });
    expect(receiveRemote).toHaveBeenCalledTimes(2);
    fake.bridgeOptions?.terminal({
      version: 1,
      connectionEpoch: 'epoch',
      sequence: 1,
      type: 'terminal',
      pageEpoch: 1,
      jobId: '1',
      outcome: 'ended',
    });
    fake.bridgeOptions?.pageChanged();
    expect(fake.ack).toHaveBeenCalled();
    expect(fake.cancel).toHaveBeenCalled();
    fake.narrationOptions?.send(frame);
    expect(fake.narrationOptions?.page()).toBe(1);
    expect(fake.updatesOptions?.page()).toBe(1);
    await fake.updatesOptions?.send(frame);
    fake.updatesOptions?.unavailable();
    expect(unavailable).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fake.send).toHaveBeenCalled();
    fake.channelOptions?.lost();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(closeRemote).toHaveBeenCalledWith(1);
    session.dispose();
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('disposes an idle session without reporting loss', () => {
    const lost = vi.fn<() => void>();
    const session = new WorkspaceSession({
      epoch: 'epoch',
      panel: {
        attachRemote: vi.fn<(_: number, send: (message: unknown) => void) => void>(),
        receiveRemote: vi.fn<(_: number, action: import('@ai-pair/protocol').LocalPanelAction) => void>(),
        closeRemote: vi.fn<(_: number) => void>(),
      },
      send: vi.fn<(_: LocalAudioFrame) => Promise<void>>(),
      lost,
    });
    fake.updatesOptions?.unavailable();
    session.dispose();
    expect(lost).not.toHaveBeenCalled();
  });
});

it('allows all four bounded synthesis and playback stages before the remote backstop', () => {
  const session = new WorkspaceSession({
    epoch: 'epoch',
    panel: {
      attachRemote: vi.fn<(_: number, send: (message: unknown) => void) => void>(),
      receiveRemote: vi.fn<(_: number, action: import('@ai-pair/protocol').LocalPanelAction) => void>(),
      closeRemote: vi.fn<(_: number) => void>(),
    },
    send: vi.fn().mockResolvedValue(undefined),
    lost: vi.fn<() => void>(),
  });
  const worstCaseMs = 5000 + 20_000 + 4 * 20_000 + 4 * 20_000 + 40_600 + 4 * 5000;
  expect(fake.narrationOptions?.timeoutMs).toBeGreaterThanOrEqual(worstCaseMs + 10_000);
  session.dispose();
});
