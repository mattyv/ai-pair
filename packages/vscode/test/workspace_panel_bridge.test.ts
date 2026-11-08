import { describe, expect, it, vi } from 'vitest';
import { WorkspacePanelBridge } from '../src/workspace_panel_bridge';

const base = { version: 1, connectionEpoch: 'epoch' };

describe('workspace panel bridge', () => {
  it('accepts only ordered current-page actions and terminal acknowledgements', () => {
    const action = vi.fn<(_: unknown) => void>();
    const terminal = vi.fn<(_: unknown) => void>();
    const pageChanged = vi.fn<() => void>();
    const bridge = new WorkspacePanelBridge({ epoch: 'epoch', action, terminal, pageChanged });
    expect(bridge.accept({ ...base, sequence: 1, type: 'panelAction', pageEpoch: 1, action: { type: 'ready' } })).toBe(true);
    expect(bridge.page()).toBe(1);
    expect(bridge.accept({ ...base, sequence: 2, type: 'panelAction', pageEpoch: 1, action: { type: 'reply', text: 'Hello.' } })).toBe(
      true,
    );
    expect(bridge.accept({ ...base, sequence: 2, type: 'panelAction', pageEpoch: 1, action: { type: 'pause' } })).toBe(false);
    expect(bridge.accept({ ...base, sequence: 3, type: 'terminal', jobId: '1', pageEpoch: 1, outcome: 'ended' })).toBe(true);
    expect(action).toHaveBeenCalledTimes(2);
    expect(terminal).toHaveBeenCalledTimes(1);
    expect(bridge.accept({ ...base, sequence: 4, type: 'panelAction', pageEpoch: 2, action: { type: 'ready' } })).toBe(true);
    expect(pageChanged).toHaveBeenCalledTimes(1);
    expect(bridge.accept({ ...base, sequence: 5, type: 'terminal', jobId: '1', pageEpoch: 1, outcome: 'canceled' })).toBe(true);
    expect(bridge.accept({ ...base, sequence: 6, type: 'panelAction', pageEpoch: 1, action: { type: 'reply', text: 'stale' } })).toBe(
      false,
    );
    expect(bridge.accept({ ...base, sequence: 4, type: 'panelAction', pageEpoch: 2, action: { type: 'pause' } })).toBe(false);
    expect(bridge.accept({ ...base, sequence: 7, type: 'panelAction', pageEpoch: 2, action: { type: 'pageClosed' } })).toBe(true);
    expect(bridge.page()).toBeUndefined();
    expect(bridge.accept({ ...base, sequence: 8, type: 'panelAction', pageEpoch: 2, action: { type: 'ready' } })).toBe(false);
    expect(bridge.accept({ ...base, sequence: 9, type: 'panelAction', pageEpoch: 3, action: { type: 'ready' } })).toBe(true);
  });

  it('rejects malformed, wrong-epoch, wrong-direction and unready-page messages', () => {
    const bridge = new WorkspacePanelBridge({
      epoch: 'epoch',
      action: vi.fn<(_: unknown) => void>(),
      terminal: vi.fn<(_: unknown) => void>(),
      pageChanged: vi.fn<() => void>(),
    });
    expect(bridge.page()).toBeUndefined();
    expect(bridge.accept({ bad: true })).toBe(false);
    expect(
      bridge.accept({ ...base, connectionEpoch: 'old', sequence: 1, type: 'panelAction', pageEpoch: 1, action: { type: 'ready' } }),
    ).toBe(false);
    expect(bridge.accept({ ...base, sequence: 1, type: 'heartbeat' })).toBe(false);
    expect(bridge.accept({ ...base, sequence: 2, type: 'panelAction', pageEpoch: 1, action: { type: 'reply', text: 'early' } })).toBe(
      false,
    );
    expect(bridge.accept({ ...base, sequence: 3, type: 'panelAction', pageEpoch: 0, action: { type: 'ready' } })).toBe(false);
    bridge.dispose();
    expect(bridge.accept({ ...base, sequence: 4, type: 'panelAction', pageEpoch: 1, action: { type: 'ready' } })).toBe(false);
  });
});
