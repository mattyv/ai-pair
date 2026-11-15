// The labels the panel's tooltips name for the extension's shortcuts (#94, specs/Shortcuts.tla, `Label`). Solitary:
// shortcut_labels.ts is pure, and uses only @ai-pair/protocol's constants and zod schemas, which are real.

import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS, MAC_MODIFIERS, SHORTCUT_LABELS_SCHEMA } from '@ai-pair/protocol';
import { shortcutLabels, shortcutPlatform } from '../src/shortcut_labels';

/** Returns the labels for keybindings.json's `entries` on `platform`, held to the schema the page's message uses. */
function labels(entries: unknown, platform: 'mac' | 'linux' | 'win' = 'linux'): unknown {
  return SHORTCUT_LABELS_SCHEMA.parse(shortcutLabels(entries, platform));
}

describe('shortcutPlatform', () => {
  it('names the platform whose keybinding fields VS Code reads', () => {
    expect(shortcutPlatform('darwin')).toBe('mac');
    expect(shortcutPlatform('win32')).toBe('win');
    expect(shortcutPlatform('linux')).toBe('linux');
    expect(shortcutPlatform('freebsd')).toBe('linux');
  });
});

describe('shortcutLabels', () => {
  it('Label: names the defaults, as each platform shows them, when there is no file', () => {
    expect(labels(undefined, 'mac')).toEqual({
      pause: `${MAC_MODIFIERS.control}${MAC_MODIFIERS.shift}Q`,
      attention: `${MAC_MODIFIERS.control}${MAC_MODIFIERS.shift}W`,
      reply: `${MAC_MODIFIERS.control}${MAC_MODIFIERS.shift}Space`,
    });
    expect(labels(undefined, 'linux')).toEqual({ pause: 'Alt+Q', attention: 'Alt+W', reply: 'Ctrl+Alt+Space' });
    expect(labels({ not: 'an array' }, 'win')).toEqual({ pause: 'Alt+Q', attention: 'Alt+W', reply: 'Ctrl+Alt+Space' });
  });

  it('Label: skips an entry that is not a keybinding, as VS Code does', () => {
    expect(labels([3, { key: 'alt+p' }, { command: 7, key: 'alt+p' }])).toEqual(labels([]));
  });

  it("Label: names the file's last addition for a command, over the default", () => {
    expect(
      labels([
        { key: 'alt+p', command: DEFAULT_KEYBINDINGS.pause.command },
        { key: 'ctrl+shift+p', command: DEFAULT_KEYBINDINGS.pause.command, args: { ignored: true } },
        { key: 'alt+h', command: 'some.other.command' },
      ]),
    ).toEqual({ pause: 'Ctrl+Shift+P', attention: 'Alt+W', reply: 'Ctrl+Alt+Space' });
  });

  it('Label: ignores an addition without a key', () => {
    expect(labels([{ command: DEFAULT_KEYBINDINGS.pause.command }, { key: '  ', command: DEFAULT_KEYBINDINGS.pause.command }])).toEqual(
      labels([]),
    );
  });

  it('Label: names no key once a removal takes the default, with no key or with its key spelled any way', () => {
    expect(
      labels([
        { command: `-${DEFAULT_KEYBINDINGS.pause.command}` },
        { key: 'ALT+W', command: `-${DEFAULT_KEYBINDINGS.attention.command}` },
        { key: 'alt+ctrl+space', command: `-${DEFAULT_KEYBINDINGS.reply.command}`, when: 'aiPair.active' },
      ]),
    ).toEqual({});
    expect(labels([{ key: 'shift+ctrl+q', command: `-${DEFAULT_KEYBINDINGS.pause.command}` }], 'mac')).toEqual({
      attention: `${MAC_MODIFIERS.control}${MAC_MODIFIERS.shift}W`,
      reply: `${MAC_MODIFIERS.control}${MAC_MODIFIERS.shift}Space`,
    });
  });

  it('Label: keeps the default when a removal names another key or another when', () => {
    expect(
      labels([
        { key: 'alt+p', command: `-${DEFAULT_KEYBINDINGS.pause.command}` },
        { command: `-${DEFAULT_KEYBINDINGS.attention.command}`, when: 'editorFocus' },
      ]),
    ).toEqual(labels([]));
  });

  it('Label: lets a removal take only the default, whatever its place in the file', () => {
    expect(
      labels([{ key: 'alt+p', command: DEFAULT_KEYBINDINGS.pause.command }, { command: `-${DEFAULT_KEYBINDINGS.pause.command}` }]),
    ).toEqual({ pause: 'Alt+P', attention: 'Alt+W', reply: 'Ctrl+Alt+Space' });
  });

  it("Label: shows every modifier and chord in the platform's style, aliases resolved", () => {
    const entries = [
      { key: 'cmd+alt+shift+ctrl+k', command: DEFAULT_KEYBINDINGS.pause.command },
      { key: 'ctrl+k   ctrl+f5', command: DEFAULT_KEYBINDINGS.attention.command },
      { key: 'win+meta+escape', command: DEFAULT_KEYBINDINGS.reply.command },
    ];
    expect(labels(entries, 'mac')).toEqual({
      pause: `${MAC_MODIFIERS.control}${MAC_MODIFIERS.option}${MAC_MODIFIERS.shift}${MAC_MODIFIERS.command}K`,
      attention: `${MAC_MODIFIERS.control}K ${MAC_MODIFIERS.control}F5`,
      reply: `${MAC_MODIFIERS.command}Escape`,
    });
    expect(labels(entries, 'linux')).toEqual({ pause: 'Ctrl+Shift+Alt+Super+K', attention: 'Ctrl+K Ctrl+F5', reply: 'Super+Escape' });
    expect(labels(entries, 'win')).toEqual({
      pause: 'Ctrl+Shift+Alt+Windows+K',
      attention: 'Ctrl+K Ctrl+F5',
      reply: 'Windows+Escape',
    });
  });
});
