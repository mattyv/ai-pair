import { describe, expect, it, vi } from 'vitest';
import type { LocalAudioFrame } from '@ai-pair/protocol';
import { PanelUpdateSender } from '../src/panel_update_sender';

describe('workspace panel update sender', () => {
  it('sends replay as ordered bounded per-event updates using the shared sequence', async () => {
    const frames: LocalAudioFrame[] = [];
    let sequence = 5;
    const sender = new PanelUpdateSender({
      epoch: 'epoch',
      page: () => 1,
      nextSequence: () => ++sequence,
      send: (frame) => {
        frames.push(frame);
        return Promise.resolve(true);
      },
      unavailable: vi.fn<() => void>(),
    });
    expect(
      await sender.post({
        type: 'replay',
        events: [
          { type: 'say', text: 'one' },
          { type: 'say', text: 'two' },
        ],
      }),
    ).toBe(true);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ type: 'panelChunk', sequence: 6, messageId: 1 });
    expect(frames[1]).toMatchObject({ type: 'panelChunk', sequence: 7, messageId: 2 });
  });

  it('reports oversized updates and stops sending after page replacement', async () => {
    let page: number | undefined = 1;
    const unavailable = vi.fn<() => void>();
    const send = vi.fn<(frame: LocalAudioFrame) => Promise<boolean>>(() => {
      page = 2;
      return Promise.resolve(true);
    });
    const sender = new PanelUpdateSender({ epoch: 'epoch', page: () => page, nextSequence: () => 1, send, unavailable });
    expect(await sender.post({ type: 'say', text: 'x'.repeat(16_777_217) })).toBe(false);
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(await sender.post({ type: 'say', text: 'x'.repeat(40_000) })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('reports an oversized replay event and still sends later complete events', async () => {
    const frames: LocalAudioFrame[] = [];
    const unavailable = vi.fn<() => void>();
    const sender = new PanelUpdateSender({
      epoch: 'epoch',
      page: () => 1,
      nextSequence: () => 1,
      send: (frame) => {
        frames.push(frame);
        return Promise.resolve(true);
      },
      unavailable,
    });
    expect(
      await sender.post({
        type: 'replay',
        events: [
          { type: 'say', text: 'x'.repeat(16_777_217) },
          { type: 'say', text: 'later' },
        ],
      }),
    ).toBe(false);
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: 'panelChunk', messageId: 2 });
  });
  it('reports bounded queue overflow and failed frame delivery', async () => {
    const gate = Promise.withResolvers<boolean>();
    const unavailable = vi.fn<() => void>();
    const sender = new PanelUpdateSender({ epoch: 'epoch', page: () => 1, nextSequence: () => 1, send: () => gate.promise, unavailable });
    const pending = Array.from({ length: 512 }, () => sender.post({ type: 'say', text: 'x' }));
    expect(await sender.post({ type: 'say', text: 'overflow' })).toBe(false);
    expect(unavailable).toHaveBeenCalledTimes(1);
    gate.resolve(false);
    expect(await pending[0]).toBe(false);
    await Promise.all(pending);
    expect(unavailable).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid or unready updates and recovers its queue after a send rejection', async () => {
    const unavailable = vi.fn<() => void>();
    let page: number | undefined;
    const send = vi.fn<(_: LocalAudioFrame) => Promise<boolean>>().mockRejectedValueOnce(new Error('private')).mockResolvedValue(true);
    const sender = new PanelUpdateSender({ epoch: 'epoch', page: () => page, nextSequence: () => 1, send, unavailable });
    expect(await sender.post({ type: 'say', text: 'not ready' })).toBe(false);
    page = 1;
    expect(await sender.post({ type: 'speechAudio', wavBase64: 'no' })).toBe(false);
    await expect(sender.post({ type: 'say', text: 'first' })).rejects.toThrow('private');
    expect(await sender.post({ type: 'say', text: 'second' })).toBe(true);
  });
});
