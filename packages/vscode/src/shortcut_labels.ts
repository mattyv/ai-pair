// What the panel's tooltips name for each of the extension's shortcuts (#94): VS Code's rule for the binding a
// command's menus show, applied to the extension's defaults and the programmer's keybindings.json.

import { DEFAULT_KEYBINDINGS, KEYBINDING_SCHEMA, type DefaultKeybinding, type Keybinding, type ShortcutLabels } from '@ai-pair/protocol';

/** The platforms whose keybindings differ: the fields of a contributed keybinding VS Code reads on each. */
export type ShortcutPlatform = 'mac' | 'linux' | 'win';

/** How a platform shows a key: its modifiers, canonical name and label, in VS Code's order, and what joins them. */
interface KeyStyle {
  modifiers: ReadonlyArray<readonly [string, string]>;
  separator: string;
}

/** Each platform's style: ⌃⇧Q on macOS, Ctrl+Shift+Q elsewhere, as VS Code's menus show them. */
const STYLES: Readonly<Record<ShortcutPlatform, KeyStyle>> = {
  mac: {
    modifiers: [
      ['ctrl', '⌃'],
      ['alt', '⌥'],
      ['shift', '⇧'],
      ['meta', '⌘'],
    ],
    separator: '',
  },
  linux: {
    modifiers: [
      ['ctrl', 'Ctrl'],
      ['shift', 'Shift'],
      ['alt', 'Alt'],
      ['meta', 'Super'],
    ],
    separator: '+',
  },
  win: {
    modifiers: [
      ['ctrl', 'Ctrl'],
      ['shift', 'Shift'],
      ['alt', 'Alt'],
      ['meta', 'Windows'],
    ],
    separator: '+',
  },
};

/** The other names keybindings.json accepts for a modifier. */
const MODIFIER_ALIASES = new Map([
  ['cmd', 'meta'],
  ['win', 'meta'],
]);

/** One step of a key: modifiers held, and the key pressed with them. */
interface Chord {
  modifiers: ReadonlySet<string>;
  key: string;
}

/** Returns the platform VS Code reads a keybinding's fields for, from Node's name for it. */
export function shortcutPlatform(platform: NodeJS.Platform): ShortcutPlatform {
  if (platform === 'darwin') return 'mac';
  return platform === 'win32' ? 'win' : 'linux';
}

/** Splits a key as keybindings.json writes it, such as `ctrl+k ctrl+q`, into its chords. */
function chords(key: string): Chord[] {
  return key
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .map((part) => {
      const last = part.lastIndexOf('+');
      const names = part
        .slice(0, last + 1)
        .split('+')
        .filter((name) => name !== '');
      return { modifiers: new Set(names.map((name) => MODIFIER_ALIASES.get(name) ?? name)), key: part.slice(last + 1) };
    });
}

/** Returns a key as `style` shows it: its modifiers in order, then the key, capitalized. */
function keyText(key: string, style: KeyStyle): string {
  return chords(key)
    .map((chord) => {
      const modifiers = style.modifiers.filter(([name]) => chord.modifiers.has(name)).map(([, label]) => label);
      return [...modifiers, chord.key.charAt(0).toUpperCase() + chord.key.slice(1)].join(style.separator);
    })
    .join(' ');
}

/**
 * Returns the key VS Code names for `binding`'s command, or undefined if none is bound (specs/Shortcuts.tla, `Label`).
 * The file's last addition wins; else the default, unless a removal took it. A removal, `-command`, removes only
 * the default binding, whatever its place in the file, and only one whose key and `when` it names, if it names them.
 */
function commandKey(binding: DefaultKeybinding, entries: readonly Keybinding[], platform: ShortcutPlatform): string | undefined {
  const added = entries.filter((entry) => entry.command === binding.command && entry.key !== undefined && entry.key.trim() !== '');
  const last = added.at(-1);
  if (last !== undefined) return last.key;
  const key = platform === 'mac' ? binding.mac : binding.key;
  // Compared as one style shows them, two spellings of one key match.
  const style = STYLES.linux;
  const removed = entries.some(
    (entry) =>
      entry.command === `-${binding.command}` &&
      (entry.key === undefined || keyText(entry.key, style) === keyText(key, style)) &&
      (entry.when === undefined || entry.when === binding.when),
  );
  return removed ? undefined : key;
}

/**
 * Returns the label of each control's shortcut on `platform`, given keybindings.json's contents as parsed: an
 * array of entries, of which any that is not a keybinding is skipped, as VS Code skips it. Anything else is no
 * file, and leaves the defaults.
 */
export function shortcutLabels(file: unknown, platform: ShortcutPlatform): ShortcutLabels {
  const entries = (Array.isArray(file) ? file : []).flatMap((entry: unknown) => {
    const parsed = KEYBINDING_SCHEMA.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  /** Returns the label of `binding`'s command, or undefined when it has no key. */
  function label(binding: DefaultKeybinding): string | undefined {
    const key = commandKey(binding, entries, platform);
    return key === undefined ? undefined : keyText(key, STYLES[platform]);
  }
  return {
    pause: label(DEFAULT_KEYBINDINGS.pause),
    attention: label(DEFAULT_KEYBINDINGS.attention),
    reply: label(DEFAULT_KEYBINDINGS.reply),
  };
}
