import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalAudioFrame, LocalPanelChunk } from '@ai-pair/protocol';
import { PanelUpdateSender } from '../src/panel_update_sender';

const fake = vi.hoisted(() => ({
  split: vi.fn<(_: unknown, id: { pageEpoch: number; messageId: number }) => Array<import('@ai-pair/protocol').LocalPanelChunk>>(),
}));
vi.mock('@ai-pair/protocol', async (original) => ({
  ...(await original<typeof import('@ai-pair/protocol')>()),
  splitPanelUpdate: fake.split,
}));

beforeEach(() => {
  fake.split.mockReset().mockImplementation((_, id) => [{ ...id, index: 0, count: 1, data: '{}' }]);
});

describe('panel update sender wiring', () => {
  it('serializes replay events and uses the shared sequence', async () => {
    const send = vi.fn<(_: LocalAudioFrame) => Promise<boolean>>().mockResolvedValue(true);
    let sequence = 0;
    const sender = new PanelUpdateSender({
      epoch: 'epoch',
      page: () => 1,
      nextSequence: () => ++sequence,
      send,
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
    // SendBatch, Packed: consecutive small events share one message (#118).
    expect(fake.split.mock.calls.map(([update]) => update)).toEqual([
      {
        type: 'replay',
        events: [
          { type: 'say', text: 'one' },
          { type: 'say', text: 'two' },
        ],
      },
    ]);
    expect(send.mock.calls.map(([frame]) => frame.sequence)).toEqual([1]);
  });

  it('SessionAlone, Bounded, Ordered: sends session events and oversized events alone, and splits a run at the bound (#118)', async () => {
    const send = vi.fn<(_: LocalAudioFrame) => Promise<boolean>>().mockResolvedValue(true);
    const sender = new PanelUpdateSender({ epoch: 'epoch', page: () => 1, nextSequence: () => 1, send, unavailable: vi.fn<() => void>() });
    // The batch bound is 64 chunks of 16,384 units.
    const half = 'x'.repeat(600_000);
    const over = 'y'.repeat(1_100_000);
    const events = [
      { type: 'say', text: 'a' },
      { type: 'session', active: true, task: 'T' },
      { type: 'say', text: 'b' },
      { type: 'say', text: 'c' },
      { type: 'say', text: over },
      { type: 'say', text: half },
      { type: 'say', text: half },
      { type: 'say', text: 'd' },
    ] as const;
    expect(await sender.post({ type: 'replay', events })).toBe(true);
    expect(fake.split.mock.calls.map(([update]) => update)).toEqual([
      { type: 'replay', events: [events[0]] },
      { type: 'replay', events: [events[1]] },
      { type: 'replay', events: [events[2], events[3]] },
      { type: 'replay', events: [events[4]] },
      { type: 'replay', events: [events[5]] },
      { type: 'replay', events: [events[6], events[7]] },
    ]);
    fake.split.mockClear();
    const edges = [
      { type: 'session', active: true },
      { type: 'say', text: 'e' },
      { type: 'session', active: false, reason: 'agent' },
    ] as const;
    expect(await sender.post({ type: 'replay', events: edges })).toBe(true);
    expect(fake.split.mock.calls.map(([update]) => update)).toEqual(edges.map((event) => ({ type: 'replay', events: [event] })));
  });

  it('rejects invalid or unready updates and surfaces unavailable transfers once', async () => {
    let page: number | undefined;
    const unavailable = vi.fn<() => void>();
    const send = vi.fn<(_: LocalAudioFrame) => Promise<boolean>>().mockResolvedValue(false);
    const sender = new PanelUpdateSender({ epoch: 'epoch', page: () => page, nextSequence: () => 1, send, unavailable });
    expect(await sender.post({ type: 'say', text: 'x' })).toBe(false);
    page = 1;
    expect(await sender.post({ type: 'speechAudio', wavBase64: 'private' })).toBe(false);
    fake.split.mockImplementationOnce(() => {
      throw new Error('oversize');
    });
    expect(await sender.post({ type: 'say', text: 'x' })).toBe(false);
    expect(await sender.post({ type: 'say', text: 'x' })).toBe(false);
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it('stops chunks on page replacement and continues after rejected delivery', async () => {
    let page = 1;
    const send = vi
      .fn<(_: LocalAudioFrame) => Promise<boolean>>()
      .mockImplementationOnce(() => {
        page = 2;
        return Promise.resolve(true);
      })
      .mockRejectedValueOnce(new Error('private'))
      .mockResolvedValue(true);
    fake.split.mockImplementationOnce(
      (_, id) =>
        [
          { ...id, index: 0, count: 2, data: '{' },
          { ...id, index: 1, count: 2, data: '}' },
        ] satisfies LocalPanelChunk[],
    );
    const sender = new PanelUpdateSender({
      epoch: 'epoch',
      page: () => page,
      nextSequence: () => 1,
      send,
      unavailable: vi.fn<() => void>(),
    });
    expect(await sender.post({ type: 'say', text: 'x' })).toBe(false);
    await expect(sender.post({ type: 'say', text: 'x' })).rejects.toThrow('private');
    expect(await sender.post({ type: 'say', text: 'x' })).toBe(true);
  });

  it('bounds queued updates and reports overflow only once', async () => {
    const gate = Promise.withResolvers<boolean>();
    const unavailable = vi.fn<() => void>();
    const sender = new PanelUpdateSender({ epoch: 'epoch', page: () => 1, nextSequence: () => 1, send: () => gate.promise, unavailable });
    const pending = Array.from({ length: 512 }, () => sender.post({ type: 'say', text: 'x' }));
    expect(await sender.post({ type: 'say', text: 'overflow' })).toBe(false);
    gate.resolve(false);
    await Promise.all(pending);
    expect(unavailable).toHaveBeenCalledTimes(1);
  });
});
