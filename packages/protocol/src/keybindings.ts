// The extension's keyboard shortcuts, and what the panel's tooltips name of them (#94).

import { z } from 'zod';

/**
 * Validates an entry of the programmer's keybindings.json. Other fields, such as `args`, are dropped: a tooltip
 * needs none of them.
 */
export const KEYBINDING_SCHEMA = z.object({
  command: z.string(),
  key: z.string().optional(),
  when: z.string().optional(),
});

/** A keybinding, validated. */
export type Keybinding = z.infer<typeof KEYBINDING_SCHEMA>;

/** Validates the label of each control's shortcut, as the page shows it; one left out has none. */
export const SHORTCUT_LABELS_SCHEMA = z.strictObject({
  pause: z.string().optional(),
  attention: z.string().optional(),
  reply: z.string().optional(),
});

/** The label of each control's shortcut. */
export type ShortcutLabels = z.infer<typeof SHORTCUT_LABELS_SCHEMA>;

/** A keybinding the extension contributes: its key everywhere but macOS, and on macOS. */
export interface DefaultKeybinding {
  command: string;
  key: string;
  mac: string;
  when: string;
}

/**
 * The keybindings the extension contributes, by the control whose tooltip names them, as
 * `packages/vscode/package.json` lists them; `shortcuts_manifest.test.ts` holds the manifest to these.
 */
export const DEFAULT_KEYBINDINGS: Readonly<Record<keyof ShortcutLabels, DefaultKeybinding>> = {
  pause: { command: 'aiPair.togglePause', key: 'alt+q', mac: 'ctrl+shift+q', when: 'aiPair.active' },
  attention: { command: 'aiPair.toggleAttention', key: 'alt+w', mac: 'ctrl+shift+w', when: 'aiPair.active' },
  reply: { command: 'aiPair.focusReply', key: 'ctrl+alt+space', mac: 'ctrl+shift+space', when: 'aiPair.active' },
};
