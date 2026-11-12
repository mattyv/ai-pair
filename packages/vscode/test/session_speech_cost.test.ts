import { describe, expect, it, vi } from 'vitest';
import { SessionSpeechCost } from '../src/session_speech_cost';

describe('SessionSpeechCost', () => {
  it('accumulates provider-confirmed charges once and retains them after end', () => {
    const changed = vi.fn<(view: import('../src/session_speech_cost').SessionSpeechCostView) => void>();
    const cost = new SessionSpeechCost(changed);
    cost.start();
    const first = cost.begin();
    const second = cost.begin();
    expect(cost.view()).toEqual({ seen: true, total: 0, pending: 2, partial: false });
    first?.(0.012);
    first?.(0.012);
    second?.(0.003);
    cost.end();
    expect(cost.view()).toEqual({ seen: true, total: 0.015, pending: 0, partial: false });
    expect(changed).toHaveBeenCalled();
  });

  it('marks missing or invalid charges as partial and preserves confirmed amounts', () => {
    const cost = new SessionSpeechCost(() => {});
    cost.start();
    cost.begin()?.(0.1);
    cost.begin()?.(undefined);
    cost.begin()?.(Number.NaN);
    cost.begin()?.(-1);
    expect(cost.view()).toEqual({ seen: true, total: 0.1, pending: 0, partial: true, reasons: ['generation-lookup-failed'] });
  });

  it('never publishes an infinite subtotal when valid charges overflow', () => {
    const cost = new SessionSpeechCost(() => {});
    cost.start();
    cost.begin()?.(Number.MAX_VALUE);
    cost.begin()?.(Number.MAX_VALUE);
    expect(cost.view()).toEqual({ seen: true, total: Number.MAX_VALUE, pending: 0, partial: true, reasons: ['generation-lookup-failed'] });
  });

  it('ignores a late charge after a fresh session begins', () => {
    const cost = new SessionSpeechCost(() => {});
    cost.start();
    const old = cost.begin();
    cost.start();
    old?.(1);
    expect(cost.view()).toEqual({ seen: false, total: 0, pending: 0, partial: false });
    cost.begin()?.(0.2);
    expect(cost.view().total).toBe(0.2);
  });

  it('rejects a previous session request delayed before provider dispatch', () => {
    const cost = new SessionSpeechCost(() => {});
    cost.start();
    const old = cost.capture();
    cost.start();
    expect(old?.()).toBeUndefined();
    expect(cost.view()).toEqual({ seen: false, total: 0, pending: 0, partial: false });
    const current = cost.capture();
    cost.end();
    current?.()?.(0.1);
    expect(cost.view()).toEqual({ seen: true, total: 0.1, pending: 0, partial: false });
  });

  it('retains active state on resume and marks an unknown restored session partial', () => {
    const cost = new SessionSpeechCost(() => {});
    expect(cost.begin()).toBeUndefined();
    cost.restore();
    expect(cost.view()).toEqual({ seen: true, total: 0, pending: 0, partial: true, reasons: ['restored'] });
    cost.begin()?.(0.01);
    cost.restore();
    expect(cost.view()).toEqual({ seen: true, total: 0.01, pending: 0, partial: true, reasons: ['restored'] });
    cost.end();
    expect(cost.begin()).toBeUndefined();
  });
});

it('retains bounded reasons for unavailable charges and restored history', () => {
  const ledger = new SessionSpeechCost(() => {});
  ledger.restore();
  ledger.begin()?.('missing-generation-id');
  ledger.begin()?.('generation-not-published');
  expect(ledger.view().reasons).toEqual(['restored', 'missing-generation-id', 'generation-not-published']);
});
