import { describe, expect, it, vi } from 'vitest';
import { reportDiagnostic } from '../src/diagnostic_delivery';

describe('diagnostic delivery', () => {
  it('does nothing for an absent observer', () => {
    expect(() => {
      reportDiagnostic(undefined, { kind: 'test' }, {});
    }).not.toThrow();
  });

  it('passes the event and the original receiver to the current observer', () => {
    const receiver = { name: 'owner' };
    const observer = vi.fn<(event: { kind: string }) => void>();
    reportDiagnostic(observer, { kind: 'test' }, receiver);
    expect(observer).toHaveBeenCalledExactlyOnceWith({ kind: 'test' });
    expect(observer.mock.contexts[0]).toBe(receiver);
  });

  it('isolates a throwing observer from the operation', () => {
    const observer = vi.fn(() => {
      throw new Error('observer failure');
    });
    expect(() => {
      reportDiagnostic(observer, { kind: 'test' }, {});
    }).not.toThrow();
    expect(observer).toHaveBeenCalledOnce();
  });
});
