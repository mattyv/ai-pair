import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_AUDIO_VERSION, CommandChannel, type LocalAudioFrame } from '@ai-pair/protocol';
import { RemoteNarration } from '../../vscode/src/remote_narration';
import { CompanionNarration } from '../src/companion_narration';
import { LocalConnection } from '../src/local_connection';

afterEach(() => {
  vi.useRealTimers();
});

describe('local audio command integration', () => {
  it('keeps heartbeats flowing while a spoken unit is still playing', async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<void>();
    const lost = vi.fn<() => void>();
    let inboundSequence = 1;
    let outboundSequence = 0;
    let workspace: RemoteNarration;
    const companion = new CompanionNarration({
      epoch: 'epoch',
      page: () => 1,
      speech: {
        speak: () => pending.promise,
        attentionCue: () => Promise.resolve(),
        pause: () => {},
        resume: () => {},
        cancel: () => {
          pending.resolve();
        },
      },
      stopOutput: () => Promise.resolve(),
      observation: () => undefined,
      nextSequence: () => ++outboundSequence,
      send: (frame) => {
        workspace.ack(frame);
      },
    });
    const connection = new LocalConnection({
      leaseMs: 100,
      receive: (frame) => {
        if (frame.type !== 'heartbeat') companion.receive(frame);
      },
      lost,
    });
    expect(
      connection.attach({
        version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
        connectionEpoch: 'epoch',
        sequence: 1,
        type: 'attach',
      }),
    ).toBe(true);
    const channel = new CommandChannel<LocalAudioFrame>({
      timeoutMs: 50,
      maxPending: 4,
      lost,
      send: (frame) => {
        connection.accept(frame);
        return Promise.resolve();
      },
    });
    function nextSequence(): number {
      return ++inboundSequence;
    }
    workspace = new RemoteNarration({
      epoch: 'epoch',
      page: () => 1,
      timeoutMs: 500,
      nextSequence,
      send: (frame) => {
        void channel.send(frame);
      },
    });
    const speaking = workspace.speak('Synthetic narration.');
    await Promise.resolve();
    for (let index = 0; index < 3; index++) {
      await vi.advanceTimersByTimeAsync(70);
      expect(
        await channel.send({ version: LOCAL_AUDIO_VERSION, connectionEpoch: 'epoch', sequence: nextSequence(), type: 'heartbeat' }),
      ).toBe(true);
      expect(lost).not.toHaveBeenCalled();
    }
    pending.resolve();
    await speaking;
    channel.dispose();
    connection.dispose();
  });
  it('settles a refused unit during local retirement so a subsequent unit can run', async () => {
    const retirement = Promise.withResolvers<void>();
    const playing = Promise.withResolvers<void>();
    let inbound = 1;
    let outbound = 0;
    let workspace: RemoteNarration;
    const speak = vi.fn<(_: string) => Promise<void>>(() => playing.promise);
    const companion = new CompanionNarration({
      epoch: 'epoch',
      page: () => 1,
      speech: { speak, attentionCue: () => Promise.resolve(), pause: () => {}, resume: () => {}, cancel: () => {} },
      stopOutput: () => retirement.promise,
      observation: () => undefined,
      nextSequence: () => ++outbound,
      send: (frame) => {
        workspace.ack(frame);
      },
    });
    const connection = new LocalConnection({
      leaseMs: 1000,
      receive: (frame) => {
        companion.receive(frame);
      },
      lost: () => {},
    });
    expect(
      connection.attach({
        version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
        connectionEpoch: 'epoch',
        sequence: 1,
        type: 'attach',
      }),
    ).toBe(true);
    workspace = new RemoteNarration({
      epoch: 'epoch',
      page: () => 1,
      timeoutMs: 1000,
      nextSequence: () => ++inbound,
      send: (frame) => {
        connection.accept(frame);
      },
    });
    const barrier = companion.interruptThen(() => {});
    await workspace.speak('Refused while stopping.');
    expect(speak).not.toHaveBeenCalled();
    retirement.resolve();
    await barrier;
    const next = workspace.speak('Next unit.');
    expect(speak).toHaveBeenCalledTimes(1);
    playing.resolve();
    await next;
    workspace.dispose();
    connection.dispose();
  });
});
