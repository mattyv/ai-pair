import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticEvent } from '@ai-pair/core';
import { Diagnostics, MAX_DIAGNOSTIC_EVENTS } from '../src/diagnostics';

afterEach(() => {
  vi.useRealTimers();
});

describe('diagnostics', () => {
  it('starts with unavailable states and records typed events in order', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234);
    const diagnostics = new Diagnostics({ version: '0.13.0', build: 'abc123' });
    expect(diagnostics.snapshot()).toEqual({
      version: '0.13.0',
      build: 'abc123',
      session: 'unavailable',
      connection: 'unavailable',
      connectionId: 'unavailable',
      paused: 'unavailable',
      pauseReasons: 'unavailable',
      events: [],
    });
    diagnostics.record({ kind: 'connection', state: 'connected', connectionId: 2 });
    vi.setSystemTime(1250);
    diagnostics.record({ kind: 'session', state: 'active' });
    diagnostics.record({ kind: 'pause', paused: true, reasons: ['away'] });
    diagnostics.record({ kind: 'command', id: 7, phase: 'end', exitCode: 1 });
    expect(diagnostics.snapshot()).toMatchObject({
      connection: 'connected',
      session: 'active',
      paused: true,
      events: [
        { seq: 1, time: 1234, kind: 'connection', state: 'connected', connectionId: 2 },
        { seq: 2, time: 1250, kind: 'session', state: 'active' },
        { seq: 3, time: 1250, kind: 'pause', paused: true, reasons: ['away'] },
        { seq: 4, time: 1250, kind: 'command', id: 7, phase: 'end', exitCode: 1 },
      ],
    });
  });

  it('bounds its history while retaining the latest state and returns independent snapshots', () => {
    const diagnostics = new Diagnostics({ version: 'v1', build: 'abc' });
    diagnostics.record({ kind: 'session', state: 'active' });
    for (let id = 0; id < MAX_DIAGNOSTIC_EVENTS + 1; id++) {
      diagnostics.record({ kind: 'command', id, phase: 'start' });
    }
    const snapshot = diagnostics.snapshot();
    expect(snapshot.events).toHaveLength(MAX_DIAGNOSTIC_EVENTS);
    expect(snapshot.session).toBe('active');
    expect(snapshot.events[0]?.seq).toBe(3);
    snapshot.events.splice(0);
    expect(diagnostics.snapshot().events).toHaveLength(MAX_DIAGNOSTIC_EVENTS);
  });

  it('copies only allowlisted fields and rejects malformed input and unsafe identity strings', () => {
    const diagnostics = new Diagnostics({ version: '/secret/path', build: 'token secret' });
    // Simulate an untrusted caller adding sensitive fields to an otherwise valid event.
    const unsafe: unknown = { kind: 'command', id: 4, phase: 'end', exitCode: 0, command: 'secret command', path: '/private' };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    diagnostics.record(unsafe as DiagnosticEvent);
    const malformed: unknown = { kind: 'request', connectionId: 2, id: 3, method: '/private', phase: 'received' };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    diagnostics.record(malformed as DiagnosticEvent);
    const text = JSON.stringify(diagnostics.snapshot());
    expect(text).not.toContain('secret');
    expect(text).not.toContain('/private');
    expect(diagnostics.snapshot()).toMatchObject({
      version: 'unavailable',
      build: 'unavailable',
      events: [{ kind: 'command', id: 4, phase: 'end', exitCode: 0 }],
    });
    expect(diagnostics.snapshot().events).toHaveLength(1);
  });

  it('retains valid request, integration and completion events', () => {
    const diagnostics = new Diagnostics({ version: '1', build: 'b' });
    diagnostics.record({ kind: 'request', connectionId: 2, id: 9, method: 'step', phase: 'received' });
    diagnostics.record({ kind: 'command', id: 1, phase: 'requested', waitMs: 0.5 });
    diagnostics.record({ kind: 'command', id: 1, phase: 'integration', available: false });
    diagnostics.record({ kind: 'command', id: 1, phase: 'end' });
    diagnostics.record({ kind: 'pause', paused: false, reasons: [] });
    const snapshot = diagnostics.snapshot();
    expect(snapshot.events).toHaveLength(5);
    expect(snapshot.pauseReasons).toEqual([]);
    const pause = snapshot.events[4];
    if (pause?.kind === 'pause') pause.reasons.push('away');
    expect(diagnostics.snapshot().pauseReasons).toEqual([]);
    expect(diagnostics.snapshot().events[4]).toMatchObject({ reasons: [] });
  });

  it('rejects malformed values rather than copying untrusted data', () => {
    const diagnostics = new Diagnostics({ version: '1', build: 'b' });
    const invalid: unknown[] = [
      { kind: 'session', state: 'secret' },
      { kind: 'connection', state: 'secret', connectionId: 1 },
      { kind: 'connection', state: 'connected', connectionId: -1 },
      { kind: 'pause', paused: 'secret', reasons: [] },
      { kind: 'pause', paused: false, reasons: 'secret' },
      { kind: 'pause', paused: true, reasons: ['secret'] },
      { kind: 'pause', paused: true, reasons: ['away', 'away', 'away', 'away', 'away'] },
      { kind: 'pause', paused: true, reasons: [] },
      { kind: 'request', connectionId: 1, id: -1, method: 'step', phase: 'received' },
      { kind: 'request', connectionId: -1, id: 1, method: 'step', phase: 'received' },
      { kind: 'request', connectionId: 1, id: 1, method: 'step', phase: 'secret' },
      { kind: 'command', id: -1, phase: 'start' },
      { kind: 'command', id: 1, phase: 'requested', waitMs: Infinity },
      { kind: 'command', id: 1, phase: 'requested', waitMs: -1 },
      { kind: 'command', id: 1, phase: 'integration', available: 'secret' },
      { kind: 'command', id: 1, phase: 'end', exitCode: 1.5 },
      { kind: 'command', id: 1, phase: 'secret' },
      { kind: 'secret' },
    ];
    for (const event of invalid) {
      // This test deliberately simulates values from an untyped caller.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      diagnostics.record(event as DiagnosticEvent);
    }
    expect(diagnostics.snapshot().events).toEqual([]);
  });
});

it('OnlyAllowed, Recorded: records speech lifecycle without secret extras even when no session exists', () => {
  const diagnostics = new Diagnostics({ version: '1', build: 'b' });
  const unsafe: unknown = {
    kind: 'speech',
    event: 'catalog',
    phase: 'failed',
    provider: 'elevenlabs',
    reason: 'auth',
    apiKey: 'do-not-copy',
    voiceId: 'private-voice',
    text: 'private-text',
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  diagnostics.record(unsafe as DiagnosticEvent);
  expect(diagnostics.snapshot()).toMatchObject({
    session: 'unavailable',
    events: [{ kind: 'speech', event: 'catalog', phase: 'failed', provider: 'elevenlabs', reason: 'auth' }],
  });
  expect(JSON.stringify(diagnostics.snapshot())).not.toMatch(/do-not-copy|private-voice|private-text/);
});

it('TypeOK, OnlyAllowed: rejects unrecognized speech enums and records capability without a reason', () => {
  const diagnostics = new Diagnostics({ version: '1', build: 'b' });
  const invalid = [
    { kind: 'speech', event: 'private-text', phase: 'received', provider: 'kokoro' },
    { kind: 'speech', event: 'preview', phase: 'private-text', provider: 'kokoro' },
    { kind: 'speech', event: 'preview', phase: 'received', provider: 'private-text' },
    { kind: 'speech', event: 'preview', phase: 'received', provider: 'kokoro', reason: 'private-text' },
  ];
  for (const value of invalid) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    diagnostics.record(value as unknown as DiagnosticEvent);
  }
  diagnostics.record({ kind: 'speech', event: 'capability', phase: 'ready', provider: 'kokoro' });
  expect(diagnostics.snapshot().events).toHaveLength(1);
  expect(JSON.stringify(diagnostics.snapshot())).not.toContain('private-text');
});

it('records only allowlisted local runtime failure codes', () => {
  const diagnostics = new Diagnostics({ version: '1', build: 'b' });
  const unsafe: unknown = {
    kind: 'speech',
    event: 'runtime',
    phase: 'failed',
    provider: 'kokoro',
    reason: 'worker_native',
    error: '/private/lib secret text',
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  diagnostics.record(unsafe as DiagnosticEvent);
  expect(diagnostics.snapshot().events).toMatchObject([
    { kind: 'speech', event: 'runtime', phase: 'failed', provider: 'kokoro', reason: 'worker_native' },
  ]);
  expect(JSON.stringify(diagnostics.snapshot())).not.toMatch(/private|secret/);
});
