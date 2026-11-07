import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { mock } from 'vitest-mock-extended';
import { activate, deactivate } from '../src/extension';
import { createCompanionSession } from '../src/companion_session';

const fake = vi.hoisted(() => ({
  commands: new Map<string, (value: unknown) => unknown>(),
  prepare: vi.fn(),
  commit: vi.fn(),
  register: undefined as (() => void) | undefined,
  session: { accept: vi.fn(), keySet: vi.fn(), keyRemove: vi.fn(), preview: vi.fn(), dispose: vi.fn() },
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
  })),
}));

beforeEach(() => {
  fake.commands.clear();
  vi.clearAllMocks();
});

describe('local companion activation', () => {
  it('prepares without registering a provider and commits only once', () => {
    const subscriptions: vscode.Disposable[] = [];
    fake.prepare.mockReturnValue({ version: 1, epoch: 'epoch', token: 'token' });
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
    const prepared: unknown = prepare?.({ version: 1, epoch: 'epoch' });
    expect(createCompanionSession).not.toHaveBeenCalled();
    expect(commit?.(prepared)).toBe(true);
    expect(fake.commands.get('aiPair.localAudio.status')?.(undefined)).toEqual({ id: 1, state: 'speaking', started: true });
    expect(createCompanionSession).toHaveBeenCalledTimes(1);
    expect(commit?.(prepared)).toBe(false);
    for (const subscription of subscriptions) subscription.dispose();
  });
});

it('rejects malformed commit and makes unattached commands safe', async () => {
  deactivate();
  const subscriptions: vscode.Disposable[] = [];
  activate(mock<vscode.ExtensionContext>({ subscriptions }));
  expect(fake.commands.get('aiPair.localAudio.commit')?.({})).toBe(false);
  expect(fake.commit).not.toHaveBeenCalled();
  expect(fake.commands.get('aiPair.localAudio.frame')?.({})).toBe(false);
  expect(fake.commands.get('aiPair.localAudio.status')?.(undefined)).toBeUndefined();
  expect(fake.commands.get('aiPair.localAudio.diagnostics')?.(undefined)).toBeUndefined();
  await expect(fake.commands.get('aiPair.localAudio.keySet')?.(undefined)).resolves.toBeUndefined();
  await expect(fake.commands.get('aiPair.localAudio.keyRemove')?.(undefined)).resolves.toBeUndefined();
  await expect(fake.commands.get('aiPair.localAudio.preview')?.(undefined)).resolves.toBeUndefined();
  for (const subscription of subscriptions) subscription.dispose();
});

it('forwards attached commands to the local session and disposes it', async () => {
  const subscriptions: vscode.Disposable[] = [];
  fake.prepare.mockReturnValue({ version: 1, epoch: 'epoch', token: 'token' });
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
  expect(fake.commands.get('aiPair.localAudio.diagnostics')?.(undefined)).toEqual({ version: 'test', build: 'test-build', events: [] });
  expect(fake.session.accept).toHaveBeenCalledWith({ message: 'safe' });
  expect(fake.session.keySet).toHaveBeenCalledOnce();
  expect(fake.session.keyRemove).toHaveBeenCalledOnce();
  expect(fake.session.preview).toHaveBeenCalledOnce();
  for (const subscription of subscriptions) subscription.dispose();
  expect(fake.session.dispose).toHaveBeenCalledOnce();
});
