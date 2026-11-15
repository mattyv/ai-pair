// Reading keybindings.json for the panel's tooltips, once and on each change (#94, specs/Shortcuts.tla). Solitary:
// the vscode module is a fake whose file system the test answers and whose watcher's events the test fires, and
// shortcut_labels.ts's shortcutLabels is a mock that says what it was given.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type * as vscode from 'vscode';
import { SHORTCUT_LABELS_SCHEMA, type ShortcutLabels } from '@ai-pair/protocol';
import { shortcutLabels } from '../src/shortcut_labels';
import { ShortcutWatcher } from '../src/shortcut_watcher';

/** What the mocked modules share with the tests, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => {
  /** A URI, faked: its path. */
  class FakeUri {
    constructor(readonly path: string) {}

    static joinPath(base: FakeUri, ...parts: string[]): FakeUri {
      return new FakeUri([base.path, ...parts].join('/'));
    }
  }

  /** vscode.RelativePattern, faked: it keeps what it was made with. */
  class FakePattern {
    constructor(
      readonly base: FakeUri,
      readonly pattern: string,
    ) {}
  }

  /** A read the test answers: the path asked for, and how to settle it. */
  interface Read {
    path: string;
    resolve: (bytes: Uint8Array) => void;
    reject: (error: Error) => void;
  }

  return {
    FakeUri,
    FakePattern,
    /** The reads asked of vscode.workspace.fs, in order, each still the test's to settle. */
    reads: [] as Read[],
    /** The pattern the watcher was made with. */
    patterns: [] as FakePattern[],
    /** Each listener the watcher registered, by event name. */
    listeners: new Map<string, () => void>(),
    dispose: vi.fn(),
  };
});

vi.mock('vscode', () => ({
  Uri: fakes.FakeUri,
  RelativePattern: fakes.FakePattern,
  workspace: {
    fs: {
      readFile: (uri: InstanceType<typeof fakes.FakeUri>) =>
        new Promise<Uint8Array>((resolve, reject) => {
          fakes.reads.push({ path: uri.path, resolve, reject });
        }),
    },
    createFileSystemWatcher: (pattern: InstanceType<typeof fakes.FakePattern>) => {
      fakes.patterns.push(pattern);
      /** Returns a registration that keeps its listener under `name`. */
      function on(name: string): (registered: () => void) => void {
        return (registered) => {
          fakes.listeners.set(name, registered);
        };
      }
      return { onDidChange: on('change'), onDidCreate: on('create'), onDidDelete: on('delete'), dispose: fakes.dispose };
    },
  },
}));

vi.mock('../src/shortcut_labels', () => ({ shortcutLabels: vi.fn() }));

/** The labels the mocked shortcutLabels gives for a file whose `pause` binding is `key`. */
function labelsFor(file: unknown): ShortcutLabels {
  const pause = Array.isArray(file) && typeof file[0] === 'string' ? file[0] : undefined;
  return SHORTCUT_LABELS_SCHEMA.parse({ pause });
}

/** Lets the watcher's promise chains run. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Returns the read the watcher asked for at `index`, failing if there is none. */
function read(index: number): (typeof fakes.reads)[number] {
  const found = fakes.reads[index];
  if (found === undefined) throw new Error(`no read ${index}`);
  return found;
}

/** Returns the listener the watcher registered for `name`, failing if there is none. */
function listener(name: string): () => void {
  const found = fakes.listeners.get(name);
  if (found === undefined) throw new Error(`no ${name} listener`);
  return found;
}

/** Returns a watcher of `/user`, for macOS, whose labels go to the returned `show`. */
function watch(): { watcher: ShortcutWatcher; show: ReturnType<typeof vi.fn<(labels: ShortcutLabels) => void>> } {
  const show = vi.fn<(labels: ShortcutLabels) => void>();
  return { watcher: new ShortcutWatcher(mock<vscode.Uri>({ path: '/user' }), 'mac', show), show };
}

/** Returns `text` as the bytes vscode.workspace.fs reads. */
function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

afterEach(() => {
  fakes.reads.length = 0;
  fakes.patterns.length = 0;
  fakes.listeners.clear();
  vi.restoreAllMocks();
  vi.mocked(shortcutLabels).mockReset();
  fakes.dispose.mockReset();
});

describe('ShortcutWatcher', () => {
  it('Converges: reads keybindings.json as it starts, and hands its labels to the panel', async () => {
    vi.mocked(shortcutLabels).mockImplementation(labelsFor);
    const { show } = watch();
    expect(fakes.patterns.map((p) => [p.base.path, p.pattern])).toEqual([['/user', 'keybindings.json']]);
    expect(fakes.reads.map((r) => r.path)).toEqual(['/user/keybindings.json']);
    // Comments and a trailing comma, as keybindings.json allows them.
    read(0).resolve(encode('// mine\n["alt+p",]'));
    await settle();
    expect(vi.mocked(shortcutLabels)).toHaveBeenCalledWith(['alt+p'], 'mac');
    expect(show).toHaveBeenCalledExactlyOnceWith({ pause: 'alt+p' });
  });

  it('Converges: reads the file again on each change, creation, and deletion', async () => {
    vi.mocked(shortcutLabels).mockImplementation(labelsFor);
    const { show } = watch();
    read(0).resolve(encode('["a"]'));
    await settle();
    for (const [index, name] of ['change', 'create', 'delete'].entries()) {
      listener(name)();
      read(index + 1).resolve(encode(`["${name}"]`));
      await settle();
      expect(show).toHaveBeenLastCalledWith({ pause: name });
    }
    expect(show).toHaveBeenCalledTimes(4);
  });

  it('Converges: reads a file that cannot be read as empty, which leaves the defaults', async () => {
    vi.mocked(shortcutLabels).mockImplementation(labelsFor);
    const { show } = watch();
    read(0).reject(new Error('ENOENT'));
    await settle();
    expect(vi.mocked(shortcutLabels)).toHaveBeenCalledWith(undefined, 'mac');
    expect(show).toHaveBeenCalledExactlyOnceWith({});
  });

  it('MonotoneProp: drops a read that a later one overtook', async () => {
    vi.mocked(shortcutLabels).mockImplementation(labelsFor);
    const { show } = watch();
    listener('change')();
    read(1).resolve(encode('["new"]'));
    await settle();
    read(0).resolve(encode('["old"]'));
    await settle();
    expect(show).toHaveBeenCalledExactlyOnceWith({ pause: 'new' });
  });

  it('stops watching once disposed', () => {
    const { watcher } = watch();
    watcher.dispose();
    expect(fakes.dispose).toHaveBeenCalledOnce();
  });
});
