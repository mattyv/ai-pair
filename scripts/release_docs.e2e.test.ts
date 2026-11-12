// Checks release documentation against the manifests and visible panel labels.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/** Reads a repository file. */
function read(file: string): string {
  return readFileSync(file, 'utf8');
}

describe('release documentation', () => {
  it('names both installable extensions and the command approval controls', () => {
    const readme = read('README.md');
    for (const file of ['packages/vscode/package.json', 'packages/audio-ui/package.json']) {
      const value: unknown = JSON.parse(read(file));
      const manifest = z.object({ publisher: z.string(), name: z.string() }).parse(value);
      expect(readme).toContain(`${manifest.publisher}.${manifest.name}`);
    }
    const panel = read('packages/vscode/src/panel_html.ts');
    for (const label of ['Run once', 'Allow this command', 'Require command approval']) {
      expect(panel).toContain(label);
      expect(readme).toContain(label);
    }
  });

  it('links the release checklist and requires an architecture review', () => {
    expect(read('README.md')).toContain('(RELEASE.md)');
    const checklist = read('RELEASE.md');
    expect(checklist).toContain('README.md');
    expect(checklist).toContain('`.archi`');
    expect(checklist).toContain('generated exports');
    expect(checklist).toContain('reviewed and remains current');
  });
});
