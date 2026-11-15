// The schemas of the extension's keyboard shortcuts (#94). Solitary: keybindings.ts is constants and zod schemas.

import { describe, expect, it } from 'vitest';
import { KEYBINDING_SCHEMA, MAC_MODIFIERS, SHORTCUT_LABELS_SCHEMA } from '../src/keybindings';

describe('KEYBINDING_SCHEMA', () => {
  it("takes an entry of keybindings.json, dropping the fields a tooltip doesn't need", () => {
    expect(KEYBINDING_SCHEMA.parse({ key: 'alt+q', command: 'aiPair.togglePause', when: 'aiPair.active', args: 1 })).toEqual({
      key: 'alt+q',
      command: 'aiPair.togglePause',
      when: 'aiPair.active',
    });
    expect(KEYBINDING_SCHEMA.parse({ command: '-aiPair.togglePause' })).toEqual({ command: '-aiPair.togglePause' });
  });

  it('refuses an entry without a command, or with a key that is not text', () => {
    expect(KEYBINDING_SCHEMA.safeParse({ key: 'alt+q' }).success).toBe(false);
    expect(KEYBINDING_SCHEMA.safeParse({ command: 'aiPair.togglePause', key: 3 }).success).toBe(false);
  });
});

describe('SHORTCUT_LABELS_SCHEMA', () => {
  it('takes a label for each control, any of them left out', () => {
    expect(
      SHORTCUT_LABELS_SCHEMA.parse({
        pause: `${MAC_MODIFIERS.control}${MAC_MODIFIERS.shift}Q`,
        attention: 'Alt+W',
        reply: 'Ctrl+Alt+Space',
      }),
    ).toEqual({
      pause: `${MAC_MODIFIERS.control}${MAC_MODIFIERS.shift}Q`,
      attention: 'Alt+W',
      reply: 'Ctrl+Alt+Space',
    });
    expect(SHORTCUT_LABELS_SCHEMA.parse({})).toEqual({});
  });

  it('refuses a control it does not know', () => {
    expect(SHORTCUT_LABELS_SCHEMA.safeParse({ interrupt: 'Alt+I' }).success).toBe(false);
  });
});
