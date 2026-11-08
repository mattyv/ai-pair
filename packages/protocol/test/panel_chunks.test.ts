import { describe, expect, it } from 'vitest';
import { PanelChunkAssembler, splitPanelUpdate } from '../src/panel_chunks';

describe('bounded panel update chunks', () => {
  it('reassembles a complete ordered update only for the current page', () => {
    const update = { type: 'say', text: 'x'.repeat(40_000) };
    const chunks = splitPanelUpdate(update, { messageId: 1, pageEpoch: 4 });
    expect(chunks.length).toBeGreaterThan(1);
    const assembler = new PanelChunkAssembler();
    assembler.setPage(4);
    for (const chunk of chunks.slice(0, -1)) expect(assembler.accept(chunk)).toBeUndefined();
    expect(assembler.accept(chunks.at(-1))).toEqual(update);
    expect(assembler.accept(chunks[0])).toBeUndefined();
  });

  it('discards partial, reordered, stale-page, malformed and oversized updates', () => {
    const chunks = splitPanelUpdate({ type: 'say', text: 'x'.repeat(40_000) }, { messageId: 1, pageEpoch: 4 });
    const assembler = new PanelChunkAssembler();
    assembler.setPage(4);
    expect(assembler.accept(chunks[1])).toBeUndefined();
    expect(assembler.accept(chunks[0])).toBeUndefined();
    assembler.setPage(5);
    expect(assembler.accept(chunks[1])).toBeUndefined();
    expect(assembler.accept({ bad: true })).toBeUndefined();
    expect(() => splitPanelUpdate({ type: 'speechAudio', wavBase64: 'abc' }, { messageId: 2, pageEpoch: 5 })).toThrow();
    expect(() => splitPanelUpdate({ type: 'say', text: 'x'.repeat(16_777_217) }, { messageId: 2, pageEpoch: 5 })).toThrow();
  });
});

it('drops mixed chunk counts and invalid assembled JSON or updates', () => {
  const assembler = new PanelChunkAssembler();
  assembler.setPage(1);
  expect(assembler.accept({ pageEpoch: 1, messageId: 1, index: 0, count: 2, data: '{' })).toBeUndefined();
  expect(assembler.accept({ pageEpoch: 1, messageId: 1, index: 1, count: 3, data: '}' })).toBeUndefined();
  expect(assembler.accept({ pageEpoch: 1, messageId: 2, index: 0, count: 1, data: '{' })).toBeUndefined();
  expect(assembler.accept({ pageEpoch: 1, messageId: 3, index: 0, count: 1, data: '{}' })).toBeUndefined();
});

it('never combines fragments across page replacement or a duplicate fragment', () => {
  const update = { type: 'say', text: 'x'.repeat(20_000) };
  const oldChunks = splitPanelUpdate(update, { messageId: 1, pageEpoch: 4 });
  const freshChunks = splitPanelUpdate(update, { messageId: 2, pageEpoch: 5 });
  const assembler = new PanelChunkAssembler();
  assembler.setPage(4);
  expect(assembler.accept(oldChunks[0])).toBeUndefined();
  assembler.setPage(5);
  expect(assembler.accept(oldChunks[1])).toBeUndefined();
  expect(assembler.accept(freshChunks[0])).toBeUndefined();
  expect(assembler.accept(freshChunks[0])).toBeUndefined();
  expect(assembler.accept(freshChunks[1])).toBeUndefined();
  const replacement = splitPanelUpdate({ type: 'say', text: 'fresh' }, { messageId: 3, pageEpoch: 5 });
  expect(assembler.accept(replacement[0])).toEqual({ type: 'say', text: 'fresh' });
});
