import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { AudioAdapter, AudioEvent, AudioLease, AudioOwner } from '../../audio-native/src';
import { CompanionOutput } from '../src/companion_output';

function fixture(
  page: () => number | undefined = () => 4,
  ready: () => boolean = () => true,
  localDiagnostic?: import('../../vscode/src/speech_service').SpeechOutput['localDiagnostic'],
) {
  const listener: { current: (event: AudioEvent) => void } = { current: vi.fn<(event: AudioEvent) => void>() };
  const lease = mock<AudioLease>();
  const admit = vi.fn<AudioAdapter['admit']>().mockResolvedValue(lease);
  const play = vi.fn<AudioAdapter['play']>().mockResolvedValue(undefined);
  const stop = vi.fn<AudioAdapter['stop']>().mockResolvedValue(undefined);
  const pause = vi.fn<AudioAdapter['pause']>().mockResolvedValue(undefined);
  const adapter: AudioAdapter = {
    capabilities: vi.fn(),
    list: vi.fn(),
    admit,
    play,
    pause,
    resume: vi.fn().mockResolvedValue(undefined),
    stop,
    onEvent: (callback) => {
      listener.current = callback;
      return { dispose: () => {} };
    },
  };
  const event = vi.fn<(event: import('../../vscode/src/speech_service').SpeechAudioEvent) => void>();
  const output = new CompanionOutput({
    adapter,
    connectionEpoch: 'connection',
    page,
    choice: () => ({ kind: 'device', id: 'selected' }),
    ready,
    localDiagnostic,
    event,
    status: vi.fn<import('../../vscode/src/speech_service').SpeechOutput['status']>(),
  });
  return {
    admit,
    play,
    stop,
    pause,
    output,
    event,
    send: (value: AudioEvent) => {
      listener.current(value);
    },
  };
}

describe('companion audio output', () => {
  it('reserves the chosen route before play and forwards matching terminal events', async () => {
    const { admit, play, output, event, send } = fixture();
    expect(await output.prepare(7)).toBe(true);
    const owner: AudioOwner = { connectionEpoch: 'connection', jobId: '7', pageEpoch: 4 };
    expect(admit.mock.calls).toEqual([[owner, { kind: 'device', id: 'selected' }]]);
    expect(output.play(7, new Uint8Array([1]))).toBe(4);
    expect(play.mock.calls).toHaveLength(1);
    send({ owner: { ...owner, pageEpoch: 3 }, sequence: 1, part: 0, type: 'ended' });
    expect(event).not.toHaveBeenCalled();
    send({ owner, sequence: 1, part: 0, type: 'started' });
    send({ owner, sequence: 2, part: 0, type: 'ended' });
    expect(event).toHaveBeenCalledWith({ id: 7, pageId: 4, event: 'started', part: 0 });
    expect(event).toHaveBeenCalledWith({ id: 7, pageId: 4, event: 'ended', part: 0 });
  });

  it('keeps the unit lease across parts and rejects stale part events', async () => {
    const { output, stop, event, send } = fixture();
    expect(output.parts).toBe(true);
    expect(await output.prepare(7)).toBe(true);
    const owner: AudioOwner = { connectionEpoch: 'connection', jobId: '7', pageEpoch: 4 };
    expect(output.play(7, new Uint8Array(44), 1000, 0)).toBe(4);
    send({ owner, sequence: 1, part: 0, type: 'ended' });
    expect(stop).not.toHaveBeenCalled();
    expect(output.play(7, new Uint8Array(44), 1000, 2)).toBeUndefined();
    expect(output.play(7, new Uint8Array(44), 1000, 1)).toBe(4);
    send({ owner, sequence: 2, part: 0, type: 'ended' });
    expect(event).toHaveBeenCalledTimes(1);
    send({ owner, sequence: 3, part: 1, type: 'ended' });
    expect(event).toHaveBeenLastCalledWith({ id: 7, pageId: 4, part: 1, event: 'ended' });
    expect(stop).not.toHaveBeenCalled();
    output.cancel(7);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('retires a failed part even when its event observer throws', async () => {
    const { output, stop, event, send } = fixture();
    const retired = Promise.withResolvers<void>();
    stop.mockReturnValue(retired.promise);
    event.mockImplementation(() => {
      throw new Error('private observer failure');
    });
    expect(await output.prepare(7)).toBe(true);
    expect(output.play(7, new Uint8Array(44), 1000, 0)).toBe(4);
    const owner: AudioOwner = { connectionEpoch: 'connection', jobId: '7', pageEpoch: 4 };
    expect(() => {
      send({ owner, sequence: 1, part: 0, type: 'failed' });
    }).not.toThrow();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(await output.prepare(8)).toBe(false);
    retired.resolve();
    await vi.waitFor(async () => {
      expect(await output.prepare(8)).toBe(true);
    });
  });

  it('retires a rejected play even when its event observer throws', async () => {
    const { output, play, stop, event } = fixture();
    const retired = Promise.withResolvers<void>();
    stop.mockReturnValue(retired.promise);
    play.mockRejectedValueOnce(new Error('private player failure'));
    event.mockImplementation(() => {
      throw new Error('private observer failure');
    });
    expect(await output.prepare(7)).toBe(true);
    expect(output.play(7, new Uint8Array(44), 1000, 0)).toBe(4);
    await vi.waitFor(() => {
      expect(stop).toHaveBeenCalledTimes(1);
    });
    expect(await output.prepare(8)).toBe(false);
    retired.resolve();
    await vi.waitFor(async () => {
      expect(await output.prepare(8)).toBe(true);
    });
  });

  it('invalidates a pending admission before a late success can dispatch playback', async () => {
    const { admit, play, stop, output } = fixture();
    const pending = Promise.withResolvers<AudioLease>();
    admit.mockReturnValue(pending.promise);
    const prepared = output.prepare(9);
    output.control(9, 4, 'stop');
    pending.resolve(mock<AudioLease>());
    expect(await prepared).toBe(false);
    expect(output.play(9, new Uint8Array([1]))).toBeUndefined();
    expect(play.mock.calls).toHaveLength(0);
    expect(stop.mock.calls.length).toBeGreaterThan(0);
  });
  it('keeps the route occupied until physical stop completes and ignores stale events', async () => {
    const { output, stop, event, send } = fixture();
    const stopped = Promise.withResolvers<void>();
    stop.mockReturnValue(stopped.promise);
    expect(await output.prepare(1)).toBe(true);
    expect(await output.prepare(2)).toBe(false);
    expect(output.play(2, new Uint8Array())).toBeUndefined();
    expect(output.play(1, new Uint8Array())).toBe(4);
    expect(output.play(1, new Uint8Array())).toBeUndefined();
    const owner: AudioOwner = { connectionEpoch: 'connection', jobId: '1', pageEpoch: 4 };
    send({ owner, sequence: 2, part: 0, type: 'started' });
    send({ owner, sequence: 1, part: 0, type: 'ended' });
    send({ owner: { ...owner, jobId: 'old' }, sequence: 3, part: 0, type: 'ended' });
    send({ owner: { ...owner, connectionEpoch: 'old' }, sequence: 3, part: 0, type: 'ended' });
    expect(event).toHaveBeenCalledTimes(1);
    send({ owner, sequence: 3, part: 0, type: 'ended' });
    expect(stop).not.toHaveBeenCalled();
    output.cancel(1);
    expect(await output.prepare(2)).toBe(false);
    stopped.resolve();
    await Promise.resolve();
    expect(await output.prepare(2)).toBe(true);
  });

  it('fails closed when the page or admission is unavailable', async () => {
    const absent = fixture(() => undefined);
    expect(await absent.output.prepare(1)).toBe(false);
    expect(absent.admit).not.toHaveBeenCalled();
    const failed = fixture();
    failed.admit.mockRejectedValueOnce(new Error('unavailable'));
    expect(await failed.output.prepare(1)).toBe(false);
    expect(failed.stop).toHaveBeenCalledTimes(1);
    expect(await failed.output.prepare(2)).toBe(true);
  });

  it('controls and cancels the exact owner and forwards local status', async () => {
    const { output, stop } = fixture();
    expect(await output.prepare(3)).toBe(true);
    output.control(4, 4, 'stop');
    output.control(3, 5, 'stop');
    expect(stop).not.toHaveBeenCalled();
    output.control(3, 4, 'pause');
    output.control(3, 4, 'resume');
    output.status(3, 'preparing');
    output.cancel(4);
    output.cancel(3);
    expect(stop).toHaveBeenCalledTimes(1);
    output.dispose();
    await Promise.resolve();
  });

  it('retires canceled and failed playback without releasing early', async () => {
    const first = fixture();
    expect(await first.output.prepare(5)).toBe(true);
    expect(first.output.play(5, new Uint8Array())).toBe(4);
    first.send({ owner: { connectionEpoch: 'connection', jobId: '5', pageEpoch: 4 }, sequence: 1, part: 0, type: 'canceled' });
    expect(first.event).toHaveBeenCalledWith({ id: 5, pageId: 4, event: 'failed', part: 0 });
    expect(first.stop).toHaveBeenCalled();
    const second = fixture();
    second.play.mockRejectedValue(new Error('device'));
    expect(await second.output.prepare(6)).toBe(true);
    expect(second.output.play(6, new Uint8Array())).toBe(4);
    await Promise.resolve();
    expect(second.event).toHaveBeenCalledWith({ id: 6, pageId: 4, event: 'failed', part: 0 });
    expect(second.stop).toHaveBeenCalled();
  });
  it('ignores late failures after cancellation and never releases on failed retirement', async () => {
    const { output, play, stop, event, send } = fixture();
    const playing = Promise.withResolvers<void>();
    play.mockReturnValue(playing.promise);
    stop.mockRejectedValue(new Error('not retired'));
    expect(await output.prepare(8)).toBe(true);
    expect(output.play(8, new Uint8Array())).toBe(4);
    output.cancel(8);
    output.control(8, 4, 'pause');
    playing.reject(new Error('late'));
    await Promise.resolve();
    send({ owner: { connectionEpoch: 'connection', jobId: '8', pageEpoch: 4 }, sequence: 1, part: 0, type: 'ended' });
    expect(event).not.toHaveBeenCalled();
    expect(await output.prepare(9)).toBe(false);
    output.dispose();
  });

  it('handles rejected controls while a pending admission is being canceled', async () => {
    const { output, admit, stop } = fixture();
    const pending = Promise.withResolvers<AudioLease>();
    admit.mockReturnValue(pending.promise);
    stop.mockRejectedValue(new Error('unavailable'));
    const result = output.prepare(1);
    expect(output.play(1, new Uint8Array())).toBeUndefined();
    output.cancel(1);
    await Promise.resolve();
    pending.reject(new Error('canceled'));
    expect(await result).toBe(false);
    expect(await output.prepare(2)).toBe(false);
    output.dispose();
  });

  it('disposes an idle output and ignores callbacks after retirement', () => {
    const { output, send, event } = fixture();
    output.dispose();
    send({ owner: { connectionEpoch: 'connection', jobId: '1', pageEpoch: 4 }, sequence: 1, part: 0, type: 'ended' });
    expect(event).not.toHaveBeenCalled();
  });
  it('ignores a rejected pause control without exposing the backend error', async () => {
    const { output, pause, event } = fixture();
    pause.mockRejectedValue(new Error('private'));
    expect(await output.prepare(1)).toBe(true);
    output.control(1, 4, 'pause');
    await Promise.resolve();
    expect(event).not.toHaveBeenCalled();
    output.dispose();
  });
  it('waits for local physical stop before a caller forwards an action', async () => {
    const { output, stop } = fixture();
    const retirement = Promise.withResolvers<void>();
    stop.mockReturnValue(retirement.promise);
    expect(await output.prepare(1)).toBe(true);
    output.cancel(1);
    let stopped = false;
    const barrier = output.stopAndWait().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    retirement.resolve();
    await barrier;
    expect(stopped).toBe(true);
  });
  it('waits for a pending admission stop and is harmless when already idle', async () => {
    const { output, admit, stop } = fixture();
    await output.stopAndWait();
    expect(stop).not.toHaveBeenCalled();
    const pending = Promise.withResolvers<AudioLease>();
    admit.mockReturnValue(pending.promise);
    const preparing = output.prepare(1);
    await output.stopAndWait();
    expect(await output.prepare(2)).toBe(false);
    pending.resolve(mock<AudioLease>());
    expect(await preparing).toBe(false);
  });
  it('releases an admitted route when stopAndWait confirms retirement', async () => {
    const { output } = fixture();
    expect(await output.prepare(1)).toBe(true);
    await output.stopAndWait();
    expect(await output.prepare(2)).toBe(true);
  });
  it('refuses stale or unavailable saved output before route admission', async () => {
    const { output, admit } = fixture(
      () => 4,
      () => false,
    );
    expect(await output.prepare(1)).toBe(false);
    expect(admit).not.toHaveBeenCalled();
  });
  it('forwards fixed local worker categories when a diagnostic sink is present', () => {
    const sink = vi.fn<NonNullable<import('../../vscode/src/speech_service').SpeechOutput['localDiagnostic']>>();
    const withSink = fixture(
      () => 4,
      () => true,
      sink,
    );
    withSink.output.localDiagnostic?.('failed', 'worker_module');
    expect(sink).toHaveBeenCalledWith('failed', 'worker_module');
    const withoutSink = fixture();
    withoutSink.output.localDiagnostic?.('ready');
  });
});
