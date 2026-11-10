import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { mock } from 'vitest-mock-extended';
import { activate, deactivate } from '../src/extension';
import { createCompanionSession } from '../src/companion_session';

const fake = vi.hoisted(() => ({
  commands: new Map<string, (value: unknown) => unknown>(),
  prepare: vi.fn(),
  warning: vi.fn(),
  commit: vi.fn(),
  register: undefined as (() => void) | undefined,
  session: {
    accept: vi.fn(),
    keySet: vi.fn(),
    keyRemove: vi.fn(),
    preview: vi.fn(),
    ready: vi.fn().mockResolvedValue(true),
    dispose: vi.fn(),
    audioDiagnostics: vi.fn().mockReturnValue({ enabled: false }),
  },
}));
vi.mock('node:crypto', () => ({ randomUUID: () => 'token' }));
vi.mock('../src/attachment_gate', () => ({
  AttachmentGate: class {
    prepare = fake.prepare;
    commit = fake.commit;
    dispose() {}
    constructor(options: { register: () => void }) {
      fake.register = options.register;
    }
  },
}));
vi.mock('vscode', () => ({
  window: { showWarningMessage: fake.warning },
  commands: {
    registerCommand: (name: string, callback: (value: unknown) => unknown) => {
      fake.commands.set(name, callback);
      return { dispose: () => {} };
    },
  },
}));
vi.mock('../src/companion_session', () => ({
  createCompanionSession: vi.fn(() => ({
    ...fake.session,
    observation: () => ({ id: 1, state: 'speaking', started: true }),
    diagnostics: () => ({ version: 'test', build: 'test-build', events: [] }),
    gpuDiagnostics: () => ({ stage: 'idle' }),
  })),
}));

beforeEach(async () => {
  await deactivate();
  fake.commands.clear();
  vi.clearAllMocks();
});

describe('local companion activation', () => {
  it('signals readiness without preparing or registering a provider', () => {
    activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
    expect(fake.commands.get('aiPair.localAudio.activate')?.(undefined)).toBe(true);
    expect(fake.prepare).not.toHaveBeenCalled();
    expect(createCompanionSession).not.toHaveBeenCalled();
  });

  it('prepares without registering a provider and commits only once', () => {
    const subscriptions: vscode.Disposable[] = [];
    fake.prepare.mockReturnValue({ version: 2, epoch: 'epoch', token: 'token' });
    fake.commit
      .mockImplementationOnce(() => {
        fake.register?.();
        return true;
      })
      .mockReturnValueOnce(false);
    activate(mock<vscode.ExtensionContext>({ subscriptions }));
    const prepare = fake.commands.get('aiPair.localAudio.prepare');
    const commit = fake.commands.get('aiPair.localAudio.commit');
    expect(prepare).toBeDefined();
    expect(commit).toBeDefined();
    const prepared: unknown = prepare?.({ version: 2, epoch: 'epoch' });
    expect(createCompanionSession).not.toHaveBeenCalled();
    expect(commit?.(prepared)).toBe(true);
    expect(fake.commands.get('aiPair.localAudio.status')?.(undefined)).toEqual({ id: 1, state: 'speaking', started: true });
    expect(createCompanionSession).toHaveBeenCalledTimes(1);
    expect(commit?.(prepared)).toBe(false);
    for (const subscription of subscriptions) subscription.dispose();
  });
});

it('warns an old workspace to update both extensions and reload', () => {
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  fake.commands.get('aiPair.localAudio.prepare')?.({ version: 1, epoch: 'epoch' });
  expect(fake.warning).toHaveBeenCalledWith(expect.stringMatching(/Update both extensions and reload/));
  expect(createCompanionSession).not.toHaveBeenCalled();
});

it('rejects malformed commit and makes unattached commands safe', async () => {
  void deactivate();
  const subscriptions: vscode.Disposable[] = [];
  activate(mock<vscode.ExtensionContext>({ subscriptions }));
  expect(fake.commands.get('aiPair.localAudio.commit')?.({})).toBe(false);
  expect(fake.commit).not.toHaveBeenCalled();
  expect(fake.commands.get('aiPair.localAudio.frame')?.({})).toBe(false);
  expect(fake.commands.get('aiPair.localAudio.status')?.(undefined)).toBeUndefined();
  await expect(fake.commands.get('aiPair.localAudio.ready')?.('epoch')).resolves.toBe(false);
  expect(fake.commands.get('aiPair.localAudio.diagnostics')?.(undefined)).toBeUndefined();
  expect(fake.commands.get('aiPair.localAudio.gpuDiagnostics')?.(undefined)).toBeUndefined();
  expect(fake.commands.get('aiPair.localAudio.audioDiagnostics')?.(undefined)).toBeUndefined();
  await expect(fake.commands.get('aiPair.localAudio.keySet')?.(undefined)).resolves.toBeUndefined();
  await expect(fake.commands.get('aiPair.localAudio.keyRemove')?.(undefined)).resolves.toBeUndefined();
  await expect(fake.commands.get('aiPair.localAudio.preview')?.(undefined)).resolves.toBeUndefined();
  for (const subscription of subscriptions) subscription.dispose();
});

it('forwards attached commands to the local session and disposes it', async () => {
  const subscriptions: vscode.Disposable[] = [];
  fake.prepare.mockReturnValue({ version: 2, epoch: 'epoch', token: 'token' });
  fake.commit.mockImplementation(() => {
    fake.register?.();
    return true;
  });
  activate(mock<vscode.ExtensionContext>({ subscriptions }));
  const prepared = fake.commands.get('aiPair.localAudio.prepare')?.({});
  expect(fake.commands.get('aiPair.localAudio.commit')?.(prepared)).toBe(true);
  fake.commands.get('aiPair.localAudio.frame')?.({ message: 'safe' });
  await fake.commands.get('aiPair.localAudio.keySet')?.(undefined);
  await fake.commands.get('aiPair.localAudio.keyRemove')?.(undefined);
  await fake.commands.get('aiPair.localAudio.preview')?.(undefined);
  await expect(fake.commands.get('aiPair.localAudio.ready')?.('epoch')).resolves.toBe(true);
  expect(fake.session.ready).toHaveBeenCalledWith('epoch');
  expect(fake.commands.get('aiPair.localAudio.diagnostics')?.(undefined)).toEqual({ version: 'test', build: 'test-build', events: [] });
  expect(fake.commands.get('aiPair.localAudio.gpuDiagnostics')?.(undefined)).toEqual({ stage: 'idle' });
  expect(fake.commands.get('aiPair.localAudio.audioDiagnostics')?.(undefined)).toEqual({ enabled: false });
  expect(fake.session.accept).toHaveBeenCalledWith({ message: 'safe' });
  expect(fake.session.keySet).toHaveBeenCalledOnce();
  expect(fake.session.keyRemove).toHaveBeenCalledOnce();
  expect(fake.session.preview).toHaveBeenCalledOnce();
  for (const subscription of subscriptions) subscription.dispose();
  expect(fake.session.dispose).toHaveBeenCalledOnce();
});

it('isolates audio diagnostics callback failures', () => {
  fake.commit.mockImplementation(() => {
    fake.register?.();
    return true;
  });
  fake.session.audioDiagnostics.mockImplementationOnce(() => {
    throw new Error('private');
  });
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  fake.commands.get('aiPair.localAudio.commit')?.({ version: 2, epoch: 'epoch', token: 'token' });
  expect(fake.commands.get('aiPair.localAudio.audioDiagnostics')?.(undefined)).toBeUndefined();
});

it('waits for companion disposal when the extension deactivates', async () => {
  const stopped = Promise.withResolvers<void>();
  fake.session.dispose.mockReturnValueOnce(stopped.promise);
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  fake.register?.();
  let finished = false;
  const pending = Promise.resolve(deactivate()).then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(fake.session.dispose).toHaveBeenCalledOnce();
  expect(finished).toBe(false);
  stopped.resolve();
  await pending;
});

it('waits for the previous companion to reap before creating a replacement', async () => {
  const stopped = Promise.withResolvers<void>();
  fake.session.dispose.mockReturnValueOnce(stopped.promise);
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  fake.register?.();
  expect(createCompanionSession).toHaveBeenCalledTimes(1);
  const previous = deactivate();
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  fake.register?.();
  expect(createCompanionSession).toHaveBeenCalledTimes(1);
  stopped.resolve();
  await previous;
  await vi.waitFor(() => {
    expect(createCompanionSession).toHaveBeenCalledTimes(2);
  });
  await deactivate();
});

it('keeps the original retirement barrier across a canceled replacement', async () => {
  const stopped = Promise.withResolvers<void>();
  fake.session.dispose.mockReturnValueOnce(stopped.promise);
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  fake.register?.();
  const first = deactivate();
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  fake.register?.();
  const second = deactivate();
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  fake.register?.();
  expect(createCompanionSession).toHaveBeenCalledTimes(1);
  stopped.resolve();
  await Promise.all([first, second]);
  await vi.waitFor(() => {
    expect(createCompanionSession).toHaveBeenCalledTimes(2);
  });
  await deactivate();
});

it('acknowledges a replacement commit only after its first frame can be accepted', async () => {
  const stopped = Promise.withResolvers<void>();
  fake.session.dispose.mockReturnValueOnce(stopped.promise);
  fake.session.accept.mockReturnValue(true);
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  fake.register?.();
  const previous = deactivate();
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  fake.commit.mockImplementationOnce(() => {
    fake.register?.();
    return true;
  });
  const value = fake.commands.get('aiPair.localAudio.commit')?.({ version: 2, epoch: 'epoch', token: 'token' });
  let acknowledged = false;
  const pending = Promise.resolve(value).then((result) => {
    acknowledged = true;
    return result;
  });
  await Promise.resolve();
  expect(acknowledged).toBe(false);
  stopped.resolve();
  await previous;
  expect(await pending).toBe(true);
  expect(fake.commands.get('aiPair.localAudio.frame')?.({})).toBe(true);
  await deactivate();
});

it('does not advertise attachment readiness until the previous companion is reaped', async () => {
  const stopped = Promise.withResolvers<void>();
  fake.session.dispose.mockReturnValueOnce(stopped.promise);
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  fake.register?.();
  const previous = deactivate();
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  const pending = Promise.resolve(fake.commands.get('aiPair.localAudio.activate')?.(undefined));
  let ready = false;
  void pending.then(() => {
    ready = true;
  });
  await Promise.resolve();
  const wasReady = ready;
  stopped.resolve();
  await previous;
  expect(wasReady).toBe(false);
  expect(await pending).toBe(true);
  await deactivate();
});

it('keeps the accepted epoch when a later invalid commit arrives before startup', async () => {
  const stopped = Promise.withResolvers<void>();
  fake.session.dispose.mockReturnValueOnce(stopped.promise);
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  fake.register?.();
  const previous = deactivate();
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  fake.commit
    .mockImplementationOnce(() => {
      fake.register?.();
      return true;
    })
    .mockReturnValueOnce(false);
  const commit = fake.commands.get('aiPair.localAudio.commit');
  const accepted = Promise.resolve(commit?.({ version: 2, epoch: 'accepted', token: 'token' }));
  expect(commit?.({ version: 2, epoch: 'rejected', token: 'wrong' })).toBe(false);
  stopped.resolve();
  await previous;
  expect(await accepted).toBe(true);
  expect(vi.mocked(createCompanionSession).mock.lastCall?.[1]).toBe('accepted');
  await deactivate();
});

it('rejects readiness and commit when the previous companion cannot retire', async () => {
  const failed = Promise.withResolvers<void>();
  fake.session.dispose.mockReturnValueOnce(failed.promise);
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  fake.register?.();
  const previous = deactivate();
  activate(mock<vscode.ExtensionContext>({ subscriptions: [] }));
  const readiness = Promise.resolve(fake.commands.get('aiPair.localAudio.activate')?.(undefined));
  fake.commit.mockImplementationOnce(() => {
    fake.register?.();
    return true;
  });
  const commit = Promise.resolve(fake.commands.get('aiPair.localAudio.commit')?.({ version: 2, epoch: 'epoch', token: 'token' }));
  failed.reject(new Error('private'));
  await expect(previous).rejects.toThrow('private');
  expect(await readiness).toBe(false);
  expect(await commit).toBe(false);
  expect(createCompanionSession).toHaveBeenCalledOnce();
});
